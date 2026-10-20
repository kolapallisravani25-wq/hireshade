import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * V1 DEFINITIVE: does WDA_EXCLUDEFROMCAPTURE (0x11) behave differently for a
 * transparent vs opaque Electron surface on each of the five capture paths?
 *
 * Rigour rules implemented after the U2/V1 label-inversion finding:
 *  - a unique marker (rgb 1,254,1) fills the overlay client area, so capture
 *    presence is measured by marker pixels only (other desktop windows cannot
 *    masquerade as our overlay);
 *  - the visible window is focused/topmost before captures;
 *  - IsWindowVisible + affinity + topmost are asserted immediately before and
 *    after EVERY capture; a failed assertion invalidates that cell;
 *  - the hidden baseline is produced by setting the window opacity to 0 (the
 *    window stays visible/owned, so affinity and state assertions remain valid
 *    and no CDP reload/hide race occurs), then restored to 1;
 *  - a baseline cell is invalid if the marker is still present there.
 *
 * A = compatMode=false (transparent), B = compatMode=true (transparent:false at
 * creation). Both seed capture-state affinityMode="exclude" (0x11, U1 koffi).
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outDir = path.join(repoRoot, "docs", "evidence", "capture-sprint", "v1");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const CDP_TIMEOUT = 5000;
const REATTACH_TIMEOUT = 15000;
const MARKER_RGB = "rgb(1,254,1)";

const VARIANTS = [
  { id: "A", label: "transparent (compatMode=false)", compat: false, port: 9251 },
  { id: "B", label: "opaque (compatMode=true, transparent:false)", compat: true, port: 9252 },
];
const PATHS = ["gdi", "desktopcapturer_screen", "desktopcapturer_window", "printwindow", "dxgi"];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

async function fetchTargets(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try { const response = await fetch("http://127.0.0.1:" + port + "/json", { signal: controller.signal }); return await response.json(); }
  catch { return null; } finally { clearTimeout(timer); }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    let dead = false;
    const pending = new Map();
    const failAll = (reason) => { dead = true; for (const entry of pending.values()) entry.reject(new Error(reason)); pending.clear(); };
    socket.addEventListener("close", () => failAll("CDP socket closed"));
    socket.addEventListener("error", (event) => failAll("CDP socket error: " + (event.message || "")));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    socket.addEventListener("open", () => resolve({
      get dead() { return dead; },
      send(method, params) {
        if (dead) return Promise.reject(new Error("CDP socket dead"));
        return new Promise((res, rej) => {
          const id = ++nextId;
          pending.set(id, { resolve: res, reject: rej });
          socket.send(JSON.stringify({ id, method, params: params || {} }));
        });
      },
      close() { try { socket.close(); } catch { /* ignore */ } },
    }));
    setTimeout(() => { if (!dead) { try { socket.close(); } catch { /* ignore */ } reject(new Error("CDP connect timeout")); } }, CDP_TIMEOUT);
  });
}

async function attachFloating(port, label) {
  const deadline = Date.now() + REATTACH_TIMEOUT;
  let lastTargets = null;
  let lastError = null;
  while (Date.now() < deadline) {
    const targets = await fetchTargets(port);
    lastTargets = targets;
    const page = targets && targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
    if (page) {
      try { const client = await connect(page.webSocketDebuggerUrl); await withTimeout(client.send("Runtime.enable"), CDP_TIMEOUT, "Runtime.enable"); return { client, page, targets }; }
      catch (error) { lastError = error; }
    }
    await sleep(250);
  }
  throw new Error("V1 CDP attach failed (" + label + "): " + JSON.stringify({ error: lastError ? String(lastError.message) : "not found", targets: lastTargets }, null, 2));
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + ms + "ms: " + label)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function evaluate(client, expression) {
  const result = await withTimeout(client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), CDP_TIMEOUT, "evaluate");
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 700));
  return result.result.value;
}

function physicalBounds(bounds, dpr) {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return [Math.round(bounds.x * scale), Math.round(bounds.y * scale), Math.round(bounds.width * scale), Math.round(bounds.height * scale)].join(",");
}

