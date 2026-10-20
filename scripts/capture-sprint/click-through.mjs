/**
 * S4.1 / V4 — deterministic OS click-through proof (flake-root-caused).
 *
 * One Electron instance hosts a dedicated full-screen click-target window BEHIND
 * a protected overlay, both always-on-top with the overlay stacked last.
 *
 * V4 flake fix: no fixed sleeps before clicking. For each phase the harness:
 *   1. asks the Electron main process to prepare focus/stacking and returns the
 *      authoritative state (tracked ignoreMouse value, HWNDs, focus flags; the
 *      Electron getter is used when the runtime exposes it);
 *   2. forces the expected window to the foreground via Win32
 *      (AttachThreadInput + SetForegroundWindow) — the test owns both windows;
 *   3. runs ONE Win32 gate that polls bounded for
 *        - WS_EX_TRANSPARENT (0x20) == expected on the overlay HWND
 *        - GetForegroundWindow() == expected HWND (target for ON, overlay for OFF)
 *      and only then injects physical SendInput at the point, in the same process;
 *   4. waits bounded for the counter delta instead of sleeping.
 * If the gate cannot observe the expected state it records the last observed
 * state and DOES NOT click.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureScreenshot, closeProcess, evaluate, launchElectron, sleep, waitForCdpVersion, waitForPage } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WIN32_HELPER = path.join(here, "u4v-win32.ps1");
// PID-unique CDP ports: multiple agents/harnesses share this desktop. Fixed ports
// let us attach to ANOTHER process's Electron pages (wrong counters/windows), so
// derive a private range per runner and skip anything already serving CDP.
const PORTS = Array.from({ length: 6 }, function (_value, index) {
  return 12000 + ((process.pid * 13) % 3000) + index;
});

// Per-run isolated rect (DIP): another harness on the same desktop uses the
// large default overlay and a full-screen target. A small target that exactly
// follows a corner overlay cannot receive external clicks, and the corner button
// does not overlap the default overlay's button at ~(610,330).
// Right-side corners only: a concurrent harness using the legacy default overlay
// (x 200..960, y 110..570) cannot cover the button centre (~x 1070) or the
// transparent ON probe point (~x 890, y above 110).
const RUN_RECTS = [
  { x: 860, y: 20, width: 420, height: 320 },
  { x: 860, y: 380, width: 420, height: 320 },
];
const RUN_RECT = RUN_RECTS[(process.pid + Math.floor(Date.now() / 1000)) % RUN_RECTS.length];

function parseJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch (error) { return null; }
}

function runWin32(args) {
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WIN32_HELPER, ...args], {
    encoding: "utf8",
    timeout: 20000,
  });
  const parsed = parseJson(run.stdout);
  return { parsed: parsed, raw: String(run.stdout || ""), status: run.status, stderr: run.stderr };
}

function forceForeground(hwnd) {
  const result = runWin32(["-Action", "forceForeground", "-Hwnd", String(hwnd)]);
  return result.parsed || { ok: false, raw: result.raw, status: result.status };
}

function assertAndClick(options) {
  const result = runWin32([
    "-Action", "assertAndClick",
    "-Hwnd", String(options.overlayHwnd),
    "-ExpectedTransparent", options.expectedTransparent ? "1" : "0",
    "-ExpectedForegroundHwnd", String(options.expectedForegroundHwnd),
    "-TimeoutMs", String(options.timeoutMs || 3000),
    "-X", String(options.x),
    "-Y", String(options.y),
  ]);
  return result.parsed || { ok: false, raw: result.raw, status: result.status, stderr: result.stderr };
}

async function waitForInfo(instance, timeoutMs) {
  // The info line is printed only after BOTH windows fire did-finish-load. The
  // overlay page can become CDP-ready a few ms before the target's load event,
  // so a single read races the harness itself. Poll bounded instead of sleeping.
  const deadline = Date.now() + (timeoutMs || 6000);
  while (Date.now() < deadline) {
    const info = instance.info("[capture-sprint-main] info ");
    if (info) return info;
    await sleep(50);
  }
  throw new Error("Electron info line was not emitted after both windows loaded");
}

async function portIsFree(port) {
  try {
    await fetch("http://127.0.0.1:" + port + "/json/version", { signal: AbortSignal.timeout(400) });
    return false; // ANY HTTP response means the port is occupied
  } catch (error) {
    return true;
  }
}

async function launch(port, options, root) {
  for (const candidate of PORTS) {
    if (!(await portIsFree(candidate))) {
      console.error("[s4] port " + candidate + " already serves CDP; skipping to avoid attaching to another harness");
      continue;
    }
    const instance = launchElectron(root, Object.assign({}, options, {
      port: candidate,
      userDataDir: path.join(path.dirname(WIN32_HELPER), "..", "..", "docs", "evidence", "capture-sprint", "s4", "u4v-profile-" + process.pid + "-" + candidate),
    }));
    // Cold Electron starts under concurrent AV/UI load can exceed the default
    // 15 s CDP wait; give this harness-owned start a longer bounded window.
    await waitForCdpVersion(candidate, 30000).catch(function () { /* waitForPage reports the detailed error */ });
    const ready = await waitForPage(candidate, "/overlay", "window.__overlayReady === true").catch(function (error) {
      console.error("[s4] launch " + candidate + " failed: " + String(error));
      return null;
    });
    if (ready) return { instance: instance, overlay: ready.cdp, overlayTarget: ready.target };
    console.error("[s4] electron stderr: " + instance.stderr().slice(-800));
    await closeProcess(instance, []);
  }
  throw new Error("could not launch Electron click harness");
}

