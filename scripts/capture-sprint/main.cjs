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
// V4 isolation: a harness run may claim its own small rect so concurrent UI
// automation on the same desktop cannot overlap its windows/clicks. When
// DSH_TARGET_FOLLOWS_OVERLAY=1 the click target is exactly the overlay rect
// instead of the full screen (clicks outside the probe cannot hit it).
let OVERLAY_RECT = OVERLAY_INSET;
if (process.env.DSH_OVERLAY_RECT) {
  try {
    const parsed = JSON.parse(process.env.DSH_OVERLAY_RECT);
    if (parsed && ["x", "y", "width", "height"].every(function (key) { return typeof parsed[key] === "number"; })) {
      OVERLAY_RECT = parsed;
    }
  } catch (error) { console.error("[capture-sprint-main] bad DSH_OVERLAY_RECT: " + String(error)); }
}
const TARGET_FOLLOWS_OVERLAY = process.env.DSH_TARGET_FOLLOWS_OVERLAY === "1";

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
  const targetBounds = TARGET_FOLLOWS_OVERLAY
    ? { x: display.bounds.x + OVERLAY_RECT.x, y: display.bounds.y + OVERLAY_RECT.y, width: OVERLAY_RECT.width, height: OVERLAY_RECT.height }
    : { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height };
  const target = new BrowserWindow({
    x: targetBounds.x,
    y: targetBounds.y,
    width: targetBounds.width,
    height: targetBounds.height,
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
    x: display.bounds.x + OVERLAY_RECT.x,
    y: display.bounds.y + OVERLAY_RECT.y,
    width: OVERLAY_RECT.width,
    height: OVERLAY_RECT.height,
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

  // ── V4: authoritative window state + deterministic foreground preparation ──
  // Electron has no reliable public getter for setIgnoreMouseEvents, so track the
  // applied value here and expose it (plus the native HWNDs) to the harness. The
  // harness ALSO verifies WS_EX_TRANSPARENT via Win32 before clicking.
  let ignoreMouseState = CLICK_THROUGH;
  function hwndDecimal(window) {
    const buffer = window.getNativeWindowHandle();
    return buffer.length >= 8 ? buffer.readBigUInt64LE(0).toString() : String(buffer.readUInt32LE(0));
  }
  const overlayHwnd = hwndDecimal(overlay);
  const targetHwnd = hwndDecimal(target);

  function applyIgnoreMouse(value) {
    ignoreMouseState = Boolean(value);
    // forward:true installs the forwarding behaviour; passing it when turning
    // ignore OFF can leave clicks forwarding to the window below on this host.
    // Only enable forwarding while ignoring.
    if (ignoreMouseState) {
      overlay.setIgnoreMouseEvents(true, { forward: true });
    } else {
      overlay.setIgnoreMouseEvents(false);
    }
  }
  if (CLICK_THROUGH) applyIgnoreMouse(true);

  function windowState() {
    return {
      overlayHwnd: overlayHwnd,
      overlayHwndHex: "0x" + BigInt(overlayHwnd).toString(16).toUpperCase(),
      targetHwnd: targetHwnd,
      targetHwndHex: "0x" + BigInt(targetHwnd).toString(16).toUpperCase(),
      ignoreMouseTracked: ignoreMouseState,
      electronGetter: {
        available: typeof overlay.isIgnoreMouseEvents === "function",
        value: typeof overlay.isIgnoreMouseEvents === "function" ? overlay.isIgnoreMouseEvents() : null,
      },
      overlayVisible: overlay.isVisible(),
      overlayFocused: overlay.isFocused(),
      targetVisible: target.isVisible(),
      targetFocused: target.isFocused(),
      overlayBounds: overlay.getBounds(),
      targetBounds: target.getBounds(),
      scaleFactor: screen.getPrimaryDisplay().scaleFactor,
    };
  }

  // "on": target must be foreground (click passes through the transparent
  // overlay onto it). "off": overlay must be foreground (its control receives
  // the click). The harness still polls GetForegroundWindow / WS_EX_TRANSPARENT
  // with the Win32 helper before any SendInput.
  function prepareForTest(mode) {
    if (mode === "on") {
      applyIgnoreMouse(true);
      overlay.showInactive();
      overlay.moveTop();
      target.show();
      target.moveTop();
      target.focus();
      overlay.showInactive();
      overlay.moveTop();
    } else {
      applyIgnoreMouse(false);
      overlay.show();
      overlay.moveTop();
      overlay.focus();
    }
    return windowState();
  }

  ipcMain.handle("sprint:window-state", function () { return windowState(); });
  ipcMain.handle("sprint:prepare", function (_event, mode) { return prepareForTest(mode); });
  ipcMain.on("sprint:ignore-mouse", function (_event, value) {
    applyIgnoreMouse(value);
    console.log("[capture-sprint-main] click-through " + (value ? "ON" : "OFF"));
  });

  // Electron-side foreground request: Win32 SetForegroundWindow alone loses to
  // the OS foreground lock when another app is active. Showing/focusing from the
  // owning process is the reliable path; the Win32 gate still verifies it.
  ipcMain.on("sprint:focus-overlay", function () {
    if (!overlay || overlay.isDestroyed()) return;
    overlay.show();
    overlay.moveTop();
    overlay.focus();
  });
  ipcMain.on("sprint:is-ignore-mouse", function (event) {
    event.returnValue = ignoreMouseState;
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
      overlayHwnd: overlayHwnd,
      targetHwnd: targetHwnd,
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
    x: display.bounds.x + OVERLAY_RECT.x,
    y: display.bounds.y + OVERLAY_RECT.y,
    width: OVERLAY_RECT.width,
    height: OVERLAY_RECT.height,
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
