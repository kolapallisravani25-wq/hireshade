#!/usr/bin/env node
/**
 * S4 capture-sprint — closes the untested capture list with REAL evidence.
 *
 * Full run sections:
 *   1. OS click-through (dedicated target window behind a protected overlay; ON and OFF).
 *   2. Chrome AND Edge full-screen share + tab share on Windows (auto-select flags,
 *      real getDisplayMedia, CDP pixel sampling, protected + unprotected control).
 *   3. Real OS 150% scaling attempt (registry) + in-session effective-scale probe.
 *   4. Second monitor attempt (hardware + virtual-display driver checks).
 *   5. Elevated vs non-elevated capture attempt.
 *
 * --quick (used by make demo): click-through + cheap environment checks only.
 *
 * Usage: node scripts/capture-sprint/run-capture-sprint.mjs [--quick]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppTabHtml, buildOverlayHtml, buildShareHtml, buildTargetHtml } from "./pages.mjs";
import {
  closeProcess,
  ensureDir,
  evaluate,
  electronExePath,
  electronVersion,
  launchElectron,
  sleep,
  startServer,
  waitForPage,
  writeJson,
} from "./lib.mjs";
import { runClickThrough } from "./click-through.mjs";
import { runControlShares, runProtectedShares } from "./browser-share.mjs";
import { attemptDpiScaling, attemptElevation, attemptSecondMonitor, probeDisplays, run } from "./blockers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
// Evidence lives in its own subdirectory: docs/evidence/capture-sprint/ is also
// written by other sprint tasks, and a concurrent cleanup wiped top-level files
// during an early run.
const evidenceDir = path.join(root, "docs", "evidence", "capture-sprint", "s4");
const quick = process.argv.includes("--quick");

async function launchOverlay(server, stealth, userDataDir) {
  let lastError = null;
  for (const port of [9650, 9651, 9652, 9653, 9654]) {
    const instance = launchElectron(root, { mode: "overlay", origin: server.origin, stealth: stealth, clickThrough: false, userDataDir: userDataDir, port: port });
    const ready = await waitForPage(port, "/overlay", "window.__overlayReady === true").catch(function (error) { lastError = error; return null; });
    if (ready) return { instance: instance, cdp: ready.cdp };
    await closeProcess(instance, []);
  }
  throw new Error("could not launch overlay window: " + String(lastError));
}

function sectionStatus(section) {
  if (!section) return "MISSING";
  if (section.pass === false) return "FAIL";
  if (Array.isArray(section.untested) && section.untested.length > 0 && (!Array.isArray(section.runs) || section.runs.every(function (row) { return row.status !== "OBSERVED"; }))) return "UNTESTED-BLOCKED";
  return "PASS";
}

async function main() {
  ensureDir(evidenceDir);
  const started = Date.now();
  const electronExe = electronExePath(root);
  const profileDir = path.join(evidenceDir, "electron-profile");
  mkdirSync(profileDir, { recursive: true });
  const server = await startServer({
    "/target": buildTargetHtml(),
    "/overlay": buildOverlayHtml(),
    "/share": buildShareHtml(),
    "/app-tab": buildAppTabHtml(),
  });
  console.log("[s4] serving " + server.origin + (quick ? " (quick: click-through + environment)" : " (full capture sprint)"));
  const results = {
    generatedAt: new Date().toISOString(),
    quick: quick,
    environment: {
      platform: process.platform,
      node: process.version,
      electron: electronVersion(root),
      host: process.env.COMPUTERNAME || null,
    },
    sections: {},
    assertions: [],
    pass: false,
  };
  function check(name, pass, detail) {
    results.assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
    console.log("[s4]   " + (pass ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " (" + JSON.stringify(detail) + ")" : ""));
  }

  try {
    // ── 1. OS click-through ────────────────────────────────────────────────
    console.log("");
    console.log("[s4] == 1. OS click-through (dedicated click-target window) ==");
    results.sections.clickThrough = await runClickThrough(root, server, evidenceDir);
    check("click-through-proof", results.sections.clickThrough.pass, results.sections.clickThrough.timings);

    if (quick) {
      console.log("");
      console.log("[s4] == quick environment checks ==");
      const probe = await probeDisplays(root, electronExe, path.join(profileDir, "quick-probe"));
      results.sections.displays = {
        status: probe && probe.displays && probe.displays.length >= 2 ? "OBSERVED" : "UNTESTED-BLOCKED",
        displayCount: probe && probe.displays ? probe.displays.length : null,
        displays: probe ? probe.displays : null,
        blocker: probe && probe.displays && probe.displays.length >= 2 ? null : "Single-display host; full second-monitor test runs in the non-quick sprint.",
      };
      const integrity = run("powershell", ["-NoProfile", "-Command", "whoami /groups | Select-String -Pattern 'S-1-16-' | Out-String"]);
      results.sections.elevationQuick = {
        integrity: integrity,
        elevated: /S-1-16-12288/.test(integrity.stdout),
        status: /S-1-16-12288/.test(integrity.stdout) ? "OBSERVED" : "UNTESTED-BLOCKED",
      };
      check("quick-display-enumerated", results.sections.displays.displayCount !== null, results.sections.displays.displayCount);
      // Informational integrity probe: expected Medium (non-elevated). Assert the
      // probe ran, not that the process is elevated.
      check("quick-elevation-readable", typeof integrity.status === "number", { status: integrity.status, elevated: results.sections.elevationQuick.elevated });
    } else {
      // ── 2. Chrome/Edge share (protected overlay, then unprotected control) ─
      console.log("");
      console.log("[s4] == 2. Chrome/Edge full-screen + tab share ==");
      let protectedOverlay = await launchOverlay(server, true, path.join(profileDir, "protected"));
      try {
        const info = protectedOverlay.instance.info("[capture-sprint-main] info ");
        results.sections.browserShareProtected = await runProtectedShares(root, server, evidenceDir, info);
        results.sections.browserShareProtected.overlay = info;
        const observedProtected = results.sections.browserShareProtected.runs.filter(function (row) { return row.status === "OBSERVED"; });
        check(
          "browser-share-observed",
          observedProtected.length > 0,
          results.sections.browserShareProtected.runs.map(function (row) { return { browser: row.browser, mode: row.mode, status: row.status, error: row.capture.error }; }),
        );
        check("browser-share-no-failures", results.sections.browserShareProtected.failures.length === 0, results.sections.browserShareProtected.failures);
      } finally {
        await closeProcess(protectedOverlay.instance, [protectedOverlay.cdp]);
      }

      let controlOverlay = await launchOverlay(server, false, path.join(profileDir, "control"));
      try {
        const info = controlOverlay.instance.info("[capture-sprint-main] info ");
        results.sections.browserShareControl = await runControlShares(root, server, evidenceDir, info);
        check(
          "browser-share-control-observed",
          results.sections.browserShareControl.runs.some(function (row) { return row.status === "OBSERVED"; }),
          results.sections.browserShareControl.runs.map(function (row) { return { browser: row.browser, status: row.status, error: row.capture.error }; }),
        );
        check("browser-share-control-no-failures", results.sections.browserShareControl.failures.length === 0, results.sections.browserShareControl.failures);
      } finally {
        await closeProcess(controlOverlay.instance, [controlOverlay.cdp]);
      }

      // ── 3. Real 150% OS scaling attempt ─────────────────────────────────
      console.log("");
      console.log("[s4] == 3. real OS 150% scaling attempt ==");
      results.sections.dpiScaling = await attemptDpiScaling(root, electronExe, path.join(profileDir, "dpi-probe"));
      check("dpi-scaling-honest", results.sections.dpiScaling.status === "OBSERVED" || results.sections.dpiScaling.status === "UNTESTED-BLOCKED", { status: results.sections.dpiScaling.status, blocker: results.sections.dpiScaling.blocker });

      // ── 4. Second monitor attempt ───────────────────────────────────────
      console.log("");
      console.log("[s4] == 4. second monitor attempt ==");
      results.sections.secondMonitor = await attemptSecondMonitor(root, electronExe, path.join(profileDir, "monitor-probe"));
      check("second-monitor-honest", results.sections.secondMonitor.status === "OBSERVED" || results.sections.secondMonitor.status === "UNTESTED-BLOCKED", { displayCount: results.sections.secondMonitor.displayCount, blocker: results.sections.secondMonitor.blocker });

      // ── 5. Elevated vs non-elevated attempt ─────────────────────────────
      console.log("");
      console.log("[s4] == 5. elevated capture attempt ==");
      results.sections.elevation = await attemptElevation();
      check("elevation-honest", results.sections.elevation.status === "OBSERVED" || results.sections.elevation.status === "UNTESTED-BLOCKED", { status: results.sections.elevation.status, integrity: results.sections.elevation.integrityLevel, blocker: results.sections.elevation.blocker });
    }

    const required = results.assertions.filter(function (entry) { return entry.name === "click-through-proof" || entry.name === "browser-share-no-failures" || entry.name === "browser-share-control-no-failures"; });
    results.pass = required.every(function (entry) { return entry.pass; });
    results.sectionStatus = {};
    for (const [name, section] of Object.entries(results.sections)) results.sectionStatus[name] = sectionStatus(section);
    results.durationMs = Date.now() - started;
    const file = path.join(evidenceDir, quick ? "s4-quick-results.json" : "s4-capture-sprint-results.json");
    results.evidenceFile = path.relative(root, file).replace(/\\/g, "/");
    writeJson(file, results);
    console.log("");
    console.log("[s4] section status: " + JSON.stringify(results.sectionStatus));
    console.log("[s4] overall " + (results.pass ? "PASS" : "FAIL") + " -> " + file + " (" + ((Date.now() - started) / 1000).toFixed(1) + " s)");
    if (!results.pass) throw new Error("capture-sprint required checks failed");
  } finally {
    await server.close();
  }
}

main().catch(function (error) {
  console.error("[s4] FAILED:", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