async function resetCounters(overlayCdp, targetCdp) {
  await evaluate(overlayCdp, "window.__overlayClicks = 0; true");
  await evaluate(targetCdp, "window.__targetClicks = 0; true");
  await sleep(60);
}

async function readCounters(overlayCdp, targetCdp) {
  const overlayClicks = await evaluate(overlayCdp, "window.__overlayClicks");
  const targetClicks = await evaluate(targetCdp, "window.__targetClicks");
  return { overlayClicks: overlayClicks, targetClicks: targetClicks };
}

async function waitForCounters(overlayCdp, targetCdp, before, expectations, timeoutMs) {
  const started = Date.now();
  let attempts = 0;
  let last = { overlayClicks: before.overlayClicks, targetClicks: before.targetClicks };
  while (Date.now() - started < (timeoutMs || 2500)) {
    attempts += 1;
    last = await readCounters(overlayCdp, targetCdp);
    const overlayOk = expectations.overlayDelta === 0
      ? last.overlayClicks === before.overlayClicks
      : last.overlayClicks === before.overlayClicks + expectations.overlayDelta;
    const targetOk = expectations.targetDelta === 0
      ? last.targetClicks === before.targetClicks
      : last.targetClicks === before.targetClicks + expectations.targetDelta;
    if (overlayOk && targetOk) {
      return { ok: true, attempts: attempts, elapsedMs: Date.now() - started, counters: last, expectations: expectations };
    }
    await sleep(60);
  }
  return { ok: false, attempts: attempts, elapsedMs: Date.now() - started, counters: last, expectations: expectations };
}

