/**
 * O3 — Electron main for the overlay-size acceptance harness.
 *
 * Owned by the harness (scripts/overlay-size); it does NOT modify the product
 * Electron shell. Creates:
 *   - an overlay BrowserWindow (frameless/transparent/always-on-top) loading the
 *     generated acceptance page;
 *   - optionally a background application window behind it, used to prove that
 *     OS-level clicks pass through the overlay (setIgnoreMouseEvents).
 *
 * Env: DSH_CDP_PORT, DSH_OVERLAY_URL, DSH_BACKGROUND_URL, DSH_CLICK_THROUGH=1,
 *      DSH_USER_DATA_DIR (persistence across restart).
 */
"use strict";

const { app, BrowserWindow, screen } = require("electron");

const CDP_PORT = process.env.DSH_CDP_PORT || "9333";
const OVERLAY_URL = process.env.DSH_OVERLAY_URL;
const BACKGROUND_URL = process.env.DSH_BACKGROUND_URL;
const CLICK_THROUGH = process.env.DSH_CLICK_THROUGH === "1";
const USER_DATA_DIR = process.env.DSH_USER_DATA_DIR;

app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);
app.commandLine.appendSwitch("remote-allow-origins", "*");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (!OVERLAY_URL) {
  console.error("[size-main] DSH_OVERLAY_URL is required");
  app.exit(2);
}
if (USER_DATA_DIR) app.setPath("userData", USER_DATA_DIR);

const WINDOW_WIDTH = 1000;
const WINDOW_HEIGHT = 760;
const WINDOW_X = 120;
const WINDOW_Y = 120;

function createWindows() {
  const bounds = { x: WINDOW_X, y: WINDOW_Y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor;
  const workArea = display.workArea;
  const x = Math.min(bounds.x, Math.max(workArea.x, workArea.x + workArea.width - bounds.width));
  const y = Math.min(bounds.y, Math.max(workArea.y, workArea.y + workArea.height - bounds.height));
  const overlayBounds = { x: x, y: y, width: bounds.width, height: bounds.height };

  let background = null;
  if (CLICK_THROUGH) {
    background = new BrowserWindow({
      x: x,
      y: y,
      width: bounds.width,
      height: bounds.height,
      title: "HireShade size background app",
      show: true,
      backgroundColor: "#0f172a",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // Keep the background app above unrelated windows so the OS click (which
    // must pass through the overlay) actually lands on our counter page.
    background.setAlwaysOnTop(true, "screen-saver");
    background.loadURL(BACKGROUND_URL);
  }

  const overlay = new BrowserWindow({
    x: x,
    y: y,
    width: bounds.width,
    height: bounds.height,
    title: "HireShade overlay size acceptance",
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
  overlay.setAlwaysOnTop(true, "screen-saver");
  if (CLICK_THROUGH) {
    // The acceptance surface itself is still captured normally; only OS mouse
    // input passes through to the app behind.
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }
  overlay.loadURL(OVERLAY_URL);
  overlay.webContents.on("did-finish-load", () => {
    overlay.moveTop();
    console.log("[size-main] overlay loaded " + OVERLAY_URL);
  });
  overlay.webContents.on("render-process-gone", (_event, details) => {
    console.error("[size-main] render process gone: " + JSON.stringify(details));
    app.exit(3);
  });

  const centerDip = {
    x: overlayBounds.x + Math.round(overlayBounds.width / 2),
    y: overlayBounds.y + Math.round(overlayBounds.height / 2),
  };
  const info = {
    clickThrough: CLICK_THROUGH,
    scaleFactor: scaleFactor,
    overlayBounds: overlayBounds,
    backgroundBounds: overlayBounds,
    clickPointDip: centerDip,
    clickPointPhysical: { x: Math.round(centerDip.x * scaleFactor), y: Math.round(centerDip.y * scaleFactor) },
    workArea: workArea,
  };
  console.log("[size-main] info " + JSON.stringify(info));
}

app.whenReady().then(createWindows);
app.on("window-all-closed", () => app.quit());
