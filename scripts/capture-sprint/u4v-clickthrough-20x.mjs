#!/usr/bin/env node
/**
 * V4 — click-through reliability run: 20 fresh Electron launches, each proving
 * ON (target receives pass-through click) and OFF (overlay control receives
 * click) only after Electron tracked-state + Win32 WS_EX_TRANSPARENT (0x20) +
 * bounded GetForegroundWindow assertions pass. Physical SendInput happens inside
 * the gated Win32 helper, never after a fixed sleep.
 *
 * Usage: node scripts/capture-sprint/u4v-clickthrough-20x.mjs [iterations]
 */
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOverlayHtml, buildTargetHtml } from "./pages.mjs";
import { ensureDir, startServer, writeJson } from "./lib.mjs";
import { runClickThrough } from "./click-through.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const evidenceDir = path.join(root, "docs", "evidence", "capture-sprint", "s4");
const resultsPath = path.join(evidenceDir, "u4v-clickthrough-20x.json");
const iterations = Number(process.argv[2] || 20);

// Each iteration owns two Electron windows. closeProcess() normally reaps them,
// but a failed/gated iteration can leave the tree alive; stale windows then win
// the foreground race in the next launch. Force a clean slate between runs.
function reapElectron() {
  if (process.platform !== "win32") return;
  // Only reclaim stale S4 HARness windows. A blanket /IM electron.exe kill also
  // terminates unrelated Electron apps (product demo, DSH UI) and other agents'
  // harnesses, which makes the reliability run fail for reasons unrelated to
  // click-through.
  spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'S4*' } | ForEach-Object { taskkill /PID $_.Id /T /F | Out-Null }",
  ], { stdio: "ignore" });
}

function summarizeTimings(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  return {
    min: sorted[0],
    p50: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
    mean: Math.round(values.reduce(function (sum, value) { return sum + value; }, 0) / values.length),
  };
}

