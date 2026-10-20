/**
 * Electron main for the overlay auto-scroll capture/tests (W2 UX).
 *
 * Loads the scenario page over http:// (local static server in the harness) so
 * localStorage/reload persistence behaves like a real origin, and exposes a CDP
 * endpoint for DOM assertions + screencast recording.
 */
"use strict";

const { app, BrowserWindow } = require("electron");

const CDP_PORT = process.env.DSH_CDP_PORT || "9333";
const OVERLAY_URL = process.env.DSH_OVERLAY_URL;

app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);
app.commandLine.appendSwitch("remote-allow-origins", "*");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (!OVERLAY_URL) {
  console.error("[overlay-scroll-main] DSH_OVERLAY_URL is required");
  app.exit(2);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1000,
    height: 640,
    x: 60,
    y: 60,
    title: "HireShade Overlay Auto-scroll",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadURL(OVERLAY_URL);
  win.webContents.on("did-finish-load", () => {
    console.log("[overlay-scroll-main] loaded " + OVERLAY_URL + " (cdp port " + CDP_PORT + ")");
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[overlay-scroll-main] render process gone: " + JSON.stringify(details));
    app.exit(3);
  });
});

app.on("window-all-closed", () => app.quit());
