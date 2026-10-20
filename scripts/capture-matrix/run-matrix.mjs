import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * O2 capture matrix orchestrator.
 *
 * Drives the real Electron shell over CDP:
 *   - applies size profiles (card/banner/reading), preset/resize/move/display
 *     transitions and compatibility mode
 *   - asserts GetWindowDisplayAffinity == 0x11 after every transition
 *   - runs real capture paths A/B (stealth ON vs OFF vs hidden baseline):
 *       GDI BitBlt (System.Drawing CopyFromScreen)
 *       Chromium desktopCapturer (screen + window sources)
 *       PrintWindow (user32)
 *       ffmpeg gdigrab (GDI recording)
 *       ffmpeg ddagrab (DXGI Desktop Duplication, if the build supports it)
 *   - exercises the self-check UI and the compatibility-mode auto-suggestion
 *   - writes docs/evidence/overlay-size/matrix-evidence.json + frames/recordings
 *
 * Usage: node scripts/capture-matrix/run-matrix.mjs
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "overlay-size");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const CDP_PORT = Number(process.env.O2_CDP_PORT || 9226);
const SCREENSHOT_SCALE = 1;

let trackedAppPid = null;

const results = {
  generated_at: new Date().toISOString(),
  environment: {
    platform: process.platform,
    host: process.env.COMPUTERNAME || "unknown",
    node: process.version,
    electron: requireFromDesktop("electron/package.json").version,
    cdp_port: CDP_PORT,
    displays: null,
    note: "Single-display Windows host. Real monitor unplug/plug is UNTESTED; the display-change code path is simulated through the debug IPC. DPI change is simulated with --force-device-scale-factor.",
  },
  transitions: [],
  capture_trials: [],
  compatibility: {},
  self_check: {},
  dpi_simulation: null,
  dxgi: null,
  untested: [],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowLabel(prefix) {
  return prefix;
}

function runPowerShell(scriptName, args) {
  const scriptPath = path.join(repoRoot, "scripts", "capture-matrix", scriptName);
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120000,
  });
  const stdout = (run.stdout || "").trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (run.status !== 0 || start < 0 || end <= start) {
    return { ok: false, raw: stdout + "\n" + (run.stderr || ""), status: run.status };
  }
  try {
    return { ok: true, value: JSON.parse(stdout.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, raw: stdout + "\n" + (run.stderr || ""), parseError: String(error) };
  }
}

function parseJsonLoose(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function waitForPages(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + CDP_PORT + "/json");
      const targets = await response.json();
      const pages = targets.filter((target) => target.type === "page" && /(floating|launcher)\.html/.test(target.url || ""));
      if (pages.length > 0) return pages;
      lastError = new Error("no overlay page targets yet");
    } catch (error) {
      lastError = error;
    }
    await sleep(400);
  }
  throw lastError || new Error("timed out waiting for overlay pages");
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
    socket.addEventListener("error", (event) => {
      reject(new Error("CDP socket error: " + (event.message || "unknown")));
    });
    socket.addEventListener("open", () => {
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
            // already closed
          }
        },
      });
    });
  });
}

async function connectFloating() {
  const pages = await waitForPages(30000);
  const page = pages.find((candidate) => /floating\.html/.test(candidate.url)) || pages[0];
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  return { client, page };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error("evaluation failed: " + JSON.stringify(result.exceptionDetails).slice(0, 800));
  }
  return result.result.value;
}

async function callBridge(client, expression, label) {
  try {
    return await evaluate(client, expression);
  } catch (error) {
    console.warn("[matrix] bridge call failed (" + label + "): " + error.message);
    return null;
  }
}

