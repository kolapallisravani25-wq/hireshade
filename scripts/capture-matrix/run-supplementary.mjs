import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** Supplementary O2 evidence: compatibility mode, DXGI ddagrab, DPI simulation. */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "overlay-size");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const PORT = 9227;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(scriptName, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120000,
  });
  const stdout = (run.stdout || "").trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (run.status !== 0 || start < 0 || end <= start) return { ok: false, raw: stdout + (run.stderr || "") };
  try {
    return { ok: true, value: JSON.parse(stdout.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, raw: stdout, error: String(error) };
  }
}

async function waitPages(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/json");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
      if (page) return page;
    } catch {
      // wait
    }
    await sleep(400);
  }
  throw new Error("timed out waiting for floating page on port " + port);
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
    socket.addEventListener("error", (event) => reject(new Error("socket error: " + (event.message || ""))));
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
          try {
            socket.close();
          } catch {
            // ignore
          }
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

function affinity(label, expect, pid, note) {
  const outFile = path.join(evidenceDir, "affinity-" + label + ".json");
  const args = ["-OutFile", outFile, "-Expect", expect, "-Note", note || label];
  if (pid) args.push("-Pids", String(pid));
  const run = runPowerShell("affinity.ps1", args);
  return run.ok ? run.value : { pass: false, error: run.raw };
}

function gdi(label, note) {
  const run = runPowerShell("gdi-grab.ps1", ["-OutDir", evidenceDir, "-Label", label, "-Note", note || label]);
  return run.ok ? run.value : { error: run.raw };
}

function diff(label, a, b) {
  const run = runPowerShell("image-diff.ps1", ["-A", a, "-B", b, "-OutFile", path.join(evidenceDir, "diff-" + label + ".json"), "-Label", label]);
  return run.ok ? run.value : { error: run.raw };
}

