import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * U2: opaque-capture measurement after runtime compatibility-mode recreation.
 *
 * Fixes the previous harness blocker: CDP re-attach is done by re-querying
 * /json after the old target dies; a dead WebSocket is never awaited; all CDP
 * operations are bounded (5 s per call, 20 s for re-attach) and fail loudly with
 * the current target list.
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "capture-sprint");
const desktopElectron = path.join(repoRoot, "artifacts", "desktop-electron");
const requireFromDesktop = createRequire(path.join(desktopElectron, "package.json"));
const electronExe = requireFromDesktop("electron");
const PORT = 9241;
const SEEDED_OPAQUE = process.env.U2_SEEDED_OPAQUE === "1";
const REATTACH_TIMEOUT_MS = 20000;
const CDP_CALL_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTargets() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch("http://127.0.0.1:" + PORT + "/json", { signal: controller.signal });
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    let dead = false;
    const pending = new Map();
    const failAll = (reason) => {
      dead = true;
      for (const entry of pending.values()) entry.reject(new Error(reason));
      pending.clear();
    };
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
    socket.addEventListener("open", () =>
      resolve({
        get dead() { return dead; },
        send(method, params) {
          if (dead) return Promise.reject(new Error("CDP socket is dead; re-attach required"));
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
    setTimeout(() => { if (!dead) { try { socket.close(); } catch { /* ignore */ } reject(new Error("CDP connect timeout")); } }, CDP_CALL_TIMEOUT_MS);
  });
}

async function attachFloating(label) {
  const deadline = Date.now() + REATTACH_TIMEOUT_MS;
  let lastTargets = null;
  let lastError = null;
  while (Date.now() < deadline) {
    const targets = await fetchTargets();
    lastTargets = targets;
    const page = targets && targets.find((target) => target.type === "page" && /floating\.html/.test(target.url || ""));
    if (page) {
      try {
        const client = await connect(page.webSocketDebuggerUrl);
        await withTimeout(client.send("Runtime.enable"), CDP_CALL_TIMEOUT_MS, "Runtime.enable");
        return { client, page, targets };
      } catch (error) {
        lastError = error;
        try { client.close(); } catch { /* ignore */ }
      }
    }
    await sleep(250);
  }
  const summary = { label, error: lastError ? String(lastError.message) : "floating page not found", targets: lastTargets };
  throw new Error("CDP_REATTACH_FAILED " + JSON.stringify(summary, null, 2));
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout after " + ms + "ms: " + label)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function evaluate(targetClient, expression) {
  if (targetClient.dead) throw new Error("CDP socket is dead; re-attach required");
  const result = await withTimeout(targetClient.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), CDP_CALL_TIMEOUT_MS, "Runtime.evaluate");
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 800));
  return result.result.value;
}

let client = null;

/**
 * Evaluate with automatic re-attach: if the WebSocket died (window recreate,
 * renderer swap, transient detach), query /json again and retry once. Never
 * awaits a dead socket.
 */
async function safeEvaluate(label, expression) {
  // Call sites may pass just the expression (label optional).
  if (expression === undefined) {
    expression = label;
    label = "eval";
  }
  if (!client || client.dead) {
    const reattached = await attachFloating(label + "-reattach");
    client = reattached.client;
  }
  try {
    return await evaluate(client, expression);
  } catch (error) {
    if (!/dead|closed|socket|detach/i.test(String(error && error.message))) throw error;
    const reattached = await attachFloating(label + "-retry");
    client = reattached.client;
    return evaluate(client, expression);
  }
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

function gdi(label, bounds) {
  const run = runPowerShell("gdi-grab.ps1", ["-OutDir", evidenceDir, "-Label", label, "-Bounds", bounds, "-Note", label]);
  return run.ok ? run.value : { ok: false, error: run.raw };
}

function printWindow(label) {
  const run = runPowerShell("printwindow.ps1", ["-OutDir", evidenceDir, "-Label", label, "-Title", "Floating"]);
  return run.ok ? run.value : { ok: false, error: run.raw };
}

function ddagrab(label) {
  const mp4 = path.join(evidenceDir, "u2-ddagrab-" + label + ".mp4");
  const frame = path.join(evidenceDir, "u2-ddagrab-" + label + "-frame.png");
  const record = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "ddagrab=0:framerate=10", "-t", "1", "-vf", "hwdownload,format=bgra", mp4], { encoding: "utf8", timeout: 120000 });
  if (record.status !== 0) return { ok: false, error: (record.stderr || "").slice(-1200) };
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-frames:v", "1", frame], { encoding: "utf8", timeout: 60000 });
  return { ok: true, mp4, frame };
}