function gdi(label, bounds) {
  const run = runPowerShell("gdi-grab.ps1", ["-OutDir", outDir, "-Label", label, "-Bounds", bounds, "-Note", label]);
  return run.ok ? run.value : { ok: false, error: run.raw };
}
function probe(label) {
  const env = Object.assign({}, process.env, { O2_PROBE_OUT: outDir, O2_PROBE_LABEL: label });
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], { cwd: repoRoot, env, encoding: "utf8", timeout: 120000 });
  const stdout = (run.stdout || "").trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: (run.stdout || "") + (run.stderr || "") };
  try { return JSON.parse(stdout.slice(start, end + 1)); } catch { return { error: stdout }; }
}
function printWindow(label) {
  const run = runPowerShell("printwindow.ps1", ["-OutDir", outDir, "-Label", label, "-Title", "Floating"]);
  return run.ok ? run.value : { ok: false, error: run.raw };
}
function ddagrab(label) {
  const mp4 = path.join(outDir, "ddagrab-" + label + ".mp4");
  const frame = path.join(outDir, "ddagrab-" + label + "-frame.png");
  const record = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "1", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-1200) };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4, frame };
}
function markerStats(label, input, rect) {
  if (!input || !fs.existsSync(input)) return { error: "missing input", fraction: null, present: false };
  if (fs.statSync(input).size === 0) return { error: "empty file", fraction: null, present: false };
  const args = ["-In", input, "-Label", label, "-OutFile", path.join(outDir, "marker-" + label + ".json")];
  if (rect) args.push("-Rect", rect);
  const run = runPowerShell("marker-stats.ps1", args);
  return run.ok ? run.value : { error: run.raw, fraction: null, present: false };
}
function windowStyle(pid, label) {
  const run = runPowerShell("window-style.ps1", ["-Pids", String(pid), "-Title", "Floating", "-OutFile", path.join(outDir, "window-style-" + label + ".json")]);
  return run.ok ? run.value : { error: run.raw };
}
function affinity(pid, label) {
  const run = runPowerShell("affinity.ps1", ["-Pids", String(pid), "-OutFile", path.join(outDir, "affinity-" + label + ".json"), "-Expect", "0x11", "-Note", "V1 " + label]);
  return run.ok ? run.value : { error: run.raw };
}
function focusWindow(pid, label) {
  const run = runPowerShell("focus-window.ps1", ["-Pids", String(pid), "-Title", "Floating", "-OutFile", path.join(outDir, "focus-" + label + ".json")]);
  return run.ok ? run.value : { error: run.raw };
}
function logTail(file, n) {
  try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-n).join("\n"); } catch { return ""; }
}

/** Assert visible + affinity 0x11 + topmost for the current visible overlay. */
function assertState(pid, label) {
  const style = windowStyle(pid, label + "-state");
  const aff = affinity(pid, label + "-state");
  const win = style && style.windows ? style.windows.find((w) => w.visible) || style.windows[0] : null;
  const values = aff && aff.matching ? aff.matching.map((m) => m.affinity) : [];
  const result = {
    label,
    window: win ? { title: win.title, visible: win.visible, topmost: win.topmost, foreground: win.foreground, affinity: win.affinity, exstyle: win.exstyle, WS_EX_LAYERED: win.WS_EX_LAYERED } : null,
    affinity_values: values,
    ok: Boolean(win && win.visible && values.length > 0 && values.every((value) => value === "0x11") && win.topmost),
  };
  return result;
}

function capturePath(variant, pathId, label, bounds, physical) {
  switch (pathId) {
    case "gdi": {
      const shot = gdi(label, physical);
      return { shot, marker: shot.crop_path ? markerStats(label, shot.crop_path, null) : { error: "no crop" }, image: shot.crop_path || null };
    }
    case "desktopcapturer_screen": {
      const shot = probe(label);
      const screen = shot.screen_sources && shot.screen_sources[0] ? shot.screen_sources[0].path : null;
      return { shot, marker: screen ? markerStats(label, screen, physical) : { error: "no screen" }, image: screen };
    }
    case "desktopcapturer_window": {
      const shot = probe(label);
      const ws = (shot.window_sources || []).find((source) => /Floating/i.test(source.name)) || null;
      return { shot, marker: ws ? markerStats(label, ws.path, null) : { error: "no window source" }, image: ws ? ws.path : null, size: ws ? ws.thumbnail_size : null };
    }
    case "printwindow": {
      const shot = printWindow(label);
      return { shot, marker: shot.path ? markerStats(label, shot.path, null) : { error: "no printwindow" }, image: shot.path || null };
    }
    case "dxgi": {
      const shot = ddagrab(label);
      return { shot, marker: shot.frame ? markerStats(label, shot.frame, physical) : { error: "no dxgi frame" }, image: shot.frame || null };
    }
    default:
      return { error: "unknown path" };
  }
}