function assertAffinity(label, note, expect = "0x11", pidOverride = null) {
  const outFile = path.join(evidenceDir, "affinity-" + label + ".json");
  const args = ["-OutFile", outFile, "-Expect", expect, "-Note", note || label];
  const pid = pidOverride || trackedAppPid;
  if (pid) args.push("-Pids", String(pid));
  const run = runPowerShell("affinity.ps1", args);
  const value = run.ok ? run.value : { pass: false, error: run.raw };
  results.transitions.push({
    label,
    note: note || label,
    captured_at: new Date().toISOString(),
    expect,
    affinity: value,
  });
  console.log("[matrix] affinity " + label + " -> " + (value.pass ? "PASS" : "FAIL") + " " + JSON.stringify((value.matching || []).map((m) => m.affinity)));
  return value;
}

function gdiGrab(label, bounds, note) {
  const args = ["-OutDir", evidenceDir, "-Label", label];
  if (bounds) args.push("-Bounds", bounds);
  if (note) args.push("-Note", note);
  const run = runPowerShell("gdi-grab.ps1", args);
  return run.ok ? run.value : { error: run.raw };
}

function imageDiff(label, aPath, bPath) {
  const outFile = path.join(evidenceDir, "diff-" + label + ".json");
  const run = runPowerShell("image-diff.ps1", ["-A", aPath, "-B", bPath, "-OutFile", outFile, "-Label", label]);
  return run.ok ? run.value : { error: run.raw };
}

function printWindow(label) {
  const run = runPowerShell("printwindow.ps1", ["-OutDir", evidenceDir, "-Label", label]);
  return run.ok ? run.value : { error: run.raw };
}

function desktopCapturerProbe(label) {
  const env = Object.assign({}, process.env, {
    O2_PROBE_OUT: evidenceDir,
    O2_PROBE_LABEL: label,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  const parsed = parseJsonLoose(run.stdout || "");
  return parsed || { error: (run.stdout || "") + "\n" + (run.stderr || ""), status: run.status };
}

function ffmpegRecording(label) {
  const outFile = path.join(evidenceDir, "gdigrab-" + label + ".mp4");
  const frameFile = path.join(evidenceDir, "gdigrab-" + label + "-frame.png");
  const record = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "gdigrab", "-framerate", "10", "-t", "2", "-i", "desktop", "-pix_fmt", "yuv420p", outFile],
    { encoding: "utf8", timeout: 120000 },
  );
  if (record.status !== 0) return { ok: false, error: record.stderr, mp4: outFile };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outFile, "-frames:v", "1", frameFile], {
    encoding: "utf8",
    timeout: 60000,
  });
  return { ok: true, mp4: outFile, frame: frameFile };
}

function ddagrabRecording(label) {
  const outFile = path.join(evidenceDir, "ddagrab-" + label + ".mp4");
  const frameFile = path.join(evidenceDir, "ddagrab-" + label + "-frame.png");
  const record = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "ddagrab=0:framerate=10",
      "-t",
      "2",
      "-vf",
      "hwdownload,format=bgra",
      outFile,
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-2000), mp4: outFile };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", outFile, "-frames:v", "1", frameFile], {
    encoding: "utf8",
    timeout: 60000,
  });
  return { ok: true, mp4: outFile, frame: frameFile };
}

function boundsString(bounds) {
  return [bounds.x, bounds.y, bounds.width, bounds.height].join(",");
}

/** Electron bounds are DIP; the Windows capture APIs use physical pixels. */
function physicalBoundsString(bounds, scaleFactor) {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return [
    Math.round(bounds.x * scale),
    Math.round(bounds.y * scale),
    Math.round(bounds.width * scale),
    Math.round(bounds.height * scale),
  ].join(",");
}

async function state(client) {
  return evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), overlay: await window.hireshadeDesktop.getState(), display: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, dpr: devicePixelRatio } }))()");
}

function windowBoundsFromState(snapshot) {
  const floating = snapshot && snapshot.overlay && snapshot.overlay.windows ? snapshot.overlay.windows.floating : null;
  return floating && floating.bounds ? floating.bounds : null;
}

async function setPrivate(client, value) {
  return callBridge(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(" + Boolean(value) + "); return (await window.hireshadeCapture.getState()).reportedVisible; })()", "setPrivate " + value);
}

