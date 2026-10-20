import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * S2: reproduce the real-app runtime compat recreation in an instrumented way,
 * then (after the fix) verify the true opaque surface.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "capture-sprint");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const PORT = 9230;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pages() {
  try {
    const response = await fetch("http://127.0.0.1:" + PORT + "/json");
    return await response.json();
  } catch {
    return null;
  }
}

async function waitPage(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await pages();
    const page = targets && targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
    if (page) return page;
    await sleep(400);
  }
  return null;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    socket.addEventListener("error", (event) => reject(new Error("socket: " + (event.message || ""))));
    socket.addEventListener("open", () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        close() {
          try { socket.close(); } catch { /* ignore */ }
        },
      }),
    );
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 600));
  return result.result.value;
}

function runPowerShell(scriptName, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", scriptName), ...args], {
    cwd: repoRoot, encoding: "utf8", timeout: 120000,
  });
  const stdout = (run.stdout || "").trim().replace(/^\uFEFF/, "");
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (run.status !== 0 || start < 0 || end <= start) return { ok: false, raw: stdout + (run.stderr || "") };
  try { return { ok: true, value: JSON.parse(stdout.slice(start, end + 1)) }; } catch (error) { return { ok: false, raw: stdout, error: String(error) }; }
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const userData = path.join(evidenceDir, "userdata-recreate");
  fs.rmSync(userData, { recursive: true, force: true });
  const logFile = path.join(evidenceDir, "main-recreate.log");
  const env = Object.assign({}, process.env, {
    ELECTRON_STEALTH: "1",
    HIRESHADE_DEBUG_CDP: String(PORT),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: userData,
    HIRESHADE_LOG_FILE: logFile,
    HIRESHADE_COMPAT_RECREATE: "1",
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  const result = { generated_at: new Date().toISOString(), survived: false, steps: [], page_before: null, page_after: null, state_after: null, printwindow: null, dxgi: null, log_tail: "" };
  try {
    const page = await waitPage(30000);
    if (!page) throw new Error("app did not expose floating page");
    result.page_before = { title: page.title, url: page.url };
    let client = await connect(page.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await sleep(1000);
    const before = await evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState() }))()");
    result.steps.push({ at: Date.now(), step: "before", captureMode: before.capture.compatMode, transparent: before.capture.transparent, bounds: before.windows.windows.floating.bounds });
    await evaluate(client, "setTimeout(function(){ window.hireshadeCapture.setCompatMode(true).catch(function(){}); },0); true");
    result.steps.push({ at: Date.now(), step: "compat-toggle-dispatched" });
    // Monitor for 10 seconds: main alive? CDP reachable? new page?
    let pageAfter = null;
    for (let i = 0; i < 20; i += 1) {
      await sleep(500);
      const targets = await pages();
      const floating = targets && targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
      result.steps.push({ at: Date.now(), step: "poll", attempt: i, cdpReachable: Boolean(targets), floatingTarget: Boolean(floating), electronAlive: !app.killed });
      if (floating) { pageAfter = floating; break; }
    }
    result.survived = Boolean(pageAfter) && !app.killed;
    result.page_after = pageAfter ? { title: pageAfter.title, url: pageAfter.url } : null;
    if (pageAfter) {
      client.close();
      client = await connect(pageAfter.webSocketDebuggerUrl);
      await client.send("Runtime.enable");
      await sleep(800);
      const after = await evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), dom: { transparency: getComputedStyle(document.documentElement).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor } }))()");
      result.state_after = { captureMode: after.capture.compatMode, transparent: after.capture.transparent, opaqueSurfaceOnRestart: after.capture.opaqueSurfaceOnRestart, runtimeSurfaceNote: after.capture.runtimeSurfaceNote, bounds: after.windows.windows.floating.bounds, dom: after.dom, reassertCount: after.capture.reassertCount };
      const pw = runPowerShell("printwindow.ps1", ["-OutDir", evidenceDir, "-Label", "opaque-recreate-on"]);
      result.printwindow = pw.ok ? pw.value : { error: pw.raw };
      const probe = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], {
        cwd: repoRoot, env: Object.assign({}, process.env, { O2_PROBE_OUT: evidenceDir, O2_PROBE_LABEL: "opaque-recreate-on" }), encoding: "utf8", timeout: 120000,
      });
      const probeOut = (probe.stdout || "").trim();
      const startIdx = probeOut.indexOf("{");
      const endIdx = probeOut.lastIndexOf("}");
      result.desktopcapturer = startIdx >= 0 ? JSON.parse(probeOut.slice(startIdx, endIdx + 1)) : { error: probeOut };
    }
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error);
  } finally {
    result.log_tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").slice(-40).join("\n") : "";
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }
  fs.writeFileSync(path.join(evidenceDir, "recreate-repro.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error("[repro] " + error); process.exitCode = 1; });