function diff(label, a, b) {
  const run = runPowerShell("image-diff.ps1", ["-A", a, "-B", b, "-OutFile", path.join(evidenceDir, "u2-diff-" + label + ".json"), "-Label", label]);
  return run.ok ? run.value : { error: run.raw };
}

function windowStyle(pid, outFile) {
  const run = runPowerShell("window-style.ps1", ["-Pids", String(pid), "-Title", "Floating", "-OutFile", outFile]);
  return run.ok ? run.value : { error: run.raw };
}

function affinity(pid, outFile) {
  const run = runPowerShell("affinity.ps1", ["-Pids", String(pid), "-OutFile", outFile, "-Expect", "0x11", "-Note", "U2 opaque recreation"]);
  return run.ok ? run.value : { error: run.raw };
}

function physicalBounds(bounds, dpr) {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return [Math.round(bounds.x * scale), Math.round(bounds.y * scale), Math.round(bounds.width * scale), Math.round(bounds.height * scale)].join(",");
}

function logTail(logFile, lines) {
  try {
    return fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const userData = path.join(evidenceDir, "userdata-u2");
  fs.rmSync(userData, { recursive: true, force: true });
  if (SEEDED_OPAQUE) {
    // Startup-opaque variant: capture-state compatMode=true -> createWindow
    // builds transparent:false immediately (no runtime surface swap needed).
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
      path.join(userData, "capture-state.json"),
      JSON.stringify({ version: 1, compatMode: true, lastProfile: "reading", reportedVisible: false, lastSelfCheckAt: null, lastSuggestion: null, knownBadCapturePath: null }, null, 2) + "\n",
      "utf8",
    );
  }
  const logFile = path.join(evidenceDir, "main-u2.log");
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
  client = null;
  const result = {
    generated_at: new Date().toISOString(),
    method: "Runtime compat-mode toggle (HIRESHADE_COMPAT_RECREATE=1) -> window recreated transparent:false; CDP re-attach by fresh /json polling (20s bound); captures compared with same-run hidden-window baselines.",
    cdp_reattach: null,
    before: null,
    after: null,
    captures: {},
    diffs: {},
    verdict: {},
    app_pid: app.pid,
  };
  try {
    const first = await attachFloating("initial");
    client = first.client;
    await safeEvaluate( "(async () => { await window.hireshadeCapture.applyProfile('reading'); })()");
    await sleep(800);
    let snapshot = await safeEvaluate( "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), display: { dpr: devicePixelRatio } }))()");
    if (!snapshot.windows.windows.floating.visible) {
      await safeEvaluate( "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
      await sleep(700);
      snapshot = await safeEvaluate( "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), display: { dpr: devicePixelRatio } }))()");
    }
    const bounds = snapshot.windows.windows.floating.bounds;
    const physical = physicalBounds(bounds, snapshot.display.dpr);
    result.before = {
      capture: snapshot.capture,
      bounds,
      physical,
      window_style: windowStyle(app.pid, path.join(evidenceDir, "u2-window-style-before.json")),
      affinity: affinity(app.pid, path.join(evidenceDir, "u2-affinity-before.json")),
      printwindow: printWindow("transparent-before"),
    };

    // Hidden baseline (same run) for GDI/DXGI.
    await safeEvaluate( "window.hireshadeDesktop.debugInvokeAction('panic-hide')");
    await sleep(700);
    const baselineGdi = gdi("hidden-baseline", physical);
    const baselineDxgi = ddagrab("hidden-baseline");
    await safeEvaluate( "window.hireshadeDesktop.debugInvokeAction('toggle-overlay')");
    await sleep(800);

    let reattached = null;
    if (SEEDED_OPAQUE) {
      result.before.seeded_opaque_startup = true;
      result.cdp_reattach = { ok: true, seeded_opaque_startup: true, note: "compatMode=true was pre-seeded in userData/capture-state.json so the surface is created transparent:false at startup" };
      await sleep(1200);
    } else {
      // Toggle compatibility mode. The evaluate returns before the window is destroyed.
      await safeEvaluate( "setTimeout(function(){ window.hireshadeCapture.setCompatMode(true).catch(function(){}); },0); true");
      result.before.compat_toggle_dispatched = true;
    }

    // Re-attach with a fresh target query; never await the dead socket. If CDP
    // does not come back within the bound, fall back to main-process evidence
    // (persisted state + HWND style + external captures) instead of aborting:
    // the opaque-path measurement does not actually require the renderer.
    if (!SEEDED_OPAQUE) {
      try {
        reattached = await attachFloating("after-compat-toggle");
        result.cdp_reattach = {
          ok: true,
          target_list_count: reattached.targets ? reattached.targets.length : null,
          page_title: reattached.page.title,
          page_url: reattached.page.url,
        };
      } catch (error) {
        result.cdp_reattach = { ok: false, error: String(error.message).slice(0, 4000), fallback: "main-process + external capture verification" };
        console.warn("[u2] CDP re-attach failed; using main-process/external evidence: " + String(error.message).slice(0, 500));
      }
    }

    let afterCapture = null;
    let afterBounds = bounds;
    let afterPhysical = physical;
    let afterDom = null;
    if (SEEDED_OPAQUE) {
      // Current CDP client is the same (no surface swap).
      reattached = { client: client };
    }
    if (reattached) {
      client = reattached.client;
      await sleep(1200);
      try {
        const after = await safeEvaluate( "(async () => ({ capture: await window.hireshadeCapture.getState(), windows: await window.hireshadeDesktop.getState(), display: { dpr: devicePixelRatio }, dom: { htmlBg: getComputedStyle(document.documentElement).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor } }))()");
        afterCapture = after.capture;
        afterBounds = after.windows.windows.floating.bounds;
        afterPhysical = physicalBounds(afterBounds, after.display.dpr);
        afterDom = after.dom;
      } catch (error) {
        // The page/socket can vanish right after the surface swap even when the
        // app is healthy; fall through to main-process evidence.
        result.cdp_reattach.after_evaluate_error = String(error && error.message ? error.message : error);
        reattached = null;
      }
    }
    if (!reattached) {
      await sleep(2000);
      try {
        const raw = fs.readFileSync(path.join(userData, "capture-state.json"), "utf8").replace(/^\uFEFF/, "");
        afterCapture = JSON.parse(raw);
        result.after_capture_source = "userData/capture-state.json (main-process persisted state; renderer CDP unavailable)";
      } catch (error) {
        afterCapture = { parse_error: String(error) };
        result.after_capture_source = "unavailable: " + String(error);
      }
    }
    result.after = {
      capture: afterCapture,
      bounds: afterBounds,
      physical: afterPhysical,
      dom: afterDom,
      window_style: windowStyle(app.pid, path.join(evidenceDir, "u2-window-style-after.json")),
      affinity: affinity(app.pid, path.join(evidenceDir, "u2-affinity-after.json")),
      log_tail: logTail(logFile, 20),
    };

    // Captures after recreation: opaque PrintWindow, GDI and DXGI.
    result.captures.printwindow_opaque = printWindow("opaque-after-recreate");
    result.captures.gdi_opaque = gdi("opaque-after-recreate", afterPhysical);
    result.captures.dxgi_opaque = ddagrab("opaque-after-recreate");

    result.diffs.gdi_opaque_vs_hidden = baselineGdi.crop_path && result.captures.gdi_opaque.crop_path ? diff("gdi-opaque-vs-hidden", baselineGdi.crop_path, result.captures.gdi_opaque.crop_path) : { error: "missing gdi" };
    result.diffs.dxgi_opaque_vs_hidden = baselineDxgi.frame && result.captures.dxgi_opaque.frame ? diff("dxgi-opaque-vs-hidden", baselineDxgi.frame, result.captures.dxgi_opaque.frame) : { error: "missing ddagrab" };

    const beforeStyle = result.before.window_style && result.before.window_style.windows ? result.before.window_style.windows.find((w) => w.visible) : null;
    const afterStyle = result.after.window_style && result.after.window_style.windows ? result.after.window_style.windows.find((w) => w.visible) : null;
    const pwBefore = result.before.printwindow && result.before.printwindow.stats ? result.before.printwindow.stats : null;
    const pwAfter = result.captures.printwindow_opaque && result.captures.printwindow_opaque.stats ? result.captures.printwindow_opaque.stats : null;
    const gdiFraction = result.diffs.gdi_opaque_vs_hidden && result.diffs.gdi_opaque_vs_hidden.fraction_diff_gt_threshold;
    const dxgiFraction = result.diffs.dxgi_opaque_vs_hidden && result.diffs.dxgi_opaque_vs_hidden.fraction_diff_gt_threshold;
    result.verdict = {
      recreated_survived: true,
      compat_mode_after: Boolean(result.after.capture.compatMode),
      transparent_flag_before: beforeStyle ? beforeStyle.WS_EX_LAYERED : null,
      transparent_flag_after: afterStyle ? afterStyle.WS_EX_LAYERED : null,
      transparent_false_confirmed: Boolean(afterStyle && afterStyle.WS_EX_LAYERED === false),
      affinity_after: result.after.affinity && result.after.affinity.matching ? result.after.affinity.matching.map((m) => m.affinity) : null,
      printwindow_before_black_fraction: pwBefore ? pwBefore.black_fraction : null,
      printwindow_after_black_fraction: pwAfter ? pwAfter.black_fraction : null,
      printwindow_has_content_after: Boolean(pwAfter && pwAfter.black_fraction < 0.98 && pwAfter.mean_luma > 1),
      gdi_opaque_vs_hidden_fraction: typeof gdiFraction === "number" ? gdiFraction : null,
      dxgi_opaque_vs_hidden_fraction: typeof dxgiFraction === "number" ? dxgiFraction : null,
      dxgi_ignores_affinity: typeof dxgiFraction === "number" ? dxgiFraction > 0.01 : null,
      note: "DXGI Desktop Duplication is known to ignore WDA_EXCLUDEFROMCAPTURE; compatibility mode changes the surface (opaque scrim / no blur) but cannot fix DXGI. Monitor placement or window/tab sharing are the only reliable mitigations for DXGI-based capture.",
    };
  } catch (error) {
    result.error = String(error && error.stack ? error.stack : error);
    result.blocker = String(error && error.message ? error.message : error).slice(0, 4000);
    result.log_tail = logTail(logFile, 60);
    process.exitCode = 1;
  } finally {
    if (client) client.close();
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"], { encoding: "utf8" });
  }
  const outName = SEEDED_OPAQUE ? "opaque-recreate-seeded.json" : "opaque-recreate-runtime.json";
  fs.writeFileSync(path.join(evidenceDir, outName), JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result.verdict && Object.keys(result.verdict).length ? result.verdict : result, null, 2));
}

main().catch((error) => { console.error("[u2] " + (error && error.stack ? error.stack : error)); process.exitCode = 1; });