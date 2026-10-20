/**
 * S4 capture-sprint Electron main (owned by scripts/capture-sprint; does not
 * touch the product shell in artifacts/desktop-electron).
 *
 * Modes (DSH_SPRINT_MODE):
 *   click      full-screen green click-target window + protected overlay window
 *   overlay    overlay window only (browser full-screen share probe)
 *   dpi_probe  print display scale factor + displays, then exit
 *
 * Env: DSH_CDP_PORT, DSH_OVERLAY_ORIGIN, DSH_TARGET_ORIGIN, DSH_STEALTH=0|1,
 *      DSH_CLICK_THROUGH=0|1, DSH_USER_DATA_DIR.
 */
"use strict";

const { app, BrowserWindow, screen, ipcMain } = require("electron");
const path = require("node:path");

const MODE = process.env.DSH_SPRINT_MODE || "overlay";
const CDP_PORT = process.env.DSH_CDP_PORT || "9550";
const OVERLAY_ORIGIN = process.env.DSH_OVERLAY_ORIGIN;
const TARGET_ORIGIN = process.env.DSH_TARGET_ORIGIN;
const OVERLAY_URL = OVERLAY_ORIGIN ? OVERLAY_ORIGIN + "/overlay" : null;
const TARGET_URL = TARGET_ORIGIN ? TARGET_ORIGIN + "/target" : null;
const STEALTH = process.env.DSH_STEALTH === "1";
const CLICK_THROUGH = process.env.DSH_CLICK_THROUGH === "1";
const USER_DATA_DIR = process.env.DSH_USER_DATA_DIR;

app.commandLine.appendSwitch("remote-debugging-port", CDP_PORT);
app.commandLine.appendSwitch("remote-allow-origins", "*");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (USER_DATA_DIR) app.setPath("userData", USER_DATA_DIR);

const OVERLAY_INSET = { x: 200, y: 110, width: 760, height: 460 };

function printInfo(info) {
  console.log("[capture-sprint-main] info " + JSON.stringify(info));
}

function dpiProbe() {
  const display = screen.getPrimaryDisplay();
  printInfo({
    mode: "dpi_probe",
    scaleFactor: display.scaleFactor,
    bounds: display.bounds,
    workArea: display.workArea,
    displays: screen.getAllDisplays().map(function (entry) {
      return { id: entry.id, bounds: entry.bounds, workArea: entry.workArea, scaleFactor: entry.scaleFactor, primary: entry.id === screen.getPrimaryDisplay().id };
    }),
  });
  app.quit();
}

function createClickWindows() {
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor;
  const target = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    title: "S4 click target (behind overlay)",
    frame: false,
    backgroundColor: "#053b1f",
    alwaysOnTop: true,
    show: true,
    skipTaskbar: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  target.setAlwaysOnTop(true, "screen-saver");
  target.loadURL(TARGET_URL);
  const overlay = new BrowserWindow({
    x: display.bounds.x + OVERLAY_INSET.x,
    y: display.bounds.y + OVERLAY_INSET.y,
    width: OVERLAY_INSET.width,
    height: OVERLAY_INSET.height,
    title: "S4 protected overlay (on top)",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  if (STEALTH) overlay.setContentProtection(true);
  if (CLICK_THROUGH) overlay.setIgnoreMouseEvents(true, { forward: true });
  ipcMain.on("sprint:ignore-mouse", function (_event, value) {
    overlay.setIgnoreMouseEvents(Boolean(value), { forward: true });
    console.log("[capture-sprint-main] click-through " + (value ? "ON" : "OFF"));
  });
  ipcMain.on("sprint:is-ignore-mouse", function (event) {
    event.returnValue = overlay.isIgnoreMouseEvents ? overlay.isIgnoreMouseEvents() : null;
  });
  overlay.loadURL(OVERLAY_URL);

  let loaded = 0;
  function onLoaded(which) {
    loaded += 1;
    if (loaded < 2) return;
    // Foreground our own app and stack target < overlay deterministically.
    target.moveTop();
    target.focus();
    overlay.moveTop();
    overlay.showInactive();
    const overlayBounds = overlay.getBounds();
    const transparentPointDip = { x: overlayBounds.x + 30, y: overlayBounds.y + 30 };
    const displayCenterRelative = {
      xRel: (overlayBounds.x + overlayBounds.width / 2 - display.bounds.x) / display.bounds.width,
      yRel: (overlayBounds.y + overlayBounds.height / 2 - display.bounds.y) / display.bounds.height,
    };
    printInfo({
      mode: MODE,
      stealth: STEALTH,
      clickThrough: CLICK_THROUGH,
      scaleFactor: scaleFactor,
      displayBounds: display.bounds,
      targetBounds: target.getBounds(),
      overlayBounds: overlayBounds,
      transparentPointDip: transparentPointDip,
      transparentPointPhysical: { x: Math.round(transparentPointDip.x * scaleFactor), y: Math.round(transparentPointDip.y * scaleFactor) },
      overlayCenterRelativeToDisplay: displayCenterRelative,
      foregroundTitleHint: which,
    });
  }
  target.webContents.on("did-finish-load", function () { onLoaded("target"); });
  overlay.webContents.on("did-finish-load", function () { onLoaded("overlay"); });
  overlay.webContents.on("render-process-gone", function (_event, details) {
    console.error("[capture-sprint-main] overlay render gone " + JSON.stringify(details));
  });
  return { target: target, overlay: overlay };
}

function createOverlayOnly() {
  const display = screen.getPrimaryDisplay();
  const overlay = new BrowserWindow({
    x: display.bounds.x + OVERLAY_INSET.x,
    y: display.bounds.y + OVERLAY_INSET.y,
    width: OVERLAY_INSET.width,
    height: OVERLAY_INSET.height,
    title: "S4 protected overlay (capture probe)",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  if (STEALTH) overlay.setContentProtection(true);
  overlay.loadURL(OVERLAY_URL);
  overlay.webContents.on("did-finish-load", function () {
    overlay.moveTop();
    const bounds = overlay.getBounds();
    printInfo({
      mode: MODE,
      stealth: STEALTH,
      scaleFactor: display.scaleFactor,
      displayBounds: display.bounds,
      overlayBounds: bounds,
      overlayCenterRelativeToDisplay: {
        xRel: (bounds.x + bounds.width / 2 - display.bounds.x) / display.bounds.width,
        yRel: (bounds.y + bounds.height / 2 - display.bounds.y) / display.bounds.height,
      },
    });
  });
  return { overlay: overlay };
}

app.whenReady().then(function () {
  if (MODE === "dpi_probe") {
    dpiProbe();
    return;
  }
  if (!OVERLAY_URL) {
    console.error("[capture-sprint-main] DSH_OVERLAY_ORIGIN is required for mode " + MODE);
    app.exit(2);
    return;
  }
  if (MODE === "click") {
    if (!TARGET_URL) {
      console.error("[capture-sprint-main] DSH_TARGET_ORIGIN is required for click mode");
      app.exit(2);
      return;
    }
    createClickWindows();
    return;
  }
  createOverlayOnly();
});

app.on("window-all-closed", function () { app.quit(); });