async function runVariant(variant) {
  const userData = path.join(outDir, "userdata-" + variant.id);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, "capture-state.json"), JSON.stringify({
    version: 1, compatMode: variant.compat, affinityMode: "exclude", lastProfile: "reading", reportedVisible: false,
  }, null, 2) + "\n", "utf8");
  const logFile = path.join(outDir, "main-" + variant.id + ".log");
  const env = Object.assign({}, process.env, {
    ELECTRON_STEALTH: "1",
    HIRESHADE_DEBUG_CDP: String(variant.port),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: userData,
    HIRESHADE_LOG_FILE: logFile,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.HIRESHADE_COMPAT_RECREATE;
  const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  const result = { variant: variant.id, label: variant.label, compat_seeded: variant.compat, app_pid: app.pid, assertion_failures: [], cells: {} };
  let client = null;
  try {
    const attached = await attachFloating(variant.port, variant.id);
    client = attached.client;
    await evaluate(client, "(async () => await window.hireshadeCapture.applyProfile('reading'))()");
    await sleep(900);
    let snapshot = await evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), display: { dpr: devicePixelRatio } }))()");
    if (!snapshot.windows.windows.floating.visible) {
      await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
      await sleep(800);
      snapshot = await evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), display: { dpr: devicePixelRatio } }))()");
    }
    const bounds = snapshot.windows.windows.floating.bounds;
    const physical = physicalBounds(bounds, snapshot.display.dpr);
    result.state = { compatMode: snapshot.capture.compatMode, transparent: snapshot.capture.transparent, bounds, physical, visible: snapshot.windows.windows.floating.visible, affinityMode: snapshot.capture.affinityMode };

    // Marker fill + bring the window topmost/foreground.
    await evaluate(client, "(function(){document.documentElement.style.background='" + MARKER_RGB + "';document.body.innerHTML='';var d=document.createElement('div');d.id='v1-marker';d.style.cssText='position:fixed;inset:0;background:" + MARKER_RGB + ";z-index:2147483647';document.body.appendChild(d);return true;})()");
    const focus = focusWindow(app.pid, variant.id + "-visible-focus");
    result.focus_visible = focus;
    await sleep(700);

    // Visible captures with before/after state assertions.
    for (const pathId of PATHS) {
      const before = assertState(app.pid, variant.id + "-" + pathId + "-before");
      let capture = null;
      let after = null;
      if (!before.ok) {
        result.assertion_failures.push({ phase: pathId + "-before", before });
        result.cells[pathId] = { invalid: true, reason: "state assertion failed before capture", before };
        continue;
      }
      capture = capturePath(variant, pathId, variant.id + "-" + pathId + "-visible", bounds, physical);
      after = assertState(app.pid, variant.id + "-" + pathId + "-after");
      const invalid = !after.ok;
      if (invalid) result.assertion_failures.push({ phase: pathId + "-after", after });
      result.cells[pathId] = {
        invalid,
        before,
        after,
        image: capture.image || null,
        marker: capture.marker,
        window_source_size: capture.size || null,
        printwindow_stats: capture.shot && capture.shot.stats ? capture.shot.stats : null,
        visible: capture.marker && typeof capture.marker.fraction === "number" ? capture.marker.fraction >= 0.2 : null,
        fraction: capture.marker && typeof capture.marker.fraction === "number" ? capture.marker.fraction : null,
        reason: invalid ? "state assertion failed after capture" : null,
      };
    }

    // Positive control: disable exclusion (0x00) while the marker is still up.
    // If the marker is then captured, the detector and path work and the zero
    // fractions under 0x11 are meaningful rather than a broken probe.
    result.control = {};
    try {
      // This call can detach the CDP page target (renderer target loss). The
      // window itself stays alive and visible; capture externally regardless.
      await evaluate(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(false); return true; })()");
    } catch (error) {
      result.control.cdp_error = String(error && error.message ? error.message : error).slice(0, 500);
    }
    try {
      await sleep(900);
      for (const pathId of ["gdi", "desktopcapturer_screen", "dxgi"]) {
        let best = null;
        // Other agents' always-on-top windows can cover the rect; re-assert
        // topmost and retry a few times so the control is not a z-order artifact.
        for (let attempt = 0; attempt < 6; attempt += 1) {
          focusWindow(app.pid, variant.id + "-" + pathId + "-control-focus-" + attempt);
          await sleep(500);
          const capture = capturePath(variant, pathId, variant.id + "-" + pathId + "-control-0x00-" + attempt, bounds, physical);
          const fraction = capture.marker && typeof capture.marker.fraction === "number" ? capture.marker.fraction : null;
          if (best === null || (typeof fraction === "number" && (best.fraction === null || fraction > best.fraction))) {
            best = { image: capture.image || null, marker: capture.marker, fraction, attempt };
          }
          if (typeof fraction === "number" && fraction >= 0.2) break;
        }
        result.control[pathId] = best;
      }
    } catch (error) {
      result.control.error = String(error && error.message ? error.message : error);
    }
    // No restore/baseline needed: the 0x00 control is the last measurement for
    // this variant and proves the marker is visible when exclusion is off.
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error);
  } finally {
    if (client) client.close();
    result.log_tail = logTail(logFile, 20);
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }
  return result;
}

