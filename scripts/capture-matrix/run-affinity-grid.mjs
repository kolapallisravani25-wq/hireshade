import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * S1 affinity-mode experiment: WDA_NONE 0x00 / WDA_MONITOR 0x01 /
 * WDA_EXCLUDEFROMCAPTURE 0x11 against GDI, Chromium desktopCapturer (screen +
 * window), PrintWindow and DXGI Desktop Duplication.
 *
 * The Electron app runs with ELECTRON_STEALTH=0 so its own re-assert cannot
 * overwrite the externally-set affinity; this script sets the mode on the live
 * HWND with user32!SetWindowDisplayAffinity and verifies the readback.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "capture-sprint");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const PORT = 9229;
const MODES = [
  { id: "0x00", value: "none", label: "WDA_NONE 0x00" },
  { id: "0x01", value: "monitor", label: "WDA_MONITOR 0x01" },
  { id: "0x11", value: "exclude", label: "WDA_EXCLUDEFROMCAPTURE 0x11" },
];
const PROFILES = ["banner", "reading"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runPowerShell(scriptName, args) {
  const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoRoot, "scripts", "capture-matrix", scriptName), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120000,
  });
  const stdout = (run.stdout || "").trim().replace(/^\uFEFF/, "");
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (run.status !== 0 || start < 0 || end <= start) return { ok: false, raw: stdout + (run.stderr || "") };
  try {
    return { ok: true, value: JSON.parse(stdout.slice(start, end + 1)) };
  } catch (error) {
    return { ok: false, raw: stdout, error: String(error) };
  }
}

async function waitPages(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + PORT + "/json");
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
      if (page) return page;
    } catch {
      // wait
    }
    await sleep(400);
  }
  throw new Error("timed out waiting for floating page");
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

function setAffinity(mode, pid) {
  // Cross-process SetWindowDisplayAffinity is allowed only for windows owned by
  // the calling process (Win32 returns ERROR_ACCESS_DENIED otherwise), so this
  // is used only to DOCUMENT why 0x01 cannot be applied externally.
  const outFile = path.join(evidenceDir, "affinity-grid-set-" + mode.id + ".json");
  return runPowerShell("set-affinity.ps1", ["-Affinity", mode.value, "-OutFile", outFile, "-Pids", String(pid), "-Title", "*"]);
}

function affinityCheck(label, expect, pid) {
  const outFile = path.join(evidenceDir, "affinity-grid-" + label + ".json");
  return runPowerShell("affinity.ps1", ["-OutFile", outFile, "-Expect", expect, "-Note", "S1 " + label, "-Pids", String(pid)]);
}

function gdi(label, bounds) {
  const run = runPowerShell("gdi-grab.ps1", ["-OutDir", evidenceDir, "-Label", label, "-Bounds", bounds, "-Note", label]);
  return run.ok ? run.value : { ok: false, error: run.raw };
}

function probe(label) {
  const env = Object.assign({}, process.env, { O2_PROBE_OUT: evidenceDir, O2_PROBE_LABEL: label });
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(electronExe, [path.join(repoRoot, "scripts", "capture-matrix", "electron-capture-probe.cjs")], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  const stdout = (run.stdout || "").trim();
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: (run.stdout || "") + (run.stderr || "") };
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return { error: stdout };
  }
}

function printWindow(label) {
  const run = runPowerShell("printwindow.ps1", ["-OutDir", evidenceDir, "-Label", label]);
  return run.ok ? run.value : { ok: false, printwindow_ok: false, error: run.raw };
}

function ddagrab(label) {
  const mp4 = path.join(evidenceDir, "grid-ddagrab-" + label + ".mp4");
  const frame = path.join(evidenceDir, "grid-ddagrab-" + label + "-frame.png");
  const record = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "1", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-1200) };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4: mp4, frame: frame };
}

function diff(label, a, b, rect) {
  const args = ["-A", a, "-B", b, "-OutFile", path.join(evidenceDir, "diff-grid-" + label + ".json"), "-Label", label];
  if (rect) args.push("-Rect", rect);
  return runPowerShell("image-diff.ps1", args);
}

function cropStats(label, input, rect) {
  return runPowerShell("crop-stats.ps1", ["-In", input, "-Rect", rect, "-OutFile", path.join(evidenceDir, "crop-grid-" + label + ".json"), "-Label", label]);
}

function physicalBounds(bounds, dpr) {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return [Math.round(bounds.x * scale), Math.round(bounds.y * scale), Math.round(bounds.width * scale), Math.round(bounds.height * scale)].join(",");
}