async function main() {
  ensureDir(evidenceDir);
  const server = await startServer({ "/target": buildTargetHtml(), "/overlay": buildOverlayHtml() });
  const startedAt = Date.now();
  const results = {
    generatedAt: new Date().toISOString(),
    kind: "u4v-clickthrough-20x",
    iterations: iterations,
    method: {
      gate: "bounded poll of Win32 WS_EX_TRANSPARENT (0x20) on the overlay HWND + GetForegroundWindow == expected HWND (target for ON, overlay for OFF), then SendInput in the same PowerShell process",
      electronAuthority: "main-process tracked ignoreMouse value + HWNDs via IPC (uses the Electron getter when the runtime exposes one)",
      foreground: "AttachThreadInput + SetForegroundWindow (forceForeground) before the bounded gate",
      counters: "bounded poll for the counter delta, no fixed post-click sleep",
    },
    perIteration: [],
    passCount: 0,
    failCount: 0,
    pass: false,
  };
  try {
    for (let index = 0; index < iterations; index++) {
      const iterationStarted = Date.now();
      reapElectron();
      await new Promise((resolve) => setTimeout(resolve, 400));
      let result = null;
      let error = null;
      try {
        result = await runClickThrough(root, server, evidenceDir, { iteration: index, captureScreenshots: index === 0 });
      } catch (caught) {
        error = caught instanceof Error ? (caught.stack || caught.message) : String(caught);
      }
      const durationMs = Date.now() - iterationStarted;
      const pass = Boolean(result && result.pass);
      if (pass) results.passCount += 1;
      else results.failCount += 1;
      results.perIteration.push({
        iteration: index,
        pass: pass,
        durationMs: durationMs,
        error: error,
        launch: result ? result.launch : null,
        launchAttempts: result ? result.launchAttempts : null,
        on: result ? {
          pass: result.on.pass,
          tracked: result.on.electronState && result.on.electronState.ignoreMouseTracked,
          expectedTransparent: result.on.expectedTransparent,
          expectedForegroundHwnd: result.on.expectedForegroundHwnd,
          gate: result.on.gate ? {
            ok: result.on.gate.ok,
            clicked: result.on.gate.clicked,
            attempts: result.on.gate.attempts,
            elapsedMs: result.on.gate.elapsedMs,
            stateAtAssert: result.on.gate.stateAtAssert,
          } : null,
          counters: result.on.counters,
          failures: result.on.failures,
          timings: result.on.timings,
        } : null,
        off: result ? {
          pass: result.off.pass,
          tracked: result.off.electronState && result.off.electronState.ignoreMouseTracked,
          expectedTransparent: result.off.expectedTransparent,
          expectedForegroundHwnd: result.off.expectedForegroundHwnd,
          gate: result.off.gate ? {
            ok: result.off.gate.ok,
            clicked: result.off.gate.clicked,
            attempts: result.off.gate.attempts,
            elapsedMs: result.off.gate.elapsedMs,
            stateAtAssert: result.off.gate.stateAtAssert,
          } : null,
          counters: result.off.counters,
          failures: result.off.failures,
          timings: result.off.timings,
        } : null,
        failureDetails: result ? result.failureDetails : null,
      });
      reapElectron();
      console.log("[u4v] iteration " + (index + 1) + "/" + iterations + " " + (pass ? "PASS" : "FAIL") + " (" + durationMs + " ms)" +
        (pass ? "" : " on=" + JSON.stringify(result && result.on && result.on.failures) + " off=" + JSON.stringify(result && result.off && result.off.failures)));
    }
    const onGateElapsed = results.perIteration.map(function (row) { return row.on && row.on.gate ? row.on.gate.elapsedMs : null; }).filter(function (value) { return typeof value === "number"; });
    const offGateElapsed = results.perIteration.map(function (row) { return row.off && row.off.gate ? row.off.gate.elapsedMs : null; }).filter(function (value) { return typeof value === "number"; });
    results.timings = {
      totalMs: Date.now() - startedAt,
      perIterationMs: summarizeTimings(results.perIteration.map(function (row) { return row.durationMs; })),
      onGateMs: summarizeTimings(onGateElapsed),
      offGateMs: summarizeTimings(offGateElapsed),
    };
    const validRuns = results.perIteration.filter(function (row) { return !row.launch || row.launch.success !== false; }).length;
    const launchFailures = results.perIteration.filter(function (row) { return row.launch && row.launch.success === false; }).length;
    results.launchSuccessCount = iterations - launchFailures;
    results.launchFailureCount = launchFailures;
    results.launchSuccessRate = iterations ? (iterations - launchFailures) / iterations : 0;
    results.validRuns = validRuns;
    results.behaviorPassCountAmongValid = results.perIteration.filter(function (row) { return row.pass && (!row.launch || row.launch.success !== false); }).length;
    results.behaviorPassRateAmongValid = validRuns ? results.behaviorPassCountAmongValid / validRuns : 0;
    results.retriedLaunches = results.perIteration.filter(function (row) { return row.launch && row.launch.attempts > 1; }).length;
    results.pass = results.failCount === 0 && results.passCount === iterations && launchFailures === 0;
    results.failureSummary = results.perIteration.filter(function (row) { return !row.pass; }).map(function (row) {
      return {
        iteration: row.iteration,
        error: row.error,
        on: row.on && { tracked: row.on.tracked, gate: row.on.gate, counters: row.on.counters, failures: row.on.failures },
        off: row.off && { tracked: row.off.tracked, gate: row.off.gate, counters: row.off.counters, failures: row.off.failures },
        failureDetails: row.failureDetails,
        launch: row.launch,
        launchAttempts: row.launchAttempts,
      };
    });
    results.screenshots = results.perIteration.length ? ["docs/evidence/capture-sprint/s4/s4-clickthrough-on-overlay.png", "docs/evidence/capture-sprint/s4/s4-clickthrough-on-target.png", "docs/evidence/capture-sprint/s4/s4-clickthrough-off-overlay.png"] : [];
    writeJson(resultsPath, results);
    console.log("[u4v] behavior " + results.behaviorPassCountAmongValid + "/" + validRuns + " valid runs (" + (results.behaviorPassRateAmongValid * 100).toFixed(1) + "%), launch " + results.launchSuccessCount + "/" + iterations + " (" + (results.launchSuccessRate * 100).toFixed(1) + "%), retried launches=" + results.retriedLaunches + ", total wall " + ((Date.now() - startedAt) / 1000).toFixed(1) + " s -> " + resultsPath);
    if (!results.pass) throw new Error("click-through flake detected: " + results.failCount + " failed iterations");
  } finally {
    await server.close();
  }
}

main().catch(function (error) {
  console.error("[u4v] FAILED: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