async function runPhase(options) {
  const phase = {
    name: options.name,
    mode: options.mode,
    expectedTransparent: options.expected,
    expectedForeground: options.expectedForegroundKey,
    failures: [],
    timings: {},
  };
  const startedAt = Date.now();
  // Isolate each phase: zero both counters immediately before preparation so a
  // late click from the previous phase (or unrelated desktop activity) cannot be
  // attributed to this phase's control window.
  if (options.resetBefore !== false) await resetCounters(options.overlayCdp, options.targetCdp);
  const before = await readCounters(options.overlayCdp, options.targetCdp);
  phase.countersBefore = before;

  // 1. Electron-side authority: prepare focus/stack + tracked ignoreMouse state.
  const prepareStarted = Date.now();
  let prepared = await evaluate(options.overlayCdp, "window.sprintControl.prepare(" + JSON.stringify(options.mode) + ")");
  let state = await evaluate(options.overlayCdp, "window.sprintControl.getWindowState()");
  phase.prepareAttempts = 1;
  // A rare Electron/Chromium style-update delay can leave WS_EX_TRANSPARENT set
  // even though the tracked value changed. Re-issue prepare (bounded) and
  // re-check the native style before entering the click gate.
  const initialWin32 = runWin32(["-Action", "state", "-Hwnd", String(state.overlayHwnd)]);
  const styleOk = initialWin32.parsed && initialWin32.parsed.wsExTransparent === options.expected;
  if (!styleOk || state.ignoreMouseTracked !== options.expected) {
    for (let retry = 0; retry < 2; retry++) {
      await sleep(120);
      prepared = await evaluate(options.overlayCdp, "window.sprintControl.prepare(" + JSON.stringify(options.mode) + ")");
      state = await evaluate(options.overlayCdp, "window.sprintControl.getWindowState()");
      phase.prepareAttempts += 1;
      const retryWin32 = runWin32(["-Action", "state", "-Hwnd", String(state.overlayHwnd)]);
      if (state.ignoreMouseTracked === options.expected && retryWin32.parsed && retryWin32.parsed.wsExTransparent === options.expected) break;
    }
  }
  phase.prepareFinalState = state;
  phase.timings.prepareMs = Date.now() - prepareStarted;
  phase.prepareState = prepared;
  phase.electronState = state;
  const trackedOk = state.ignoreMouseTracked === options.expected;
  const getterOk = !state.electronGetter || !state.electronGetter.available || state.electronGetter.value === options.expected;
  phase.assertions = phase.assertions || [];
  function assert(name, pass, detail) {
    phase.assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
    if (!pass) phase.failures.push(name + ": " + JSON.stringify(detail));
    return Boolean(pass);
  }
  assert("electron-tracked-ignore-mouse", trackedOk, { expected: options.expected, tracked: state.ignoreMouseTracked });
  assert("electron-getter-ignore-mouse", getterOk, state.electronGetter);

  const expectedHwnd = options.expectedForegroundKey === "target" ? state.targetHwnd : state.overlayHwnd;
  phase.expectedForegroundHwnd = expectedHwnd;

  // 2. Force the harness-owned expected window to the foreground (Win32).
  const forceStarted = Date.now();
  phase.forcedForeground = forceForeground(expectedHwnd);
  phase.timings.forceForegroundMs = Date.now() - forceStarted;

  // 3. Atomic gate: bounded poll for exstyle + foreground, then SendInput only
  //    if both match. Records the state observed at/just before the click.
  const gateStarted = Date.now();
  phase.gate = assertAndClick({
    overlayHwnd: state.overlayHwnd,
    expectedTransparent: options.expected,
    expectedForegroundHwnd: expectedHwnd,
    x: options.point.x,
    y: options.point.y,
    timeoutMs: options.gateTimeoutMs || 3000,
  });
  phase.timings.gateMs = Date.now() - gateStarted;
  assert("win32-gate-before-click", phase.gate.ok === true, phase.gate);
  assert("sendinput-only-after-assertions", phase.gate.clicked === true, phase.gate.clicked);

  if (phase.gate.stateAtAssert) {
    assert("win32-exstyle-transparent", phase.gate.stateAtAssert.wsExTransparent === options.expected, phase.gate.stateAtAssert.wsExTransparent);
    assert("win32-expected-foreground", phase.gate.stateAtAssert.foregroundMatches === true, {
      expected: expectedHwnd,
      actual: phase.gate.stateAtAssert.foregroundHwnd,
      title: phase.gate.stateAtAssert.foregroundTitle,
    });
  }

  // 4. Bounded counter wait (no fixed post-click sleep).
  if (phase.gate.ok) {
    phase.counters = await waitForCounters(
      options.overlayCdp,
      options.targetCdp,
      before,
      options.expectations,
      options.counterTimeoutMs || 1200,
    );
    assert("counter-delta", phase.counters.ok === true, phase.counters);
    assert(
      options.expectations.overlayDelta === 0 ? "overlay-did-not-receive-click" : "overlay-control-received-click",
      options.expectations.overlayDelta === 0
        ? phase.counters.counters.overlayClicks === before.overlayClicks
        : phase.counters.counters.overlayClicks === before.overlayClicks + options.expectations.overlayDelta,
      { before: before.overlayClicks, after: phase.counters.counters.overlayClicks },
    );
    assert(
      options.expectations.targetDelta === 0 ? "target-did-not-receive-click" : "target-received-click",
      options.expectations.targetDelta === 0
        ? phase.counters.counters.targetClicks === before.targetClicks
        : phase.counters.counters.targetClicks === before.targetClicks + options.expectations.targetDelta,
      { before: before.targetClicks, after: phase.counters.counters.targetClicks },
    );
  } else {
    phase.counters = null;
    phase.failures.push("gate blocked the click; counters unchanged by design");
  }

  phase.timings.totalMs = Date.now() - startedAt;
  phase.pass = phase.failures.length === 0;
  return phase;
}

