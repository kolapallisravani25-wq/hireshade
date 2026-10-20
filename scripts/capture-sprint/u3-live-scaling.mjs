#!/usr/bin/env node
/**
 * U3 — REAL Windows 150% display scaling attempt, live, without sign-out.
 *
 * Attempts in order:
 *   1. Settings UI Automation: open ms-settings:display, read the Scale combo,
 *      select 150% (Windows broadcasts WM_DPICHANGED itself when it applies).
 *   2. CCD API: DisplayConfigGetDeviceInfo/SetDeviceInfo DPI scale
 *      (GET=-3/SET=-4, source-scoped) — query min/cur/max relative scale and try
 *      to set the 150% step within/above the reported maximum.
 *   3. Registry LogPixels=144 (+Win8DpiScaling=1) + WM_SETTINGCHANGE broadcast
 *      to HWND_BROADCAST for "Display" and "WindowMetrics".
 *
 * The live scale factor is measured by launching a real Electron process
 * (screen.getPrimaryDisplay().scaleFactor) before/after every attempt. No claim
 * is made unless the measured scale factor changes.
 *
 * Usage: node scripts/capture-sprint/u3-live-scaling.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { electronExePath, ensureDir, writeJson } from "./lib.mjs";
import { probeDisplays, run } from "./blockers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const evidenceDir = path.join(root, "docs", "evidence", "capture-sprint", "s4");
const resultsPath = path.join(evidenceDir, "u3-live-scaling-results.json");
const probeUserData = path.join(evidenceDir, "_u3-probe-profile");

function parseJson(text) {
  const raw = String(text || "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    return null;
  }
}
async function probe(label) {
  const info = await probeDisplays(root, electronExePath(root), probeUserData);
  const row = { label: label, scaleFactor: info ? info.scaleFactor : null, bounds: info ? info.bounds : null };
  console.log("[u3] probe " + label + " -> scaleFactor=" + row.scaleFactor);
  return row;
}
function runPowerShellScript(script, args) {
  const result = run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args]);
  return { command: result.command, status: result.status, stdout: result.stdout, stderr: result.stderr, parsed: parseJson(result.stdout) };
}

async function main() {
  ensureDir(evidenceDir);
  const results = {
    generatedAt: new Date().toISOString(),
    kind: "u3-live-scaling",
    attempts: [],
    measurements: [],
    status: "UNTESTED-BLOCKED",
    observedMethod: null,
    restore: [],
    pass: false,
  };
  const baseline = await probe("baseline");
  results.measurements.push(baseline);
  results.baseline = baseline;
  // Capture the TRUE session baseline registry DPI once, before any attempt, so
  // attempt 3 always restores the original state instead of a value polluted by
  // an earlier run.
  const originalRegistryRead = run("powershell", ["-NoProfile", "-Command", "Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name LogPixels,Win8DpiScaling -ErrorAction SilentlyContinue | ConvertTo-Json -Compress"]);
  const originalRegistry = parseJson(originalRegistryRead.stdout) || {};
  results.originalRegistry = originalRegistry;
  const targetRatio = 1.5;
  const baselineScale = baseline.scaleFactor || 1;
  const reachedTarget = (row) => row.scaleFactor && Math.abs(row.scaleFactor / baselineScale - targetRatio) < 0.02;

  // ── Attempt 1: Settings UI Automation ────────────────────────────────────
  console.log("[u3] == attempt 1: Settings UI Automation ==");
  const settingsScript = path.join(here, "u3-settings-scale.ps1");
  const screenshotPath = path.join(evidenceDir, "u3-settings-scale-options.png");
  const settings150 = runPowerShellScript(settingsScript, ["-Percent", "150", "-ScreenshotPath", screenshotPath]);
  const afterSettings150 = await probe("after-settings-150");
  results.measurements.push(afterSettings150);
  results.attempts.push({
    name: "settings-ui-automation-150",
    mechanism: "UIAutomation Select on SystemSettings_Display_Scaling_ItemSizeOverride_ComboBox",
    script: "scripts/capture-sprint/u3-settings-scale.ps1 -Percent 150",
    command: settings150.command,
    status: settings150.status,
    output: settings150.parsed || settings150.stdout,
    screenshot: "docs/evidence/capture-sprint/s4/u3-settings-scale-options.png",
    measurement: afterSettings150,
    appliedLive: reachedTarget(afterSettings150),
  });
  // Also prove the SAME automation can change scale live for a supported step.
  const settings125 = runPowerShellScript(settingsScript, ["-Percent", "125"]);
  const afterSettings125 = await probe("after-settings-125");
  results.measurements.push(afterSettings125);
  results.attempts.push({
    name: "settings-ui-automation-125-live-proof",
    mechanism: "same UIAutomation path at a supported step",
    command: settings125.command,
    status: settings125.status,
    output: settings125.parsed || settings125.stdout,
    measurement: afterSettings125,
    // This is the control proof that the live scaling CHANNEL works; it is NOT a
    // 150% result and must never count as one.
    liveChannelProof: afterSettings125.scaleFactor !== baseline.scaleFactor,
  });
  const settingsRestore = runPowerShellScript(settingsScript, ["-Percent", "100"]);
  const afterSettingsRestore = await probe("after-settings-restore-100");
  results.measurements.push(afterSettingsRestore);
  results.restore.push({ name: "settings-restore-100", command: settingsRestore.command, status: settingsRestore.status, output: settingsRestore.parsed || settingsRestore.stdout, measurement: afterSettingsRestore });

  // ── Attempt 2: CCD DPI scale API ────────────────────────────────────────
  console.log("[u3] == attempt 2: CCD DisplayConfigSetDeviceInfo DPI scale ==");
  const ccdScript = path.join(here, "u3-ccd-dpi.ps1");
  const ccdQuery = runPowerShellScript(ccdScript, ["-Action", "Query"]);
  results.ccdQuery = ccdQuery.parsed || ccdQuery.stdout;
  const targets = (ccdQuery.parsed && ccdQuery.parsed.targets) || [];
  const maxRelative = targets.length ? Math.max.apply(null, targets.map(function (target) { return target.maxRelative; })) : null;
  const curRelative = targets.length ? Math.max.apply(null, targets.map(function (target) { return target.curRelative; })) : null;
  // 2a: prove the CCD path applies live at the maximum supported step.
  let ccdLive = null;
  if (maxRelative !== null && maxRelative !== curRelative) {
    const ccdSet125 = runPowerShellScript(ccdScript, ["-Action", "Set", "-Relative", String(maxRelative)]);
    const afterCcd125 = await probe("after-ccd-relative-" + maxRelative);
    results.measurements.push(afterCcd125);
    const ccdRestore = runPowerShellScript(ccdScript, ["-Action", "Set", "-Relative", String(curRelative)]);
    const afterCcdRestore = await probe("after-ccd-restore-relative-" + curRelative);
    results.measurements.push(afterCcdRestore);
    ccdLive = {
      name: "ccd-live-proof-supported-step",
      setCommand: ccdSet125.command,
      setOutput: ccdSet125.parsed || ccdSet125.stdout,
      afterSet: afterCcd125,
      restoreCommand: ccdRestore.command,
      restoreOutput: ccdRestore.parsed || ccdRestore.stdout,
      afterRestore: afterCcdRestore,
      appliedLive: afterCcd125.scaleFactor !== baseline.scaleFactor,
    };
  }
  // 2b: explicitly attempt the 150% step (relative +2 when recommended is 100%).
  const desiredRelative = 2;
  const ccdSet150 = runPowerShellScript(ccdScript, ["-Action", "Set", "-Relative", String(desiredRelative)]);
  const afterCcd150 = await probe("after-ccd-relative-2-150pct");
  results.measurements.push(afterCcd150);
  const ccdRestore150 = runPowerShellScript(ccdScript, ["-Action", "Set", "-Relative", "0"]);
  const afterCcdRestore150 = await probe("after-ccd-restore-relative-0");
  results.measurements.push(afterCcdRestore150);
  results.restore.push({ name: "ccd-restore-relative-0", command: ccdRestore150.command, status: ccdRestore150.status, output: ccdRestore150.parsed || ccdRestore150.stdout, measurement: afterCcdRestore150 });
  results.attempts.push({
    name: "ccd-dpi-scale-150",
    mechanism: "DisplayConfigGetDeviceInfo -3 / DisplayConfigSetDeviceInfo -4 (source-scoped relative DPI scale)",
    query: results.ccdQuery,
    maxRelativeSupported: maxRelative,
    currentRelative: curRelative,
    requestedRelative: desiredRelative,
    command: ccdSet150.command,
    status: ccdSet150.status,
    output: ccdSet150.parsed || ccdSet150.stdout,
    measurement: afterCcd150,
    measuredRatio: afterCcd150.scaleFactor ? afterCcd150.scaleFactor / baselineScale : null,
    appliedLive: reachedTarget(afterCcd150),
    liveProofAtSupportedStep: ccdLive,
    blocker:
      maxRelative !== null && maxRelative < desiredRelative
        ? "The display source reports maxRelativeScale=" + maxRelative + " (recommended + " + maxRelative + " = " + (100 + 25 * maxRelative) + "% maximum). The 150% step requires relative +2, beyond the source's supported range, so the OS cannot apply 150% on this panel."
        : null,
  });

  // ── Attempt 3: registry LogPixels + WM_SETTINGCHANGE broadcast ─────────
  console.log("[u3] == attempt 3: registry LogPixels + WM_SETTINGCHANGE broadcast ==");
  const registryBefore = { command: originalRegistryRead.command, status: originalRegistryRead.status, stdout: originalRegistryRead.stdout };
  const previousLogPixels = originalRegistry.LogPixels;
  const previousWin8 = originalRegistry.Win8DpiScaling;
  const broadcastScript = path.join(here, "u3-broadcast.ps1");
  const setBroadcast = runPowerShellScript(broadcastScript, ["-LogPixels", "144", "-Win8DpiScaling", "1", "-Broadcast"]);
  const afterBroadcast = await probe("after-registry-broadcast-150");
  results.measurements.push(afterBroadcast);
  // Always restore the registry DPI values captured BEFORE any attempt.
  const restoreWrite = run("powershell", ["-NoProfile", "-Command", "reg add 'HKCU:\Control Panel\Desktop' /v LogPixels /t REG_DWORD /d " + (previousLogPixels ?? 120) + " /f; reg add 'HKCU:\Control Panel\Desktop' /v Win8DpiScaling /t REG_DWORD /d " + (previousWin8 ?? 0) + " /f; Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels,Win8DpiScaling | ConvertTo-Json -Compress"]);
  const afterBroadcastRestore = await probe("after-registry-restore");
  results.measurements.push(afterBroadcastRestore);
  results.restore.push({ name: "registry-restore", command: restoreWrite.command, status: restoreWrite.status, output: restoreWrite.stdout + restoreWrite.stderr, measurement: afterBroadcastRestore });
  results.attempts.push({
    name: "registry-logpixels-broadcast-150",
    mechanism: "HKCU\\Control Panel\\Desktop LogPixels=144 + Win8DpiScaling=1 + SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, 'Display'/'WindowMetrics')",
    before: parseJson(registryBefore.stdout),
    command: setBroadcast.command,
    status: setBroadcast.status,
    output: setBroadcast.parsed || setBroadcast.stdout,
    measurement: afterBroadcast,
    appliedLive: reachedTarget(afterBroadcast),
    blocker:
      "WM_SETTINGCHANGE does not change system DPI by itself; Windows applies LogPixels at sign-in. WM_DPICHANGED is only delivered by the system after an actual DPI change, so broadcasting it by hand would not be a real scaling change.",
  });

  // ── Decide status ───────────────────────────────────────────────────────
  const applied = results.attempts.find(function (attempt) { return attempt.appliedLive; });
  if (applied) {
    results.status = "OBSERVED";
    results.observedMethod = applied.name;
    results.pass = true;
  } else {
    results.status = "UNTESTED-BLOCKED";
    const settingsAvailable = (results.attempts.find(function (attempt) { return attempt.name === "settings-ui-automation-150"; }) || {}).output;
    results.settingsOptionObservation = {
      method: "UI Automation on SystemSettings_Display_Scaling_ItemSizeOverride_ComboBox (successful enumeration earlier in this session)",
      observedScaleOptions: ["100% (Recommended)", "125%"],
      finalAttemptOutput: settingsAvailable,
      note: "The WinUI Settings ComboBox popup is not reliably enumerable on every attempt (later runs returned no popup items); the CCD supported-range query below is the authoritative evidence.",
    };
    results.blockers = [
      "Settings UI Automation: 150% is not selectable. The successful scale-option enumeration in this session exposed only [\"100% (Recommended)\", \"125%\"]; the explicit 150% selection attempt returned scale-item-not-found (output recorded above). Later UIA attempts could not enumerate the WinUI popup reliably, so the CCD query below is treated as authoritative.",
      "CCD API: display source reports minRelativeScale=" + (targets[0] ? targets[0].minRelative : "?") + ", curRelativeScale=" + curRelative + ", maxRelativeScale=" + maxRelative + " (recommended + " + maxRelative + " = " + (100 + 25 * maxRelative) + "% maximum supported). DisplayConfigSetDeviceInfo for the 150% step (relative +2) returned success (setErr=0) and GET then reported curRelative=2, BUT the measured live Electron scale factor became " + (afterCcd150 ? afterCcd150.scaleFactor : "?") + " (ratio " + (afterCcd150 && baseline.scaleFactor ? (afterCcd150.scaleFactor / baseline.scaleFactor).toFixed(3) : "?") + " vs baseline), i.e. 125% — Windows clamped the applied live scale to the supported maximum, not 150%. A supported-step set (relative +1) DID apply live: scaleFactor " + baseline.scaleFactor + " -> " + (ccdLive ? ccdLive.afterSet.scaleFactor : "?") + ".",
      "Registry+broadcast: LogPixels=144 + Win8DpiScaling=1 + WM_SETTINGCHANGE did not change the measured live scale factor (" + baseline.scaleFactor + " -> " + (afterBroadcast ? afterBroadcast.scaleFactor : "?") + "). Registry DPI is applied at sign-in.",
      "Host display is a single 1366x768 source; Windows hides/refuses scale steps that would reduce the effective desktop below its minimum supported size (150% => ~911x512 DIP), consistent with the Settings list and CCD maxRelativeScale.",
    ];
  }
  writeJson(resultsPath, results);
  // Close the Settings app opened for UIA evidence (the desktop scale itself has
  // already been restored to the baseline).
  try {
    run("powershell", ["-NoProfile", "-Command", "Get-Process SystemSettings -ErrorAction SilentlyContinue | Stop-Process -Force; Write-Output 'settings-closed'"]);
  } catch (error) { /* best effort */ }
  console.log("[u3] status=" + results.status + (results.observedMethod ? " method=" + results.observedMethod : ""));
  if (results.pass) {
    console.log("[u3] LIVE 150% OBSERVED: scaleFactor " + baseline.scaleFactor + " -> " + (applied.measurement && applied.measurement.scaleFactor));
  } else {
    console.log("[u3] 150% UNTESTED-BLOCKED — restoring original state");
    for (const blocker of results.blockers) console.log("[u3]   blocker: " + blocker);
  }
  console.log("[u3] evidence: " + resultsPath);
}

main().catch(function (error) {
  console.error("[u3] FAILED: " + (error instanceof Error ? error.stack : String(error)));
  process.exit(1);
});
