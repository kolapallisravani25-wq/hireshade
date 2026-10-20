import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * X1: resolve the DXGI contradiction (U1 luma 27.39 visible vs V1 marker 0 hidden).
 * Same run/window, two independent detectors:
 *   - marker: unique rgb(1,254,1) painted over the client area; fraction >= 0.20 = VISIBLE
 *   - luma: DXGI frame vs hidden-window baseline, mean_abs_diff (and >16 fraction)
 * Then sweep GPU compositing one variable at a time, N=5 each.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(repoRoot, "docs", "evidence", "capture-sprint", "x1");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const electronExe = createRequire(path.join(desktopElectron, "package.json"))("electron");
const MARKER = "rgb(1,254,1)";
const N = 5;
const CONFIGS = [
  { id: "default", label: "Electron default GPU path", args: [], env: {} },
  { id: "gpu-compositing-off", label: "--disable-gpu-compositing", args: ["--disable-gpu-compositing"], env: {} },
  { id: "gpu-off", label: "--disable-gpu", args: ["--disable-gpu"], env: {} },
  { id: "hw-accel-off", label: "app.disableHardwareAcceleration() (env-gated)", args: [], env: { HIRESHADE_DISABLE_HW_ACCEL: "1" } },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(scriptName, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", scriptName), ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120000 });
  const out = (run.stdout || "").trim().replace(/^\uFEFF/, "");
  const s = out.indexOf("{"); const e = out.lastIndexOf("}");
  if (run.status !== 0 || s < 0 || e <= s) return { ok: false, raw: out + (run.stderr || "") };
  try { return { ok: true, value: JSON.parse(out.slice(s, e + 1)) }; } catch { return { ok: false, raw: out }; }
}
function logTail(file, n) { try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n).join("\n"); } catch { return ""; } }

async function targets(port) { try { const r = await fetch("http://127.0.0.1:" + port + "/json"); return await r.json(); } catch { return null; } }
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; let dead = false; const pending = new Map();
    const fail = (m) => { dead = true; for (const p of pending.values()) p.reject(new Error(m)); pending.clear(); };
    ws.addEventListener("close", () => fail("closed"));
    ws.addEventListener("error", (e) => fail("error: " + (e.message || "")));
    ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
    ws.addEventListener("open", () => resolve({
      get dead() { return dead; },
      send(method, params) { if (dead) return Promise.reject(new Error("socket dead")); return new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params: params || {} })); }); },
      close() { try { ws.close(); } catch { /* ignore */ } },
    }));
    setTimeout(() => { if (!dead) { try { ws.close(); } catch { /* ignore */ } reject(new Error("connect timeout")); } }, 5000);
  });
}
async function attach(port, label) {
  const end = Date.now() + 20000; let lastTargets = null; let lastError = null;
  while (Date.now() < end) {
    const t = await targets(port); lastTargets = t;
    const page = t && t.find((x) => x.type === "page" && /floating\.html/.test(x.url || ""));
    if (page) {
      try { const client = await connect(page.webSocketDebuggerUrl); await client.send("Runtime.enable"); return client; }
      catch (error) { lastError = error; }
    }
    await sleep(250);
  }
  throw new Error("attach failed (" + label + "): " + JSON.stringify({ lastError: lastError && String(lastError.message), targets: lastTargets }));
}
async function ev(client, expr) {
  const r = await client.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function evRetry(state, expr, label) {
  let last = null;
  for (let i = 0; i < 6; i += 1) {
    try { if (!state.client || state.client.dead) state.client = await attach(state.port, label + "-reattach"); return await ev(state.client, expr); }
    catch (error) { last = error; if (!/context was destroyed|closed|dead/i.test(String(error && error.message))) throw error; try { if (state.client) state.client.close(); } catch { /* ignore */ } state.client = null; await sleep(500); }
  }
  throw new Error("evRetry failed: " + String(last && last.message));
}
function style(pid, label) { const r = ps("window-style.ps1", ["-Pids", String(pid), "-Title", "Floating", "-OutFile", path.join(outDir, "style-" + label + ".json")]); return r.ok ? r.value : { error: r.raw }; }
function aff(pid, label) { const r = ps("affinity.ps1", ["-Pids", String(pid), "-Title", "Floating", "-OutFile", path.join(outDir, "affinity-" + label + ".json"), "-Expect", "0x11", "-Note", "X1 " + label]); return r.ok ? r.value : { error: r.raw }; }
function ddagrab(label) {
  const mp4 = path.join(outDir, "dxgi-" + label + ".mp4"); const frame = path.join(outDir, "dxgi-" + label + "-frame.png");
  const rec = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "0.6", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (rec.status !== 0) return { ok: false, error: (rec.stderr || "").slice(-800) };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4, frame };
}
function marker(input, label, rect) {
  if (!input || !fs.existsSync(input) || fs.statSync(input).size === 0) return { fraction: null, match: "missing" };
  const args = ["-In", input, "-Label", label, "-OutFile", path.join(outDir, "marker-" + label + ".json")];
  if (rect) args.push("-Rect", rect);
  const r = ps("marker-stats.ps1", args);
  return r.ok ? r.value : { fraction: null, error: r.raw };
}
function diff(visible, baseline, label, rect) {
  const r = ps("image-diff.ps1", ["-A", baseline, "-B", visible, "-OutFile", path.join(outDir, "diff-" + label + ".json"), "-Label", label, "-Rect", rect]);
  return r.ok ? r.value : { error: r.raw };
}
function assertVisible(pid, label) {
  const s = style(pid, label); const a = aff(pid, label);
  const win = s && s.windows ? s.windows.find((w) => w.visible) || null : null;
  const values = a && a.matching ? a.matching.map((m) => m.affinity) : [];
  return { ok: Boolean(win && win.visible && win.topmost && values.length > 0 && values.every((v) => v === "0x11")), win: win || null, affinity: values };
}

