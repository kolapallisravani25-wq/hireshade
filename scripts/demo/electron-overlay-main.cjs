/**
 * Electron main process for the overlay e2e proof (G-005).
 *
 * Loads the generated overlay HTML (real rendering surface: frameless,
 * transparent, always-on-top window, same primitive family as the product
 * overlay) and exposes a CDP endpoint so the harness can assert DOM text and
 * capture a screenshot. Owned by the harness; the product Electron shell
 * (artifacts/desktop-electron/main.js) is untouched.
 */
"use strict";

const { app, BrowserWindow } = require("electron");

const CDP_PORT = process.env.DSH_CDP_PORT || "9333";
const OVERLAY_HTML = process.env.DSH_OVERLAY_HTML;

// Must be set before app ready for the debugging endpoint to bind.
app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);
app.commandLine.appendSwitch("remote-allow-origins", "*");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (!OVERLAY_HTML) {
  console.error("[overlay-main] DSH_OVERLAY_HTML is required");
  app.exit(2);
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 980,
    height: 600,
    x: 80,
    y: 80,
    title: "HireShade Overlay Demo",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: true,
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

  // Mirror the product overlay primitive (re-applied on show).
  win.setAlwaysOnTop(true, "screen-saver");
  win.setContentProtection(false);

  win.loadFile(OVERLAY_HTML);
  win.webContents.on("did-finish-load", () => {
    console.log("[overlay-main] loaded " + OVERLAY_HTML + " (cdp port " + CDP_PORT + ")");
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[overlay-main] render process gone: " + JSON.stringify(details));
    app.exit(3);
  });
});

app.on("window-all-closed", () => app.quit());
