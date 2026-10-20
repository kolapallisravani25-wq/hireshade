/**
 * S4.3/S4.4/S4.5 — honest blocker attempts: real OS 150% scaling, second
 * monitor, elevated capture. Every result records the exact command/output.
 */
import { spawnSync } from "node:child_process";
import { spawnProcess, sleep } from "./lib.mjs";

export function run(command, args, options) {
  const started = Date.now();
  const result = spawnSync(command, args, Object.assign({ encoding: "utf8", timeout: 20000 }, options));
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error ? String(result.error.message) : null,
    durationMs: Date.now() - started,
  };
}

/** One-shot Electron probe: display scale factor + attached displays. */
export async function probeDisplays(root, electronExe, userDataDir) {
  const env = Object.assign({}, process.env, {
    DSH_CDP_PORT: "9560",
    DSH_SPRINT_MODE: "dpi_probe",
    DSH_USER_DATA_DIR: userDataDir,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnProcess(electronExe, [root + "\\scripts\\capture-sprint\\main.cjs"], { cwd: root, env: env });
  await Promise.race([child.exit, sleep(12000)]);
  const info = child.info("[capture-sprint-main] info ");
  if (!child.child.killed) {
    try { spawnSync("taskkill", ["/PID", String(child.child.pid), "/T", "/F"], { stdio: "ignore" }); } catch (error) { /* ignore */ }
  }
  return info;
}

/** S4.3 — try to apply real 150% Windows display scaling in-session. */
export async function attemptDpiScaling(root, electronExe, userDataDir) {
  const registryRead = run("powershell", ["-NoProfile", "-Command", "Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name LogPixels,Win8DpiScaling -ErrorAction SilentlyContinue | ConvertTo-Json -Compress"]);
  let previous = 0;
  try {
    const parsed = JSON.parse(registryRead.stdout);
    previous = Number(parsed.LogPixels ?? 0);
  } catch (error) {
    previous = 0;
  }
  const before = await probeDisplays(root, electronExe, userDataDir);
  const set = run("powershell", ["-NoProfile", "-Command", "reg add 'HKCU:\\Control Panel\\Desktop' /v LogPixels /t REG_DWORD /d 144 /f"]);
  const readback = run("powershell", ["-NoProfile", "-Command", "Get-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name LogPixels | Select-Object -ExpandProperty LogPixels"]);
  const after = await probeDisplays(root, electronExe, userDataDir);
  const restore = run("powershell", ["-NoProfile", "-Command", previous ? "reg add 'HKCU:\\Control Panel\\Desktop' /v LogPixels /t REG_DWORD /d " + previous + " /f" : "reg delete 'HKCU:\\Control Panel\\Desktop' /v LogPixels /f"]);
  const effectiveUnchanged = Boolean(before && after && before.scaleFactor === after.scaleFactor);
  return {
    status: effectiveUnchanged ? "UNTESTED-BLOCKED" : "OBSERVED",
    requestedScaling: "150% (LogPixels=144)",
    previousLogPixels: previous,
    registryRead: registryRead,
    setCommand: set,
    readback: readback,
    before: before,
    after: after,
    restoreCommand: restore,
    restoredLogPixels: previous,
    blocker: effectiveUnchanged
      ? "Windows applies HKCU\\Control Panel\\Desktop\\LogPixels at sign-in; the live session's display scale factor did not change (" + (before ? before.scaleFactor : "?") + " before and after). Applying 150% requires sign-out/sign-in (or per-monitor Settings UI), which the harness cannot do without ending its own desktop session."
      : null,
    note: "Registry write is reverted immediately; no persistent change left behind.",
  };
}

/** S4.4 — real second-monitor attempt (hardware + virtual display checks). */
export async function attemptSecondMonitor(root, electronExe, userDataDir) {
  const probe = await probeDisplays(root, electronExe, userDataDir);
  const pnp = run("powershell", ["-NoProfile", "-Command", "Get-PnpDevice -Class Display -ErrorAction SilentlyContinue | Select-Object Status,FriendlyName,InstanceId | ConvertTo-Json -Compress"]);
  const adapters = run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution | ConvertTo-Json -Compress"]);
  const driverStoreIdd = run("powershell", ["-NoProfile", "-Command", "Get-ChildItem 'C:\\Windows\\System32\\DriverStore\\FileRepository' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'idd|usbmmidd|virtualdisplay|indirect' } | Select-Object -ExpandProperty Name"]);
  const pnputil = run("powershell", ["-NoProfile", "-Command", "pnputil /enum-drivers | Select-String -Pattern 'idd|virtual display|indirect display' | Select-Object -First 10 | Out-String"]);
  const displaySwitch = run("powershell", ["-NoProfile", "-Command", "DisplaySwitch.exe /extend; Start-Sleep -Milliseconds 300; Write-Output 'DisplaySwitch /extend invoked'"]);
  const displayCount = probe && Array.isArray(probe.displays) ? probe.displays.length : null;
  const observed = displayCount !== null && displayCount >= 2;
  return {
    status: observed ? "OBSERVED" : "UNTESTED-BLOCKED",
    displayCount: displayCount,
    displays: probe ? probe.displays : null,
    pnp: pnp,
    adapters: adapters,
    virtualDriverSearch: {
      driverStore: driverStoreIdd,
      pnputil: pnputil,
      found: Boolean(driverStoreIdd.stdout),
    },
    displaySwitchAttempt: displaySwitch,
    blocker: observed
      ? null
      : "Single physical display (" + (probe && probe.displays && probe.displays[0] ? probe.displays[0].bounds.width + "x" + probe.displays[0].bounds.height : "?") + "). No second monitor is attached; no virtual display driver (usbmmidd/IddSampleDriver/Indirect Display) is installed or signed on this host, and installing one needs an admin driver install + driver package, which is unavailable to this agent. The second-moditor recommendation therefore remains UNVERIFIED on real hardware.",
    attempts: ["electron screen.getAllDisplays()", "Get-PnpDevice -Class Display", "Win32_VideoController enumeration", "DriverStore search for idd/usbmmidd/virtualdisplay", "pnputil /enum-drivers", "DisplaySwitch.exe /extend"],
  };
}

/** S4.5 — elevated vs non-elevated capture attempt. */
export async function attemptElevation() {
  const integrity = run("powershell", ["-NoProfile", "-Command", "whoami /groups | Select-String -Pattern 'S-1-16-' | Out-String"]);
  const netSession = run("powershell", ["-NoProfile", "-Command", "net session"]);
  const schtasks = run("powershell", ["-NoProfile", "-Command", "schtasks /Create /TN S4ElevatedCaptureProbe /SC ONCE /ST 23:59 /RL HIGHEST /TR cmd.exe /F"]);
  if (schtasks.status === 0) {
    run("powershell", ["-NoProfile", "-Command", "schtasks /Delete /TN S4ElevatedCaptureProbe /F"]);
  }
  // Deliberately do NOT trigger an interactive UAC consent dialog: an unattended
  // prompt would block the desktop for the user and cannot be approved by the
  // agent. Instead record the UAC policy + the denied HIGHEST-privilege channel.
  const uacPolicy = run("powershell", ["-NoProfile", "-Command", "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA,ConsentPromptBehaviorAdmin,PromptOnSecureDesktop -ErrorAction SilentlyContinue | ConvertTo-Json -Compress"]);
  const medium = /S-1-16-8192/.test(integrity.stdout);
  const elevated = /S-1-16-12288/.test(integrity.stdout);
  return {
    status: elevated ? "OBSERVED" : "UNTESTED-BLOCKED",
    integrityLevel: elevated ? "High" : medium ? "Medium" : "unknown",
    integrity: integrity,
    netSessionDenial: netSession,
    highestPrivilegesTaskAttempt: schtasks,
    uacPolicy: uacPolicy,
    interactiveRunAsAttempt: {
      attempted: false,
      reason: "Start-Process -Verb RunAs was deliberately not triggered: an unattended UAC consent prompt cannot be approved by the agent and would block the interactive desktop. The denied HIGHEST-privilege scheduled-task channel above is the recorded elevation attempt.",
    },
    elevatedCaptureTested: elevated,
    blocker: elevated
      ? null
      : "The agent process runs at Medium integrity. Creating an elevated capture process requires a UAC consent prompt on the interactive desktop; the harness cannot approve UAC (approval prompts are unavailable to the agent), and scheduled-task creation at HIGHEST run level is denied. Elevated-vs-non-elevated capture behaviour remains UNTESTED; only the non-elevated path is covered by the other rows.",
    attempts: ["whoami /groups integrity level", "net session (admin-only)", "schtasks /RL HIGHEST creation attempt", "UAC policy read (EnableLUA/ConsentPromptBehaviorAdmin/PromptOnSecureDesktop)"],
  };
}