export async function runClickThrough(root, server, evidenceDir, options) {
  const opts = options || {};
  const iteration = typeof opts.iteration === "number" ? opts.iteration : 0;
  const captureScreenshots = opts.captureScreenshots !== false;
  const results = { iteration: iteration, assertions: [], screenshots: [], timings: {}, pass: false };
  const startedAt = Date.now();
  // Bounded launch retry: a cold Electron start can race CDP readiness/info
  // emission. Each attempt is recorded; geometry is asserted non-null before any
  // phase runs. A genuine launch failure still fails this iteration loudly.
  let launched = null;
  let target = null;
  let info = null;
  const launchAttempts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    let candidate = null;
    let candidateTarget = null;
    try {
      candidate = await launch(PORTS[0], {
        mode: "click",
        origin: server.origin,
        clickThrough: true,
        stealth: false,
        overlayRect: RUN_RECT,
        targetFollowsOverlay: true,
      }, root);
      const targetPage = await waitForPage(candidate.instance.port, "/target", "window.__targetReady === true");
      candidateTarget = targetPage.cdp;
      const candidateInfo = await waitForInfo(candidate.instance, 6000);
      if (!candidateInfo || !candidateInfo.transparentPointPhysical ||
          typeof candidateInfo.transparentPointPhysical.x !== "number" ||
          typeof candidateInfo.transparentPointPhysical.y !== "number" ||
          !candidateInfo.overlayBounds || typeof candidateInfo.scaleFactor !== "number") {
        throw new Error("invalid/missing click geometry from Electron info line: " + JSON.stringify(candidateInfo));
      }
      launched = candidate;
      target = targetPage.cdp;
      info = candidateInfo;
      launchAttempts.push({ attempt: attempt, ok: true, port: candidate.instance.port });
      break;
    } catch (error) {
      launchAttempts.push({ attempt: attempt, ok: false, error: String(error) });
      if (candidate) await closeProcess(candidate.instance, [candidate.overlay, candidateTarget]);
      await sleep(200 * attempt);
    }
  }
  results.launchAttempts = launchAttempts;
  results.launch = {
    attempts: launchAttempts.length,
    success: Boolean(launched && target && info),
    finalError: launched ? null : launchAttempts[launchAttempts.length - 1] && launchAttempts[launchAttempts.length - 1].error,
  };
  if (!launched || !target || !info) {
    const error = new Error("click-through launch failed after " + launchAttempts.length + " attempt(s): " + results.launch.finalError);
    error.launch = results.launch;
    throw error;
  }
  try {
    results.info = info;
    results.timings.launchMs = Date.now() - startedAt;

    // ON: overlay transparent to input, target foreground, click lands on target.
    results.on = await runPhase({
      name: "on",
      mode: "on",
      expected: true,
      expectedForegroundKey: "target",
      overlayCdp: launched.overlay,
      targetCdp: target,
      point: info.transparentPointPhysical,
      expectations: { overlayDelta: 0, targetDelta: 1 },
    });

    // OFF: overlay ignores mouse = false, overlay foreground, click lands on
    // the overlay control.
    // A focus change can briefly stall the renderer; retry the geometry read
    // instead of failing the whole run on one CDP timeout.
    let buttonRect = null;
    for (let attempt = 1; attempt <= 3 && !buttonRect; attempt++) {
      try {
        buttonRect = await evaluate(
          launched.overlay,
          "(function(){var b=document.querySelector('[data-testid=\"overlay-button\"]');var r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()",
        );
      } catch {
        await sleep(400 * attempt);
      }
    }
    if (!buttonRect) throw new Error("overlay button geometry unavailable after 3 CDP attempts");
    const offPoint = {
      x: Math.round((info.overlayBounds.x + buttonRect.x + buttonRect.width / 2) * info.scaleFactor),
      y: Math.round((info.overlayBounds.y + buttonRect.y + buttonRect.height / 2) * info.scaleFactor),
    };
    results.off = await runPhase({
      name: "off",
      mode: "off",
      expected: false,
      expectedForegroundKey: "overlay",
      overlayCdp: launched.overlay,
      targetCdp: target,
      point: offPoint,
      expectations: { overlayDelta: 1, targetDelta: 0 },
    });

    results.assertions.push(...results.on.assertions.map(function (entry) { return Object.assign({ phase: "on" }, entry); }));
    results.assertions.push(...results.off.assertions.map(function (entry) { return Object.assign({ phase: "off" }, entry); }));

    if (captureScreenshots) {
      results.screenshots.push(await captureScreenshot(launched.overlay, path.join(evidenceDir, "s4-clickthrough-on-overlay.png")));
      results.screenshots.push(await captureScreenshot(target, path.join(evidenceDir, "s4-clickthrough-on-target.png")));
      results.screenshots.push(await captureScreenshot(launched.overlay, path.join(evidenceDir, "s4-clickthrough-off-overlay.png")));
    }
  } finally {
    await closeProcess(launched.instance, [launched.overlay, target]);
  }
  results.timings.totalMs = Date.now() - startedAt;
  results.pass = Boolean(results.on && results.off && results.on.pass && results.off.pass && results.assertions.every(function (entry) { return entry.pass; }));
  if (!results.pass) {
    results.failureDetails = {
      on: results.on && results.on.failures,
      off: results.off && results.off.failures,
      onGate: results.on && results.on.gate,
      offGate: results.off && results.off.gate,
    };
  }
  return results;
}