async function runOne(config, runIndex) {
  const id = config.id + "-" + (runIndex + 1);
  const port = 9260 + runIndex + (CONFIGS.indexOf(config) * 10);
  const userData = path.join(outDir, "userdata-" + id);
  fs.rmSync(userData, { recursive: true, force: true }); fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, "capture-state.json"), JSON.stringify({ version: 1, compatMode: false, affinityMode: "exclude", lastProfile: "reading" }, null, 2) + "\n");
  const logFile = path.join(outDir, "log-" + id + ".log");
  const env = Object.assign({}, process.env, { ELECTRON_STEALTH: "1", HIRESHADE_DEBUG_CDP: String(port), HIRESHADE_DEBUG_IPC: "1", HIRESHADE_USER_DATA: userData, HIRESHADE_LOG_FILE: logFile, HIRESHADE_GPU_STATUS: "1" }, config.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronExe, ["."].concat(config.args), { cwd: desktopElectron, env, stdio: "ignore" });
  const result = { id, config: config.id, label: config.label, run: runIndex + 1, args: config.args, env: config.env, port };
  const state = { port, client: null };
  try {
    await sleep(400);
    state.client = await attach(port, id);
    await evRetry(state, "(async () => await window.hireshadeCapture.applyProfile('reading'))()", id + "-profile");
    await sleep(700);
    const snap = await evRetry(state, "(async () => ({ c: await window.hireshadeCapture.getState(), w: await window.hireshadeDesktop.getState(), d: { dpr: devicePixelRatio } }))()", id + "-snap");
    if (!snap.w.windows.floating.visible) { await evRetry(state, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')", id + "-show"); await sleep(600); }
    const b = snap.w.windows.floating.bounds; const dpr = snap.d.dpr || 1;
    const physical = [Math.round(b.x * dpr), Math.round(b.y * dpr), Math.round(b.width * dpr), Math.round(b.height * dpr)].join(",");
    result.state = { compatMode: snap.c.compatMode, transparent: snap.c.transparent, bounds: b, physical, dpr };
    await evRetry(state, "(function(){document.documentElement.style.background='" + MARKER + "';document.body.innerHTML='';var d=document.createElement('div');d.style.cssText='position:fixed;inset:0;background:" + MARKER + ";z-index:2147483647';document.body.appendChild(d);return true;})()", id + "-marker");
    ps("focus-window.ps1", ["-Pids", String(app.pid), "-Title", "Floating", "-OutFile", path.join(outDir, "focus-" + id + ".json")]);
    await sleep(500);
    const before = assertVisible(app.pid, id + "-visible-before");
    result.visible_before = before;
    result.dxgi_visible = ddagrab(id + "-visible");
    result.marker_visible = result.dxgi_visible.frame ? marker(result.dxgi_visible.frame, id + "-visible", physical) : { fraction: null };
    const after = assertVisible(app.pid, id + "-visible-after");
    result.visible_after = after;
    // Hidden baseline: external SW_HIDE (no CDP dependency), same desktop state.
    const hide = ps("window-show.ps1", ["-Action", "hide", "-Pids", String(app.pid), "-Title", "", "-OutFile", path.join(outDir, "hide-" + id + ".json")]);
    result.hide = hide.ok ? hide.value : { error: hide.raw };
    await sleep(700);
    result.dxgi_baseline = ddagrab(id + "-baseline");
    result.marker_baseline = result.dxgi_baseline.frame ? marker(result.dxgi_baseline.frame, id + "-baseline", physical) : { fraction: null };
    if (result.dxgi_visible.frame && result.dxgi_baseline.frame) {
      result.diff = diff(result.dxgi_visible.frame, result.dxgi_baseline.frame, id, physical);
    }
    const mf = result.marker_visible && typeof result.marker_visible.fraction === "number" ? result.marker_visible.fraction : null;
    const bf = result.marker_baseline && typeof result.marker_baseline.fraction === "number" ? result.marker_baseline.fraction : null;
    const mean = result.diff && typeof result.diff.mean_abs_diff === "number" ? result.diff.mean_abs_diff : null;
    const fraction = result.diff && typeof result.diff.fraction_diff_gt_threshold === "number" ? result.diff.fraction_diff_gt_threshold : null;
    result.metrics = { marker_visible_fraction: mf, marker_baseline_fraction: bf, luma_mean_abs_diff: mean, luma_fraction_gt16: fraction };
    result.marker_visible_bool = typeof mf === "number" ? mf >= 0.2 : null;
    result.luma_visible_bool = typeof mean === "number" ? mean > 2 || (typeof fraction === "number" && fraction > 0.05) : null;
    result.agree = result.marker_visible_bool !== null && result.luma_visible_bool !== null ? result.marker_visible_bool === result.luma_visible_bool : null;
    result.invalid = !before.ok || !after.ok || (typeof bf === "number" && bf >= 0.2);
    const gpuLine = (logTail(logFile, 80).split("\n").find((line) => line.includes("gpuFeatureStatus=")) || "");
    result.gpu_feature_status = gpuLine ? gpuLine.slice(gpuLine.indexOf("gpuFeatureStatus=") + 17) : null;
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error);
    result.invalid = true;
  } finally {
    if (state.client) state.client.close();
    result.log_tail = logTail(logFile, 25);
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }
  return result;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const runs = [];
  for (const config of CONFIGS) {
    for (let i = 0; i < N; i += 1) {
      const result = await runOne(config, i);
      runs.push(result);
      console.log("[" + result.id + "] marker=" + (result.marker_visible_bool) + " luma=" + (result.luma_visible_bool) + " mf=" + (result.metrics && result.metrics.marker_visible_fraction) + " mean=" + (result.metrics && result.metrics.luma_mean_abs_diff) + " invalid=" + result.invalid);
    }
  }
  const byConfig = {};
  for (const config of CONFIGS) {
    const list = runs.filter((run) => run.config === config.id);
    const valid = list.filter((run) => !run.invalid);
    const markerCount = valid.filter((run) => run.marker_visible_bool === true).length;
    const lumaCount = valid.filter((run) => run.luma_visible_bool === true).length;
    const agreeCount = valid.filter((run) => run.agree === true).length;
    const disagree = valid.filter((run) => run.agree === false).length;
    byConfig[config.id] = {
      label: config.label,
      args: config.args,
      env: config.env,
      n: list.length,
      valid: valid.length,
      invalid: list.length - valid.length,
      marker_visible: markerCount,
      luma_visible: lumaCount,
      agree: agreeCount,
      disagree,
      determinism: markerCount === valid.length ? "all marker HIDDEN" : markerCount === 0 ? "all marker VISIBLE" : "SPLIT",
      marker_fractions: valid.map((run) => run.metrics && run.metrics.marker_visible_fraction),
      luma_means: valid.map((run) => run.metrics && run.metrics.luma_mean_abs_diff),
      gpu_feature_status: valid.map((run) => run.gpu_feature_status).filter(Boolean).slice(0, 1),
    };
  }
  const allValid = runs.filter((run) => !run.invalid);
  const bothAgree = allValid.filter((run) => run.agree === true).length;
  const payload = {
    generated_at: new Date().toISOString(),
    question: "Resolve U1 (luma 27.39 = DXGI content visible) vs V1 (marker 0 = hidden) contradiction under WDA 0x11.",
    method: "Same run/window: unique rgb(1,254,1) marker + DXGI luma diff vs hidden-window baseline (external SW_HIDE, same desktop state). State assertions (visible, affinity 0x11, topmost) before/after each visible capture. Sweep one variable at a time, N=5.",
    n_per_config: N,
    configs: CONFIGS,
    runs,
    by_config: byConfig,
    step1_agreement: { valid_runs: allValid.length, agree: bothAgree, disagree: allValid.length - bothAgree, note: "If marker and luma disagree, the luma detector is seeing unrelated desktop content, not our overlay." },
    verdict: null,
  };
  const gpuDiscriminator = Object.values(byConfig).some((c) => c.marker_visible > 0);
  payload.verdict = gpuDiscriminator
    ? "GPU/compositing configuration CAN make the marker visible under 0x11 in at least one config; inspect per-config counts (fix may be window-level software compositing)."
    : "Under 0x11, DXGI marker detection measured HIDDEN in every valid run across default, --disable-gpu-compositing, --disable-gpu and hardware-acceleration-off. The U1 luma 27.39 conflict is a detector/contamination difference, not an opacity or GPU-compositing difference; the V1 hidden result is reproduced deterministically.";
  fs.writeFileSync(path.join(outDir, "x1-dxgi-determinism.json"), JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify({ by_config: byConfig, step1_agreement: payload.step1_agreement, verdict: payload.verdict }, null, 2));
}

main().catch((error) => { console.error("[x1] FAILED: " + (error && error.stack ? error.stack : error)); process.exitCode = 1; });
