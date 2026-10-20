import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/** V1 positive control for the transparent surface: launch with affinity NONE (0x00). */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(repoRoot, "docs", "evidence", "capture-sprint", "v1");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const electronExe = createRequire(path.join(desktopElectron, "package.json"))("electron");
const PORT = 9253;
const MARKER = "rgb(1,254,1)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(script, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", script), ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120000 });
  const out = (run.stdout || "").trim().replace(/^\uFEFF/, "");
  const s = out.indexOf("{"); const e = out.lastIndexOf("}");
  if (run.status !== 0 || s < 0 || e <= s) return { ok: false, raw: out + (run.stderr || "") };
  try { return { ok: true, value: JSON.parse(out.slice(s, e + 1)) }; } catch { return { ok: false, raw: out }; }
}
async function targets() { try { const r = await fetch("http://127.0.0.1:" + PORT + "/json"); return await r.json(); } catch { return null; } }
async function attach(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const t = await targets();
    const p = t && t.find((x) => x.type === "page" && /floating\.html/.test(x.url || ""));
    if (p) {
      const ws = new WebSocket(p.webSocketDebuggerUrl);
      const ready = await new Promise((res) => { ws.addEventListener("open", () => res(true)); ws.addEventListener("error", () => res(false)); });
      if (!ready) { try { ws.close(); } catch { /* ignore */ } continue; }
      let id = 0; const pending = new Map();
      ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const e = pending.get(m.id); pending.delete(m.id); m.error ? e.reject(new Error(JSON.stringify(m.error))) : e.resolve(m.result); } });
      ws.addEventListener("close", () => { for (const e of pending.values()) e.reject(new Error("closed")); pending.clear(); });
      return {
        send(method, params) { return new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params: params || {} })); }); },
        close() { try { ws.close(); } catch { /* ignore */ } },
      };
    }
    await sleep(250);
  }
  throw new Error("no floating target; targets=" + JSON.stringify(await targets()));
}
async function evalJs(client, expr) { const r = await client.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value; }

let activeClient = null;
async function evalRetry(expr, label) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (!activeClient) { activeClient = await attach(15000); }
      return await evalJs(activeClient, expr);
    } catch (error) {
      last = error;
      if (!/context was destroyed|closed|dead/i.test(String(error && error.message))) throw error;
      try { if (activeClient) activeClient.close(); } catch { /* ignore */ }
      activeClient = null;
      await sleep(500);
    }
  }
  throw new Error("evalRetry failed (" + label + "): " + String(last && last.message));
}

const userData = path.join(outDir, "userdata-control-A");
fs.rmSync(userData, { recursive: true, force: true }); fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, "capture-state.json"), JSON.stringify({ version: 1, compatMode: false, affinityMode: "none", lastProfile: "reading" }, null, 2) + "\n");
const env = Object.assign({}, process.env, { ELECTRON_STEALTH: "1", HIRESHADE_AFFINITY_MODE: "0", HIRESHADE_DEBUG_CDP: String(PORT), HIRESHADE_DEBUG_IPC: "1", HIRESHADE_USER_DATA: userData, HIRESHADE_LOG_FILE: path.join(outDir, "main-control-A.log") });
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
const result = { variant: "A-control", affinity: "none (0x00)", method: "fresh launch with HIRESHADE_AFFINITY_MODE=none + affinityMode=none seed; marker injection; topmost focus + retries" };
let client = null;
try {
  client = await attach(20000);
  activeClient = client;
  // No applyProfile here: seeding lastProfile=reading is enough and avoids a
  // renderer navigation race right after the 0x00 env override.
  await sleep(1500);
  let snap = await evalRetry("(async () => ({ c: await window.hireshadeCapture.getState(), w: await window.hireshadeDesktop.getState(), d: { dpr: devicePixelRatio } }))()", "snapshot");
  if (!snap.w.windows.floating.visible) { await evalRetry("window.hireshadeDesktop.debugInvokeAction('toggle-overlay')", "show"); await sleep(800); snap = await evalRetry("(async () => ({ c: await window.hireshadeCapture.getState(), w: await window.hireshadeDesktop.getState(), d: { dpr: devicePixelRatio } }))()", "snapshot2"); }
  const b = snap.w.windows.floating.bounds; const scale = snap.d.dpr || 1;
  const physical = [Math.round(b.x * scale), Math.round(b.y * scale), Math.round(b.width * scale), Math.round(b.height * scale)].join(",");
  result.state = { compatMode: snap.c.compatMode, affinityMode: snap.c.affinityMode, bounds: b, physical, visible: snap.w.windows.floating.visible };
  await evalRetry("(function(){document.documentElement.style.background='rgb(1,254,1)';document.body.innerHTML='';var d=document.createElement('div');d.style.cssText='position:fixed;inset:0;background:rgb(1,254,1);z-index:2147483647';document.body.appendChild(d);return true;})()", "marker");
  await sleep(700);
  const style = ps("window-style.ps1", ["-Pids", String(app.pid), "-Title", "", "-OutFile", path.join(outDir, "window-style-control-A.json")]);
  result.window_style = style.ok ? style.value : { error: style.raw };
  result.affinity = ps("affinity.ps1", ["-Pids", String(app.pid), "-Title", "", "-OutFile", path.join(outDir, "affinity-control-A.json"), "-Expect", "0x0", "-Note", "V1 positive control 0x00"]);
  result.paths = {};
  for (const pathId of ["gdi", "desktopcapturer_screen", "dxgi"]) {
    let best = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      ps("focus-window.ps1", ["-Pids", String(app.pid), "-Title", "", "-OutFile", path.join(outDir, "focus-control-A-" + pathId + "-" + attempt + ".json")]);
      await sleep(450);
      let image = null;
      if (pathId === "gdi") { const g = ps("gdi-grab.ps1", ["-OutDir", outDir, "-Label", "control-A-gdi-" + attempt, "-Bounds", physical, "-Note", "control 0x00"]); image = g.ok ? g.value.crop_path : null; }
      else if (pathId === "desktopcapturer_screen") { const pr = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], { cwd: repoRoot, env: Object.assign({}, process.env, { O2_PROBE_OUT: outDir, O2_PROBE_LABEL: "control-A-marker-" + attempt }), encoding: "utf8", timeout: 120000 }); const o = (pr.stdout || "").trim(); const s = o.indexOf("{"); const e = o.lastIndexOf("}"); const j = s >= 0 ? JSON.parse(o.slice(s, e + 1)) : null; image = j && j.screen_sources && j.screen_sources[0] ? j.screen_sources[0].path : null; }
      else { const mp4 = path.join(outDir, "control-A-dxgi-" + attempt + ".mp4"); const frame = path.join(outDir, "control-A-dxgi-" + attempt + "-frame.png"); const rec = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "1", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 }); if (rec.status === 0) { spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 }); image = frame; } }
      if (!image) continue;
      const m = ps("marker-stats.ps1", ["-In", image, "-Label", "control-A-" + pathId + "-" + attempt, "-OutFile", path.join(outDir, "marker-control-A-" + pathId + "-" + attempt + ".json"), "-Rect", physical]);
      const fraction = m.ok ? m.value.fraction : null;
      if (best === null || (typeof fraction === "number" && (best.fraction === null || fraction > best.fraction))) best = { attempt, image, fraction };
      if (typeof fraction === "number" && fraction >= 0.2) break;
    }
    result.paths[pathId] = best;
  }
} catch (error) { result.error = String(error && error.stack ? error.stack : error); }
finally { if (client) client.close(); spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" }); }
fs.writeFileSync(path.join(outDir, "v1-control-A.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2).slice(0, 6000));