function ddagrab(label) {
  const mp4 = path.join(evidenceDir, "ddagrab-" + label + ".mp4");
  const frame = path.join(evidenceDir, "ddagrab-" + label + "-frame.png");
  const record = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "2", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-1500), mp4: mp4 };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4: mp4, frame: frame };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const userData = path.join(evidenceDir, "userdata-supp");
  const env = Object.assign({}, process.env, {
    HIRESHADE_DEBUG_CDP: String(PORT),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: userData,
    HIRESHADE_LOG_FILE: path.join(evidenceDir, "main-supp.log"),
    ELECTRON_STEALTH: "1",
    HIRESHADE_CAPTURE_HINT: "ffmpeg ddagrab (DXGI Desktop Duplication) - diagnostic hint, not auto-detection",
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  const result = { generated_at: new Date().toISOString(), compatibility: {}, dxgi: null, dpi: null };
  let client = null;
  try {
    const page = await waitPages(PORT, 30000);
    client = await connect(page.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await sleep(1200);

    // ── Compatibility mode (scrim + opaque renderer surface, no recreation) ──
    await evaluate(client, "(async () => await window.hireshadeCapture.applyProfile('reading'))()");
    await sleep(800);
    const before = await evaluate(client, "(async () => await window.hireshadeCapture.getState())()");
    await evaluate(client, "(async () => await window.hireshadeCapture.setCompatMode(true))()");
    await sleep(1000);
    const on = await evaluate(client, "(async () => await window.hireshadeCapture.getState())()");
    const gdiOn = gdi("compat-mode-on-reading", "compatibility mode ON at READING (opaque scrim, runtime)");
    const affinityOn = affinity("compat-mode-on-reading", "0x11", app.pid, "compatibility mode ON at READING");
    const probeOn = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], {
      cwd: repoRoot,
      env: Object.assign({}, process.env, { O2_PROBE_OUT: evidenceDir, O2_PROBE_LABEL: "compat-mode-on-reading" }),
      encoding: "utf8",
      timeout: 120000,
    });
    await evaluate(client, "(async () => await window.hireshadeCapture.setCompatMode(false))()");
    await sleep(800);
    const off = await evaluate(client, "(async () => await window.hireshadeCapture.getState())()");
    const affinityOff = affinity("compat-mode-off-reading", "0x11", app.pid, "compatibility mode OFF at READING");
    result.compatibility = {
      before: { compatMode: before.compatMode, transparent: before.transparent, bounds: before.windows.floating.bounds },
      on: { compatMode: on.compatMode, transparent: on.transparent, runtimeSurfaceNote: on.runtimeSurfaceNote, bounds: on.windows.floating.bounds },
      off: { compatMode: off.compatMode, transparent: off.transparent },
      affinity_on: affinityOn,
      affinity_off: affinityOff,
      gdi_on: gdiOn,
      desktopcapturer_on: JSON.parse((probeOn.stdout || "").slice((probeOn.stdout || "").indexOf("{"), (probeOn.stdout || "").lastIndexOf("}") + 1) || "null"),
      note: "Runtime compatibility mode applies an opaque #0b0d12 renderer scrim + setBackgroundColor and disables blur/rounded compositing; transparent:false is only creation-time in Electron, so the next launch creates the truly opaque surface. Window recreation at runtime was attempted and crashed on this host (see docs/CAPTURE_MATRIX.md).",
    };

    // ── DXGI Desktop Duplication (ffmpeg ddagrab) ──────────────────────────
    await evaluate(client, "(async () => await window.hireshadeCapture.applyProfile('banner'))()");
    await sleep(700);
    await evaluate(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(true); })()");
    const hidden = await (async () => {
      await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('panic-hide')");
      await sleep(700);
      const rec = ddagrab("banner-hidden-baseline");
      await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
      await sleep(800);
      return rec;
    })();
    const onRec = ddagrab("banner-stealth-on");
    await evaluate(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(false); })()");
    await sleep(700);
    const offRec = ddagrab("banner-stealth-off");
    await evaluate(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(true); })()");
    const onDiff = hidden.frame && onRec.frame ? diff("ddagrab-banner-on-vs-baseline", hidden.frame, onRec.frame) : { error: "missing frames" };
    const offDiff = hidden.frame && offRec.frame ? diff("ddagrab-banner-off-vs-baseline", hidden.frame, offRec.frame) : { error: "missing frames" };
    const supported = hidden.ok && onRec.ok && offRec.ok;
    result.dxgi = {
      method: "ffmpeg -f lavfi -i ddagrab=0:framerate=10 (Desktop Duplication API) 2 s recordings; frames diffed against a hidden-window baseline recorded through the same API",
      supported,
      baseline: hidden,
      stealth_on: onRec,
      stealth_off: offRec,
      on_vs_baseline: onDiff,
      off_vs_baseline: offDiff,
      verdict: supported && onDiff.fraction_diff_gt_threshold !== undefined
        ? onDiff.fraction_diff_gt_threshold > 0.02 && offDiff.fraction_diff_gt_threshold > 0.02
          ? "OBSERVED: DXGI Desktop Duplication IGNORES WDA_EXCLUDEFROMCAPTURE (overlay present in ON and OFF frames; ON/OFF differ from hidden baseline)"
          : onDiff.fraction_diff_gt_threshold <= 0.002
            ? "OBSERVED: DDXGI frames do not show the overlay when protected (unexpected; review frames)"
            : "INCONCLUSIVE: review saved frames"
        : "UNTESTED: ddagrab capture failed on this host (" + String((hidden && hidden.error) || "").slice(-300) + ")",
    };
    fs.writeFileSync(path.join(evidenceDir, "ddagrab-result.json"), JSON.stringify(result.dxgi, null, 2) + "\n", "utf8");
  } finally {
    if (client) client.close();
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }

  // ── DPI simulation (separate instance, --force-device-scale-factor=1.5) ──
  const dpiPort = PORT + 1;
  const dpiEnv = Object.assign({}, process.env, {
    HIRESHADE_FORCE_SCALE: "1.5",
    HIRESHADE_DEBUG_CDP: String(dpiPort),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: path.join(evidenceDir, "userdata-dpi"),
    HIRESHADE_LOG_FILE: path.join(evidenceDir, "main-dpi-sim.log"),
    ELECTRON_STEALTH: "1",
  });
  delete dpiEnv.ELECTRON_RUN_AS_NODE;
  const dpiApp = spawn(electronExe, ["."], { cwd: desktopElectron, env: dpiEnv, stdio: "ignore" });
  try {
    const page = await waitPages(dpiPort, 30000);
    const dpiClient = await connect(page.webSocketDebuggerUrl);
    await dpiClient.send("Runtime.enable");
    await sleep(1200);
    await evaluate(dpiClient, "(async () => await window.hireshadeCapture.applyProfile('banner'))()");
    await sleep(800);
    const snapshot = await evaluate(dpiClient, "(async () => ({ capture: await window.hireshadeCapture.getState(), display: { width: screen.width, height: screen.height, dpr: devicePixelRatio }, bounds: (await window.hireshadeDesktop.getState()).windows.floating.bounds }))()");
    dpiClient.close();
    result.dpi = {
      method: "second app instance with --force-device-scale-factor=1.5 (HIRESHADE_FORCE_SCALE); BANNER profile applied; affinity asserted",
      simulated: true,
      display: snapshot.display,
      bounds: snapshot.bounds,
      affinity: affinity("dpi-simulated", "0x11", dpiApp.pid, "force-device-scale-factor=1.5 simulated DPI"),
      note: "Simulated DPI/scale transition, not a real monitor hot-plug. A real display unplug/plug remains UNTESTED (single-display host).",
    };
    fs.writeFileSync(path.join(evidenceDir, "dpi-simulation.json"), JSON.stringify(result.dpi, null, 2) + "\n", "utf8");
  } finally {
    spawnSync("taskkill", ["/PID", String(dpiApp.pid), "/T", "/F"], { encoding: "utf8" });
  }

  fs.writeFileSync(path.join(evidenceDir, "supplementary-evidence.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[supplementary] FAILED: " + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