function classify(diffFraction, stats) {
  if (typeof diffFraction !== "number") return "ERROR";
  if (diffFraction <= 0.005) return "HIDDEN";
  const black = stats ? (typeof stats.black_fraction === "number" ? stats.black_fraction : stats.non_black_fraction) : null;
  const unique = stats ? stats.unique_colors_sampled : null;
  const std = stats ? stats.std_luma : null;
  if (typeof black === "number" && black >= 0.5 && typeof unique === "number" && unique <= 400 && typeof std === "number" && std < 35) {
    return "BLACK_BAR";
  }
  return "VISIBLE_CONTENT";
}

function classifyPrintWindow(pw) {
  if (!pw || pw.printwindow_ok === false) return "UNTESTED_PRINTWINDOW_FAILED";
  const stats = pw.stats || {};
  if ((stats.black_fraction || 0) >= 0.97 && (stats.mean_luma || 0) < 2) return "BLACK_NO_CONTENT";
  return "CONTENT_VISIBLE";
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const userData = path.join(evidenceDir, "userdata-grid");
  fs.rmSync(userData, { recursive: true, force: true });
  const env = Object.assign({}, process.env, {
    // In-app modes: setPrivateMode(false/true) maps to setContentProtection ->
    // WDA_NONE 0x00 / WDA_EXCLUDEFROMCAPTURE 0x11. The app must be allowed to
    // apply them (ELECTRON_STEALTH=1) for this in-process experiment.
    ELECTRON_STEALTH: "1",
    HIRESHADE_DEBUG_CDP: String(PORT),
    HIRESHADE_DEBUG_IPC: "1",
    HIRESHADE_USER_DATA: userData,
    HIRESHADE_LOG_FILE: path.join(evidenceDir, "main-grid.log"),
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(electronExe, ["."], { cwd: desktopElectron, env, stdio: "ignore" });
  const result = {
    generated_at: new Date().toISOString(),
    method: "S1: Electron shell with ELECTRON_STEALTH=0; affinity set externally with user32!SetWindowDisplayAffinity and verified by readback; captures compared with the same hidden-window baseline (pixel-diff >16).",
    profiles: {},
    zoom_analysis: {},
    app_pid: app.pid,
  };
  let client = null;
  try {
    const page = await waitPages(30000);
    client = await connect(page.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await sleep(1200);
    const initial = await evaluate(client, "(async () => (await window.hireshadeDesktop.getState()).windows.floating)()");
    if (!initial || !initial.visible) {
      await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
      await sleep(700);
    }
    const ready = await evaluate(client, "({ title: document.title, readyState: document.readyState, bodyChars: document.body ? document.body.innerText.length : 0, hasCapture: !!window.hireshadeCapture })");
    if (!ready.hasCapture || ready.bodyChars < 20) {
      throw new Error("floating UI did not load on this branch: " + JSON.stringify(ready) + " (build artifacts/craft-vita/dist/public first)");
    }

    for (const profile of PROFILES) {
      await evaluate(client, "(async () => await window.hireshadeCapture.applyProfile('" + profile + "'))()");
      await sleep(700);
      const snapshot = await evaluate(client, "(async () => ({ capture: await window.hireshadeCapture.getState(), display: { dpr: devicePixelRatio }, bounds: (await window.hireshadeDesktop.getState()).windows.floating.bounds, visible: (await window.hireshadeDesktop.getState()).windows.floating.visible }))()");
      const bounds = physicalBounds(snapshot.bounds, snapshot.display.dpr);
      if (!snapshot.visible) {
        await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
        await sleep(700);
      }

      const profileRows = [];
      for (const mode of MODES) {
        // Make sure the overlay is actually shown before every capture (a hidden
        // window would produce a false HIDDEN classification).
        const visibleState = await evaluate(client, "(async () => (await window.hireshadeDesktop.getState()).windows.floating.visible)()");
        if (!visibleState) {
          await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
          await sleep(700);
        }
        const label = profile + "-" + mode.id;
        if (label === "unused") { /* never */ }
        // Per-mode hidden baseline captured immediately before the ON capture so
        // unrelated desktop activity cannot pollute the pixel diff.
        await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('panic-hide')");
        await sleep(650);
        const gdiBaseline = gdi(label + "-baseline", bounds);
        const probeBaseline = probe(label + "-baseline");
        const ddagrabBaseline = ddagrab(label + "-baseline");
        await evaluate(client, "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
        await sleep(700);
        const gdiBaselineCrop = gdiBaseline.crop_path;
        const probeBaselineScreen = probeBaseline.screen_sources && probeBaseline.screen_sources[0] ? probeBaseline.screen_sources[0].path : null;
        const ddagrabBaselineFrame = ddagrabBaseline.ok ? ddagrabBaseline.frame : null;
        if (mode.id === "0x01") {
          // Electron exposes setContentProtection(bool) only (0x00 / 0x11), and
          // Win32 refuses SetWindowDisplayAffinity from another process
          // (ERROR_ACCESS_DENIED = 5), so WDA_MONITOR cannot be applied to the
          // product surface from this rig. Record the attempt honestly.
          const external = setAffinity(mode, app.pid);
          const externalJson = external.ok ? external.value : { ok: false, error: external.raw };
          const rejected = {
            profile,
            mode: mode.id,
            mode_label: mode.label,
            captures_skipped: true,
            external_attempt: externalJson,
            reason:
              "WDA_MONITOR 0x01 is not reachable for this surface: (a) Electron only exposes setContentProtection(bool) -> 0x00/0x11; (b) user32!SetWindowDisplayAffinity from a different process fails with ERROR_ACCESS_DENIED (Win32 error 5) because the window must belong to the calling process. No valid 0x01 state could be established, so no captures are claimed.",
            gdi: { classification: "UNTESTED_0x01_UNREACHABLE_FROM_ELECTRON_OR_EXTERNAL_PROCESS" },
            chromium_desktopcapturer_screen: { classification: "UNTESTED_0x01_UNREACHABLE_FROM_ELECTRON_OR_EXTERNAL_PROCESS" },
            chromium_desktopcapturer_window: { classification: "UNTESTED_0x01_UNREACHABLE_FROM_ELECTRON_OR_EXTERNAL_PROCESS" },
            printwindow: { classification: "UNTESTED_0x01_UNREACHABLE_FROM_ELECTRON_OR_EXTERNAL_PROCESS" },
            dxgi_ddagrab: { classification: "UNTESTED_0x01_UNREACHABLE_FROM_ELECTRON_OR_EXTERNAL_PROCESS" },
          };
          profileRows.push(rejected);
          console.log("[grid] " + profile + " 0x01 UNTESTED: " + rejected.reason);
          continue;
        }
        // In-app mode: Electron setContentProtection(true/false) -> 0x11/0x00.
        await evaluate(client, "(async () => { await window.hireshadeDesktop.setPrivateMode(" + (mode.id === "0x11") + "); })()");
        await sleep(500);
        const setJson = {
          method: "in-app Electron setContentProtection(" + (mode.id === "0x11") + ")",
          requested: mode.id,
          ok: true,
        };
        const expectedAffinity = mode.id === "0x11" ? "0x11" : "0x0";
        const verify = affinityCheck(label + "-verify", expectedAffinity, app.pid);
        if (!verify.ok || !verify.value.pass) {
          throw new Error("S1 abort: affinity verification failed for " + mode.id + ": " + JSON.stringify(verify.ok ? verify.value : verify.raw).slice(0, 500));
        }
        const gdiOn = gdi(label, bounds);
        const probeOn = probe(label);
        const printOn = printWindow(label);
        const ddagrabOn = ddagrab(label);

        const gdiDiff = gdiBaselineCrop && gdiOn.crop_path ? diff(label + "-gdi-vs-baseline", gdiBaselineCrop, gdiOn.crop_path) : { ok: false };
        const probeOnScreen = probeOn.screen_sources && probeOn.screen_sources[0] ? probeOn.screen_sources[0].path : null;
        const probeDiff = probeBaselineScreen && probeOnScreen ? diff(label + "-desktopcapturer-vs-baseline", probeBaselineScreen, probeOnScreen) : { ok: false };
        const probeCrop = probeOnScreen ? cropStats(label + "-desktopcapturer-crop", probeOnScreen, bounds) : { ok: false };
        const ddagrabDiff = ddagrabBaselineFrame && ddagrabOn.ok ? diff(label + "-ddagrab-vs-baseline", ddagrabBaselineFrame, ddagrabOn.frame, bounds) : { ok: false };
        const ddagrabCrop = ddagrabOn.ok ? cropStats(label + "-ddagrab-crop", ddagrabOn.frame, bounds) : { ok: false };

        const gdiFraction = gdiDiff.ok ? gdiDiff.value.fraction_diff_gt_threshold : null;
        const probeFraction = probeDiff.ok ? probeDiff.value.fraction_diff_gt_threshold : null;
        const ddagrabFraction = ddagrabDiff.ok ? ddagrabDiff.value.fraction_diff_gt_threshold : null;
        const gdiStats = gdiOn.stats || {};
        const probeStats = probeCrop.ok ? probeCrop.value : null;
        const ddagrabStats = ddagrabCrop.ok ? ddagrabCrop.value : null;

        const windowSources = probeOn.window_sources || [];
        const windowCapture =
          windowSources.length === 0
            ? "NO_WINDOW_SOURCE"
            : windowSources.every((source) => !source.thumbnail_size || source.thumbnail_size.width === 0)
              ? "NO_PIXELS (0x0 thumbnail)"
              : "CONTENT (" + windowSources.map((source) => source.thumbnail_size.width + "x" + source.thumbnail_size.height).join(",") + ")";

        const row = {
          profile,
          mode: mode.id,
          mode_label: mode.label,
          affinity_set: setJson,
          affinity_verified: verify.ok ? verify.value : { error: verify.raw },
          readback_after_captures: null,
          gdi: { fraction_diff: gdiFraction, classification: classify(gdiFraction, gdiStats), stats: gdiStats, capture: gdiOn.crop_path, baseline: gdiBaselineCrop },
          chromium_desktopcapturer_screen: { fraction_diff: probeFraction, classification: classify(probeFraction, probeStats), stats: probeStats, capture: probeOnScreen, baseline: probeBaselineScreen },
          chromium_desktopcapturer_window: { window_sources: windowSources, classification: windowCapture },
          printwindow: { classification: classifyPrintWindow(printOn), stats: printOn.stats || null, path: printOn.path || null, ok: printOn.printwindow_ok },
          dxgi_ddagrab: { fraction_diff: ddagrabFraction, classification: classify(ddagrabFraction, ddagrabStats), stats: ddagrabStats, capture: ddagrabOn.frame || null, baseline: ddagrabBaselineFrame, ok: ddagrabOn.ok, error: ddagrabOn.error || null },
          files: { gdi_diff: gdiDiff.ok ? gdiDiff.value : null, probe_diff: probeDiff.ok ? probeDiff.value : null, ddagrab_diff: ddagrabDiff.ok ? ddagrabDiff.value : null },
        };
        // Re-verify affinity after the capture probes ran (focus events can
        // re-assert; the app applies the same private mode so it must stay).
        const after = affinityCheck(label + "-after", expectedAffinity, app.pid);
        row.readback_after_captures = after.ok ? after.value : { ok: false };
        if (!row.readback_after_captures.pass) {
          throw new Error("S1 abort: affinity drifted during captures for " + label + ": " + JSON.stringify(row.readback_after_captures).slice(0, 500));
        }
        profileRows.push(row);
        console.log("[grid] " + profile + " " + mode.id + " gdi=" + row.gdi.classification + " dc-screen=" + row.chromium_desktopcapturer_screen.classification + " dc-window=" + row.chromium_desktopcapturer_window.classification + " printwindow=" + row.printwindow.classification + " dxgi=" + row.dxgi_ddagrab.classification);
      }
      result.profiles[profile] = { bounds_physical: bounds, snapshot, rows: profileRows };

      // S1b: zoom the GDI 0x11 ON-vs-baseline crops to classify the residual.
      const row11 = profileRows.find((row) => row.mode === "0x11");
      if (row11 && row11.gdi.baseline && row11.gdi.capture) {
        const zoomRun = runPowerShell("zoom-diff.ps1", ["-Baseline", row11.gdi.baseline, "-On", row11.gdi.capture, "-OutDir", evidenceDir, "-Label", profile + "-gdi-0x11"]);
        result.zoom_analysis[profile] = zoomRun.ok ? zoomRun.value : { error: zoomRun.raw };
        console.log("[grid] zoom " + profile + " -> " + (zoomRun.ok ? zoomRun.value.classification : "ERROR"));
      }
      await setAffinity(MODES[2], app.pid);
    }

    fs.writeFileSync(path.join(evidenceDir, "affinity-grid.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log("[grid] wrote " + path.join(evidenceDir, "affinity-grid.json"));
  } finally {
    if (client) client.close();
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }
}

main().catch((error) => {
  console.error("[grid] FAILED: " + (error && error.stack ? error.stack : error));
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "affinity-grid.json"), JSON.stringify({ fatal_error: String(error && error.stack ? error.stack : error) }, null, 2) + "\n", "utf8");
  process.exitCode = 1;
});