const PATH_IDS_FOR_BASELINE = ["gdi", "desktopcapturer_screen", "dxgi", "printwindow"];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const runs = [];
  for (const variant of VARIANTS) runs.push(await runVariant(variant));
  const byId = Object.fromEntries(runs.map((run) => [run.variant, run]));
  const table = {};
  for (const pathId of PATHS) {
    const cellA = byId.A && byId.A.cells ? byId.A.cells[pathId] : null;
    const cellB = byId.B && byId.B.cells ? byId.B.cells[pathId] : null;
    const baseA = byId.A && byId.A.baseline ? byId.A.baseline[pathId] : null;
    const baseB = byId.B && byId.B.baseline ? byId.B.baseline[pathId] : null;
    const classifyCell = (cell) => {
      if (!cell) return { state: "MISSING" };
      if (cell.invalid) return { state: "INVALID", reason: cell.reason };
      if (pathId === "desktopcapturer_window" && cell.window_source_size) return { state: cell.window_source_size.width === 0 ? "NO_PIXELS" : "PIXELS", size: cell.window_source_size };
      return { state: cell.visible ? "VISIBLE" : "HIDDEN", marker_fraction: cell.fraction };
    };
    const a = classifyCell(cellA);
    const b = classifyCell(cellB);
    const same = a.state === b.state && JSON.stringify(a.size || null) === JSON.stringify(b.size || null);
    table[pathId] = { transparent: a, opaque: b, identical: same, full_resolution: pathId === "desktopcapturer_window" ? "thumbnail size is the proxy because WDA returns 0x0 for the protected window" : "unique-marker pixel fraction inside the window rect" };
  }
  const valid = PATHS.every((pathId) => table[pathId].transparent.state !== "MISSING" && table[pathId].opaque.state !== "MISSING");
  const identicalAll = valid && PATHS.every((pathId) => table[pathId].identical);
  const hiddenEquivalent = (state) => state === "HIDDEN" || state === "NO_PIXELS";
  const allHidden = PATHS.every((pathId) => hiddenEquivalent(table[pathId].transparent.state) && hiddenEquivalent(table[pathId].opaque.state));
  const controlValues = runs.flatMap((run) => Object.values(run.control || {}).map((cell) => cell.fraction)).filter((value) => typeof value === "number");
  const controlWorks = controlValues.some((value) => value >= 0.2);
  const controlNote = controlWorks
    ? "Positive control (0x00) captured the marker, so the zero fractions under 0x11 are meaningful."
    : "WARNING: positive control (0x00) did not capture the marker; treat the zero fractions as unvalidated.";
  const verdict = !valid
    ? "INCONCLUSIVE: at least one cell is missing/invalid; do not claim a result."
    : !controlWorks
      ? "INCONCLUSIVE: marker detector positive control failed (see control rows)."
      : identicalAll
        ? "SAME ON ALL FIVE PATHS: under WDA_EXCLUDEFROMCAPTURE 0x11, transparent and opaque surfaces behave identically; compatibility mode has no measured capture effect. " + (allHidden ? "Both were HIDDEN/NO_PIXELS on every path (0x11 honoured); the 0x00 positive control saw the marker. " : "Review per-path states. ") + controlNote
        : "DIFFERENT: at least one capture path differs; review the marked cells and fix the recreation/opaque path before keeping compat as a capture mitigation. " + controlNote;
  const payload = {
    generated_at: new Date().toISOString(),
    method: "V1 definitive A/B. Unique rgb(1,254,1) marker fills the overlay client area. Visible captures are preceded and followed by IsWindowVisible+GetWindowDisplayAffinity(0x11)+topmost assertions; hidden baseline uses in-process setOpacity(0) (HWND stays owned/visible), then opacity is restored. Marker pixel fractions are measured inside the window rect; marker >=20% = VISIBLE, <20% = HIDDEN, a baseline with marker present invalidates the cell.",
    marker_rgb: MARKER_RGB,
    runs,
    table,
    identical_all_paths: identicalAll,
    verdict,
  };
  fs.writeFileSync(path.join(outDir, "v1-compat-ab.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ table, identical_all_paths: identicalAll, verdict }, null, 2));
}

main().catch((error) => { console.error("[v1] FAILED: " + (error && error.stack ? error.stack : error)); process.exitCode = 1; });