async function applyProfile(client, profile) {
  return callBridge(client, "(async () => { const s = await window.hireshadeCapture.applyProfile('" + profile + "'); return s; })()", "applyProfile " + profile);
}

async function hideAll(client) {
  return callBridge(client, "window.hireshadeDesktop.debugInvokeAction('panic-hide')", "panic-hide");
}

async function showOverlay(client) {
  const snapshot = await state(client);
  const visible = snapshot.overlay.windows.floating.visible;
  if (!visible) {
    await callBridge(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')", "toggle-overlay");
    await sleep(600);
  }
  return state(client);
}

async function toggleCompat(client, enabled) {
  // Fire and forget: enabling compatibility recreates the window, destroying the
  // current CDP target. Then reconnect and read the state from the new window.
  await callBridge(
    client,
    "setTimeout(function () { window.hireshadeCapture.setCompatMode(" + Boolean(enabled) + ").catch(function(){}); }, 0); true",
    "setCompatMode " + enabled,
  ).catch(() => null);
  await sleep(2600);
  return connectFloating();
}

function recordTrial(trial) {
  results.capture_trials.push(trial);
  console.log("[matrix] trial " + trial.profile + "/" + trial.path + " verdict=" + trial.verdict);
}

function classifyExclusion(baselineDiff, onDiff, offDiff) {
  const onHidden = onDiff.fraction_diff_gt_threshold <= Math.max(0.002, offDiff.fraction_diff_gt_threshold / 8);
  const offVisible = offDiff.fraction_diff_gt_threshold > Math.max(0.004, baselineDiff || 0.004);
  if (onHidden && offVisible) return "HONORS_EXCLUSION";
  if (!onHidden && offVisible) return "VISIBLE_IN_CAPTURE";
  if (!offVisible && !onHidden) return "INCONCLUSIVE_STATIC_DESKTOP";
  return "PARTIAL";
}

async function captureTrial(client, profile) {
  // Ensure clean starting state.
  await showOverlay(client);
  await setPrivate(client, true);
  await applyProfile(client, profile);
  await sleep(900);
  const before = await state(client);
  const bounds = windowBoundsFromState(before);
  const boundsStr = bounds && before.display ? physicalBoundsString(bounds, before.display.dpr) : undefined;
  const affinityOn = assertAffinity(profile + "-stealth-on", "after profile change to " + profile);

  const gdiOn = gdiGrab(profile + "-stealth-on", boundsStr, "stealth ON, " + profile);
  const probeOn = desktopCapturerProbe(profile + "-stealth-on");
  const printOn = printWindow(profile + "-stealth-on");
  const recordOn = ffmpegRecording(profile + "-stealth-on");

  // Hidden baseline: same crop rect, overlay hidden.
  await hideAll(client);
  await sleep(700);
  const gdiHidden = gdiGrab(profile + "-hidden-baseline", boundsStr, "hidden baseline, " + profile);
  const probeHidden = desktopCapturerProbe(profile + "-hidden-baseline");

  // Stealth OFF (capturable).
  await showOverlay(client);
  await setPrivate(client, false);
  await sleep(900);
  // Private mode OFF intentionally has no exclusion (affinity 0x0 is expected).
  const affinityOff = assertAffinity(profile + "-stealth-off", "after disabling private mode (no exclusion expected)", "any");
  const gdiOff = gdiGrab(profile + "-stealth-off", boundsStr, "stealth OFF, " + profile);
  const probeOff = desktopCapturerProbe(profile + "-stealth-off");
  const printOff = printWindow(profile + "-stealth-off");
  const recordOff = ffmpegRecording(profile + "-stealth-off");

  // Restore private mode.
  await setPrivate(client, true);
  await sleep(500);

  const gdiOnDiff = gdiHidden.crop_path && gdiOn.crop_path ? imageDiff(profile + "-gdi-on-vs-baseline", gdiHidden.crop_path, gdiOn.crop_path) : { error: "missing gdi images" };
  const gdiOffDiff = gdiHidden.crop_path && gdiOff.crop_path ? imageDiff(profile + "-gdi-off-vs-baseline", gdiHidden.crop_path, gdiOff.crop_path) : { error: "missing gdi images" };
  const probeOnPath = probeOn.screen_sources && probeOn.screen_sources[0] ? probeOn.screen_sources[0].path : null;
  const probeHiddenPath = probeHidden.screen_sources && probeHidden.screen_sources[0] ? probeHidden.screen_sources[0].path : null;
  const probeOffPath = probeOff.screen_sources && probeOff.screen_sources[0] ? probeOff.screen_sources[0].path : null;
  const probeOnDiff = probeHiddenPath && probeOnPath ? imageDiff(profile + "-desktopcapturer-on-vs-baseline", probeHiddenPath, probeOnPath) : { error: "missing desktopCapturer images" };
  const probeOffDiff = probeHiddenPath && probeOffPath ? imageDiff(profile + "-desktopcapturer-off-vs-baseline", probeHiddenPath, probeOffPath) : { error: "missing desktopCapturer images" };
  const printDiff = printOn.path && printOff.path ? imageDiff(profile + "-printwindow-on-vs-off", printOn.path, printOff.path) : { error: "missing PrintWindow images" };
  const recordOnDiff = recordOn.frame && recordOn.frame ? null : null;

  const gdiVerdict = gdiOnDiff.fraction_diff_gt_threshold !== undefined ? classifyExclusion(0.0005, gdiOnDiff, gdiOffDiff) : "ERROR";
  const probeVerdict = probeOnDiff.fraction_diff_gt_threshold !== undefined ? classifyExclusion(0.0005, probeOnDiff, probeOffDiff) : "ERROR";

  recordTrial({
    profile,
    path: "gdi-copyfromscreen",
    method: "GDI BitBlt via System.Drawing CopyFromScreen, cropped to the overlay rectangle; hidden baseline same rect",
    affinity_stealth_on: affinityOn,
    affinity_stealth_off: affinityOff,
    baseline: gdiHidden,
    stealth_on: gdiOn,
    stealth_off: gdiOff,
    diffs: { on_vs_baseline: gdiOnDiff, off_vs_baseline: gdiOffDiff },
    verdict: gdiVerdict,
    notes: "Expected: HONORS_EXCLUSION (GDI respects WDA_EXCLUDEFROMCAPTURE).",
  });

  recordTrial({
    profile,
    path: "chromium-desktopcapturer-screen",
    method: "Electron desktopCapturer.getSources({types:['screen']}) thumbnail at physical resolution; full-screen diff hidden-vs-on/off",
    baseline: probeHidden,
    stealth_on: probeOn,
    stealth_off: probeOff,
    diffs: { on_vs_baseline: probeOnDiff, off_vs_baseline: probeOffDiff },
    verdict: probeVerdict,
    notes: "Chromium's Windows screen-capture path (WGC/DXGI depending on OS build).",
  });

  recordTrial({
    profile,
    path: "printwindow",
    method: "user32 PrintWindow(PW_RENDERFULLCONTENT=2 first, fallback 0) into a bitmap; ON vs OFF window content diff",
    stealth_on: printOn,
    stealth_off: printOff,
    diffs: { on_vs_off: printDiff },
    verdict:
      printDiff.fraction_diff_gt_threshold !== undefined
        ? printDiff.fraction_diff_gt_threshold > 0.02
          ? "VISIBLE_IN_CAPTURE (PrintWindow bypassed or rendered content differently)"
          : "INCONCLUSIVE_OR_BLACK"
        : "ERROR",
    notes: "PrintWindow is a window-content path, not a desktop-share path; a visible result here is a real gap for tools that use it.",
  });

  recordTrial({
    profile,
    path: "ffmpeg-gdigrab",
    method: "ffmpeg -f gdigrab -framerate 10 -t 2 desktop (GDI recording); A/B ON vs OFF recordings saved",
    stealth_on: recordOn,
    stealth_off: recordOff,
    verdict: "RECORDED_FOR_MANUAL_REVIEW",
    notes: "Frames extracted next to the mp4s; compare with the hidden baseline crop.",
  });

  // Window-source capture (approximates a Chrome window-share path).
  const windowSourcesOn = probeOn.window_sources || [];
  const windowSourcesOff = probeOff.window_sources || [];
  const windowVerdict =
    windowSourcesOn.length > 0 && windowSourcesOff.length > 0
      ? "RECORDED_FOR_MANUAL_REVIEW"
      : "NO_WINDOW_SOURCE";
  recordTrial({
    profile,
    path: "chromium-desktopcapturer-window",
    method: "desktopCapturer.getSources({types:['window']}) thumbnail of the overlay window",
    stealth_on_window_sources: windowSourcesOn,
    stealth_off_window_sources: windowSourcesOff,
    verdict: windowVerdict,
    notes: "Window-source capture is what a Chrome window-share uses underneath; tab share needs a real browser picker (UNTESTED).",
  });

  return {
    profile,
    bounds,
    affinityOn,
    affinityOff,
    gdiVerdict,
    probeVerdict,
  };
}

async function runDpiSimulation() {
  const env = Object.assign({}, process.env, {
    HIRESHADE_FORCE_SCALE: "1.5",
    HIRESHADE_DEBUG_CDP: String(CDP_PORT + 1),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: path.join(evidenceDir, "userdata-dpi"),
    HIRESHADE_LOG_FILE: path.join(evidenceDir, "main-dpi-sim.log"),
    ELECTRON_STEALTH: "1",
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  const originalPort = CDP_PORT;
  try {
    const pages = await (async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch("http://127.0.0.1:" + (CDP_PORT + 1) + "/json");
          const targets = await response.json();
          const page = targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
          if (page) return page;
        } catch {
          // wait
        }
        await sleep(400);
      }
      throw new Error("DPI simulation app did not expose a floating page");
    })();
    const client = await connect(pages.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await sleep(800);
    const applied = await callBridge(client, "(async () => await window.hireshadeCapture.applyProfile('banner'))()", "dpi applyProfile");
    await sleep(800);
    const snapshot = await state(client);
    const affinity = assertAffinity("dpi-simulated", "force-device-scale-factor=1.5 simulated DPI", "0x11", child.pid);
    client.close();
    return {
      method: "Second app instance launched with --force-device-scale-factor=1.5 (HIRESHADE_FORCE_SCALE). This simulates a DPI/scale transition, not a real monitor hot-plug.",
      bound: applied ? { width: applied.overlayAreaRatio, state: applied.lastProfile } : null,
      display: snapshot ? snapshot.display : null,
      affinity,
      note: "A real monitor unplug/plug remains UNTESTED (single-display host).",
    };
  } finally {
    try {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
    } catch {
      // best effort
    }
    void originalPort;
  }
}

async function main() {
  ensureDir(evidenceDir);
  const userData = path.join(evidenceDir, "userdata");
  fs.rmSync(userData, { recursive: true, force: true });
  const env = Object.assign({}, process.env, {
    HIRESHADE_DEBUG_CDP: String(CDP_PORT),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: userData,
    HIRESHADE_LOG_FILE: path.join(evidenceDir, "main.log"),
    ELECTRON_STEALTH: "1",
    HIRESHADE_CAPTURE_HINT: "ffmpeg ddagrab (DXGI Desktop Duplication) - diagnostic hint, not auto-detection",
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  trackedAppPid = app.pid;
  let client = null;
  try {
    const connected = await connectFloating();
    client = connected.client;
    await sleep(1200);
    const initial = await state(client);
    results.environment.displays = initial.display;
    assertAffinity("initial-startup", "after app start");

    // 1. Transition matrix: profiles + repeats + display simulation + private toggles.
    for (const profile of ["card", "banner", "reading", "card", "banner", "reading"]) {
      await applyProfile(client, profile);
      await sleep(700);
      assertAffinity("transition-" + profile + "-" + results.transitions.length, "applyProfile " + profile);
    }
    await callBridge(client, "window.hireshadeCapture.simulateDisplayChange()", "simulate display change");
    await sleep(500);
    assertAffinity("transition-display-metrics-simulated", "simulated display-metrics-changed handler");

    await setPrivate(client, false);
    await sleep(500);
    // OFF is expected to clear exclusion: assert the observable 0x0 state.
    assertAffinity("transition-private-off", "private mode OFF: affinity expected 0x0, not 0x11", "0x0");
    await setPrivate(client, true);
    await sleep(500);
    assertAffinity("transition-private-on", "private mode ON");

    // 2. A/B capture trials at BANNER and READING.
    for (const profile of ["banner", "reading"]) {
      await captureTrial(client, profile);
    }

    // 3. Compatibility mode: recreate surface, assert affinity, capture again.
    await applyProfile(client, "reading");
    await sleep(600);
    const compatBefore = await state(client);
    const compatOn = await toggleCompat(client, true);
    client = compatOn.client;
    await sleep(1000);
    const compatState = await state(client);
    const compatAffinity = assertAffinity("compat-mode-on-reading", "after compatibility-mode surface recreation");
    const compatBounds = windowBoundsFromState(compatState);
    const compatBoundsStr = compatBounds && compatState.display ? physicalBoundsString(compatBounds, compatState.display.dpr) : undefined;
    const compatGdi = gdiGrab("compat-mode-on-reading", compatBoundsStr, "compatibility mode ON (opaque)");
    const compatProbe = desktopCapturerProbe("compat-mode-on-reading");
    const compatHidden = gdiGrab("compat-mode-on-reading-hidden-baseline", compatBoundsStr, "hidden baseline in compat mode");
    const compatOff = await toggleCompat(client, false);
    client = compatOff.client;
    await sleep(800);
    const compatAffinityOff = assertAffinity("compat-mode-off-reading", "after compatibility-mode disable");
    results.compatibility = {
      before: compatBefore.capture,
      on: compatState.capture,
      affinity_on: compatAffinity,
      affinity_off: compatAffinityOff,
      gdi_on: compatGdi,
      desktopcapturer_on: compatProbe,
      note: "Compatibility mode recreates the floating BrowserWindow with transparent:false + #0b0d12 scrim; affinity is re-asserted on the new HWND.",
    };

    // 4. Self-check UI + auto-suggestion (reported-visible path).
    const uiBefore = await evaluate(client, "({ widget: !!document.getElementById('hireshade-capture-root'), toggle: !!document.getElementById('hireshade-capture-toggle'), run: !!document.getElementById('hireshade-selfcheck-run'), compat: !!document.getElementById('hireshade-compat-toggle'), patternHidden: document.getElementById('hireshade-selfcheck-pattern').hidden })");
    await evaluate(client, "document.getElementById('hireshade-capture-toggle').click(); document.getElementById('hireshade-selfcheck-run').click(); true");
    const uiPattern = await evaluate(client, "({ patternHidden: document.getElementById('hireshade-selfcheck-pattern').hidden, panelHidden: document.getElementById('hireshade-capture-panel').hidden })");
    await evaluate(client, "document.getElementById('hireshade-selfcheck-visible').click(); true");
    await sleep(700);
    const reportedState = await state(client);
    results.self_check = {
      ui: uiBefore,
      pattern_after_click: uiPattern,
      honest_copy: await evaluate(client, "document.getElementById('hireshade-capture-note').textContent"),
      reported_visible_suggestion: reportedState.capture.lastSuggestion,
      note: "Copy is explicit that capture visibility cannot be reliably detected; this is a manual check.",
    };
    assertAffinity("self-check-reported-visible", "after self-check reported visible");

    // 5. DXGI Desktop Duplication via ffmpeg ddagrab (may fail on this host).
    try {
      await showOverlay(client);
      await setPrivate(client, true);
      await applyProfile(client, "banner");
      await sleep(700);
      const hiddenBase = await (async () => {
        await hideAll(client);
        await sleep(500);
        const rec = ddagrabRecording("banner-hidden-baseline");
        await showOverlay(client);
        return rec;
      })();
      await sleep(500);
      const onRec = ddagrabRecording("banner-stealth-on");
      await setPrivate(client, false);
      await sleep(500);
      const offRec = ddagrabRecording("banner-stealth-off");
      await setPrivate(client, true);
      const onDiff = hiddenBase.frame && onRec.frame ? imageDiff("ddagrab-on-vs-baseline", hiddenBase.frame, onRec.frame) : { error: "missing ddagrab frames", hidden: hiddenBase, on: onRec };
      const offDiff = hiddenBase.frame && offRec.frame ? imageDiff("ddagrab-off-vs-baseline", hiddenBase.frame, offRec.frame) : { error: "missing ddagrab frames" };
      results.dxgi = {
        method: "ffmpeg -f lavfi -i ddagrab=0:framerate=10 (Desktop Duplication API) A/B recordings; frames diffed against hidden baseline",
        supported: hiddenBase.ok && onRec.ok && offRec.ok,
        baseline: hiddenBase,
        stealth_on: onRec,
        stealth_off: offRec,
        on_vs_baseline: onDiff,
        off_vs_baseline: offDiff,
        verdict:
          hiddenBase.ok && onRec.ok && offRec.ok && onDiff.fraction_diff_gt_threshold !== undefined
            ? onDiff.fraction_diff_gt_threshold > 0.02 && offDiff.fraction_diff_gt_threshold > 0.02
              ? "DXGI Desktop Duplication IGNORES WDA_EXCLUDEFROMCAPTURE (overlay visible in both ON and OFF recordings)"
              : "DXGI result unexpected: review frames manually"
            : "UNTESTED: ddagrab capture failed on this host (" + String((hiddenBase && hiddenBase.error) || (onRec && onRec.error) || "").slice(-300) + ")",
      };
    } catch (error) {
      results.dxgi = { supported: false, verdict: "UNTESTED: " + error.message };
    }

    // 6. DPI simulation (separate instance).
    results.dpi_simulation = await runDpiSimulation();

    await sleep(300);
    const finalState = await state(client);
    results.final_state = finalState.capture;
  } finally {
    if (client) {
      try {
        client.close();
      } catch {
        // ignore
      }
    }
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }

  results.untested = [
    "Real monitor unplug/plug: single-display host; the display-metrics-changed handler was exercised via the debug IPC and DPI was simulated with --force-device-scale-factor=1.5.",
    "macOS ScreenCaptureKit/NSWindowSharingNone: no macOS host. NSWindowSharingNone is reported unreliable by other sources; not verified here.",
    "Chrome/Edge tab-share and browser full-screen share picker: no automated browser picker in this environment. Chromium's desktopCapturer screen/window paths were captured instead.",
    "Elevated vs non-elevated capture apps: not exercised (no elevated capture tool available/appropriate).",
    "Other real capture apps (OBS full-screen DXGI, Discord, Zoom native): not installed/automated here; see the ffmpeg ddagrab row for the DXGI API-level result.",
  ];

  results.overall = {
    transitions_total: results.transitions.length,
    transitions_pass: results.transitions.filter((entry) => entry.affinity && entry.affinity.pass).length,
    capture_trials: results.capture_trials.length,
  };
  fs.writeFileSync(path.join(evidenceDir, "matrix-evidence.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log("[matrix] wrote " + path.join(evidenceDir, "matrix-evidence.json"));
  console.log("[matrix] transitions " + results.overall.transitions_pass + "/" + results.overall.transitions_total + " affinity PASS");
}

main().catch((error) => {
  console.error("[matrix] FAILED: " + (error && error.stack ? error.stack : error));
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "matrix-evidence.json"), JSON.stringify({ ...results, fatal_error: String(error && error.stack ? error.stack : error) }, null, 2) + "\n", "utf8");
  process.exitCode = 1;
});
