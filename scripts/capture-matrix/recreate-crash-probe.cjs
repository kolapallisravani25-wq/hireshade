"use strict";

/**
 * S2 root-cause probe: which destroy/recreate sequences crash Electron when a
 * content-protected transparent surface is replaced by a transparent:false one?
 *
 * Env:
 *   PROBE_VARIANT  1..6 (see below)
 *   PROBE_LOG      append-only step log path
 *   PROBE_USERDATA isolated userData dir
 *
 * Variants:
 *   1 destroy protected transparent -> create transparent:false immediately
 *   2 clear protection -> destroy -> create opaque immediately
 *   3 clear protection -> destroy -> wait 400ms -> create opaque
 *   4 destroy protected transparent -> create transparent:true
 *   5 create opaque second window while A is alive (no destroy)
 *   6 destroy UNPROTECTED transparent -> create opaque immediately
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");

const variant = process.env.PROBE_VARIANT || "1";
const logFile = process.env.PROBE_LOG || "";
const userData = process.env.PROBE_USERDATA || "";
if (userData) app.setPath("userData", userData);

function log(message) {
  const line = new Date().toISOString() + " [" + variant + "] " + message + "\n";
  try {
    if (logFile) fs.appendFileSync(logFile, line);
  } catch {
    // ignore
  }
  console.log(line.trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Without this handler Electron auto-quits when the last window is destroyed,
// which makes the next loadURL fail with ERR_FAILED and masks the real crash
// behaviour we are probing.
app.on("window-all-closed", function () {
  // keep the process alive for the recreate step
});

async function createWindow(transparent, title) {
  const win = new BrowserWindow({
    width: 420,
    height: 300,
    x: 40,
    y: 40,
    show: true,
    frame: false,
    transparent: transparent,
    roundedCorners: false,
    hasShadow: false,
    backgroundColor: transparent ? "#00000000" : "#0b0d12",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL("data:text/html,<body style='background:" + (transparent ? "transparent" : "#0b0d12") + ";color:#fff'><h1>" + title + "</h1></body>");
  return win;
}

async function main() {
  await app.whenReady();
  log("ready; gpu-feature-status=" + JSON.stringify({ gpu: app.getGPUFeatureStatus ? "present" : "absent" }));
  const a = await createWindow(true, "probe-A-transparent");
  log("A created+loaded");

  if (variant === "5") {
    log("creating opaque B while A is alive");
    const b = await createWindow(false, "probe-B-opaque");
    log("SURVIVED dual-window opaque=" + !!b);
    app.quit();
    return;
  }

  if (variant !== "6") {
    a.setContentProtection(true);
    log("A setContentProtection(true)");
  }
  if (variant === "2" || variant === "3") {
    a.setContentProtection(false);
    log("A setContentProtection(false)");
  }

  a.on("closed", () => log("A closed event"));
  a.destroy();
  log("A destroyed");

  if (variant === "3") {
    await sleep(400);
    log("waited 400ms after destroy");
  }

  const transparentB = variant === "4";
  const b = await createWindow(transparentB, transparentB ? "probe-B-transparent" : "probe-B-opaque");
  log("B created+loaded transparent=" + transparentB);
  if (!transparentB) b.setContentProtection(true);
  log("SURVIVED opaque=" + !transparentB + " protected=" + !transparentB);
  app.quit();
}

main().catch(function (error) {
  log("ERROR " + (error && error.stack ? error.stack : error));
  app.quit();
  process.exitCode = 1;
});
