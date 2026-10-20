"use strict";

/**
 * HireShade Electron desktop shell.
 *
 * Mirrors the Tauri window model (launcher + floating overlay) and wires the
 * stealth/overlay-control stack from docs/TARGET_VERIFIED.md:
 *   T-02  overlay flag matrix (frameless, transparent, panel, hidden in Mission
 *         Control, skipTaskbar) — applied to the floating overlay.
 *   T-03  Windows always-on-top watchdog: setAlwaysOnTop(true, "screen-saver", 1)
 *         re-asserted every 1000 ms + background throttling off + the
 *         CalculateNativeWinOcclusion feature disabled.
 *   T-04  setContentProtection() as the only capture-exclusion primitive,
 *         driven by a persisted isPrivate flag and re-applied on every show.
 *   T-05  skipTaskbar always; macOS dock hidden once (LSUIElement belongs in the
 *         packaged Info.plist; see README).
 *   T-06  dynamic click-through lives in preload.js ([data-transparent] hit-test,
 *         40 ms throttle, setIgnoreMouseEvents(..., { forward: true })).
 *   T-07  two global-shortcut sets (app + live-call), registered/unregistered
 *         with overlay visibility, plus HireShade's panic/cycle safety keys.
 *
 * Overlay controls (click-through enable/disable, opacity, position presets,
 * private mode) are exposed over contextIsolation-safe IPC and persisted to
 * <userData>/overlay-settings.json so positions survive moves and restarts.
 */

const { app, BrowserWindow, session, globalShortcut, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const hotkeys = require("./lib/hotkeys.js");
const geometry = require("./lib/overlayGeometry.js");
// O2 capture protection/compatibility logic. Single source of truth shared with
// the vitest suite and the preload self-check UI (plain CJS, no build step).
const captureLogic = require("../craft-vita/src/overlay/capture/captureLogic.cjs");

// U1: in-process affinity control. Electron's setContentProtection(bool) only
// reaches WDA_NONE (0x00) and WDA_EXCLUDEFROMCAPTURE (0x11); WDA_MONITOR (0x01)
// must be set from the process that owns the HWND. koffi is an N-API FFI with
// prebuilt binaries (no node-gyp) and lets us call user32 directly in main.
// When unavailable we fall back to setContentProtection - never both paths at once.
let nativeAffinity = null;
try {
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  nativeAffinity = {
    set: user32.func("bool __stdcall SetWindowDisplayAffinity(uint64 hwnd, uint32 affinity)"),
    get: user32.func("bool __stdcall GetWindowDisplayAffinity(uint64 hwnd, void* affinity)"),
  };
  console.log("[capture] in-process affinity via koffi available");
} catch (error) {
  console.warn("[capture] koffi/user32 unavailable; using setContentProtection only: " + error);
}

/** Requested affinity for the current state: private off => 0x00. */
function requestedAffinityMode() {
  if (!settings.isPrivate) return 0x00;
  // Explicit env override is for the capture rig; the product toggle lives in
  // captureState.affinityMode ("exclude" default, "monitor" = black-box mode).
  const override = process.env.HIRESHADE_AFFINITY_MODE;
  if (override) {
    const raw = String(override).trim().toLowerCase();
    const parsed = raw.startsWith("0x") ? parseInt(raw, 16) : Number(raw);
    if (parsed === 0) return 0x00;
    if (parsed === 1) return 0x01;
    return 0x11;
  }
  return captureState.affinityMode === "monitor" ? 0x01 : 0x11;
}

function hwndToBigInt(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

function applyNativeAffinity(win) {
  const mode = requestedAffinityMode();
  const hwnd = hwndToBigInt(win);
  let applied = false;
  let readback = null;
  try {
    applied = nativeAffinity.set(hwnd, mode);
    const out = Buffer.alloc(4);
    if (nativeAffinity.get(hwnd, out)) readback = out.readUInt32LE(0);
  } catch (error) {
    console.warn("[capture] native affinity call failed: " + error);
  }
  console.log("[capture] native affinity mode=0x" + mode.toString(16) + " hwnd=" + hwnd.toString() + " applied=" + applied + " readback=" + (readback === null ? "null" : "0x" + readback.toString(16)));
  if (!applied) {
    console.warn(
      "[capture] SetWindowDisplayAffinity(0x" + mode.toString(16) + ") failed for hwnd=" + hwnd.toString() + "; falling back to setContentProtection",
    );
    try {
      win.setContentProtection(settings.isPrivate);
    } catch (error) {
      console.warn("[capture] setContentProtection fallback failed: " + error);
    }
    return { mode: mode, applied: false, readback: readback };
  }
  return { mode: mode, applied: true, readback: readback };
}

const DESKTOP_IPC = hotkeys.DESKTOP_IPC;
const HOTKEY_EVENT_CHANNEL = hotkeys.HOTKEY_EVENT_CHANNEL;
const POINTER_PASS_THROUGH_CHANNEL = hotkeys.POINTER_PASS_THROUGH_CHANNEL;
const DEFAULT_MODEL_CYCLE = hotkeys.DEFAULT_MODEL_CYCLE;
const formatAccelerator = hotkeys.formatAccelerator;
const normalizePlatform = hotkeys.normalizePlatform;
const resolveHotkeys = hotkeys.resolveHotkeys;
const canonicalizeAccelerator = hotkeys.canonicalizeAccelerator;
const nextModel = hotkeys.nextModel;

const SELECTABLE_POSITION_PRESETS = geometry.SELECTABLE_POSITION_PRESETS;
const WINDOW_IDS = geometry.WINDOW_IDS;
const applyOpacity = geometry.applyOpacity;
const boundsForPreset = geometry.boundsForPreset;
const defaultPresetFor = geometry.defaultPresetFor;
const isSelectablePositionPreset = geometry.isSelectablePositionPreset;
const nudgeBounds = geometry.nudgeBounds;
const parseSettingsJson = geometry.parseSettingsJson;
const recordBounds = geometry.recordBounds;
const recordPresetBounds = geometry.recordPresetBounds;
const rectEquals = geometry.rectEquals;
const serializeSettings = geometry.serializeSettings;
const setClickThrough = geometry.setClickThrough;
const setPositionPreset = geometry.setPositionPreset;
const setPrivateMode = geometry.setPrivateMode;

const CAPTURE_CHANNELS = captureLogic.CAPTURE_CHANNELS;

// S3 pre-flight channels (mirrors src/overlay/preflight/routing.ts PREFLIGHT_IPC).
const PREFLIGHT_CHANNELS = {
  getContext: "desktop:preflight:get-context",
  moveToDisplay: "desktop:preflight:move-to-display",
  showSelfCheck: "desktop:preflight:show-self-check",
  rendered: "desktop:preflight:rendered",
};
const CAPTURE_PROFILES = captureLogic.CAPTURE_PROFILES;
const computeCaptureLayout = captureLogic.computeCaptureLayout;
const computeCompatPlan = captureLogic.computeCompatPlan;
const suggestCompatibilityMode = captureLogic.suggestCompatibilityMode;
const parseCaptureState = captureLogic.parseCaptureState;
const setCaptureCompatMode = captureLogic.setCompatMode;
const setCaptureProfileState = captureLogic.setCaptureProfile;
const recordCaptureSelfCheck = captureLogic.recordSelfCheck;
const setKnownBadCapturePathState = captureLogic.setKnownBadCapturePath;
const serializeCaptureState = captureLogic.serializeCaptureState;
const isCaptureProfile = captureLogic.isCaptureProfile;
const normalizeCaptureProfile = captureLogic.normalizeCaptureProfile;
const describeReassert = captureLogic.describeReassert;
const shouldReassertCapture = captureLogic.shouldReassert;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// UI artifacts produced by artifacts/craft-vita (vite build with
// ELECTRON_BUILD=1 --base ./). Three HTML entries, mirroring the Tauri windows.
const UI_DIST = path.resolve(__dirname, "..", "craft-vita", "dist", "public");

const PLATFORM = normalizePlatform(process.platform);
const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";

// Per product decision: stealth (capture exclusion) is persisted in settings and
// default-on. Opt-out for testing/debugging: ELECTRON_STEALTH=0.
const STEALTH_ENABLED = process.env.ELECTRON_STEALTH !== "0";
const DEBUG_IPC = process.env.HIRESHADE_DEBUG_IPC === "1";
const HIRESHADE_USER_DATA = process.env.HIRESHADE_USER_DATA;
const NUDGE_STEP_PX = 24;
const LIVE_WINDOW_ID = "floating";
const SETTINGS_FILE = "overlay-settings.json";
const CAPTURE_STATE_FILE = "capture-state.json";
const BOUNDS_SAVE_DEBOUNCE_MS = 250;
const ALWAYS_ON_TOP_INTERVAL_MS = 1000;
// Optional diagnostic hint supplied by an evidence run, e.g.
// HIRESHADE_CAPTURE_HINT="ffmpeg ddagrab (DXGI Desktop Duplication)". This is a
// hint, not detection: the app never claims it can identify the capture API.
const CAPTURE_HINT_ENV = process.env.HIRESHADE_CAPTURE_HINT || null;

if (HIRESHADE_USER_DATA) {
  // Isolated profile for automated A/B tests (never used by the app itself).
  const isolatedUserData = path.resolve(HIRESHADE_USER_DATA);
  try {
    fs.mkdirSync(isolatedUserData, { recursive: true });
  } catch (error) {
    console.error("[settings] could not create isolated userData: " + error);
  }
  app.setPath("userData", isolatedUserData);
}

// Evidence runs need the main-process console even when Electron is started
// without an attached console (Windows GUI subsystem drops stdout).
const HIRESHADE_LOG_FILE = process.env.HIRESHADE_LOG_FILE;
if (HIRESHADE_LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(HIRESHADE_LOG_FILE)), { recursive: true });
    const logPath = path.resolve(HIRESHADE_LOG_FILE);
    const tee = function (level, original) {
      return function () {
        const parts = Array.prototype.map.call(arguments, function (value) {
          return typeof value === "string" ? value : JSON.stringify(value);
        });
        try {
          fs.appendFileSync(logPath, new Date().toISOString() + " [" + level + "] " + parts.join(" ") + "\n");
        } catch {
          // Logging must never take the app down.
        }
        return original.apply(console, arguments);
      };
    };
    console.log = tee("info", console.log.bind(console));
    console.warn = tee("warn", console.warn.bind(console));
    console.error = tee("error", console.error.bind(console));
  } catch (error) {
    console.error("[logging] failed to open " + HIRESHADE_LOG_FILE + ": " + error);
  }
}

if (IS_WINDOWS) {
  // T-03: Windows pauses rendering for occluded windows. An always-on-top
  // overlay can still be flagged occluded by the OS; disabling the feature
  // keeps the webview painting during screen shares.
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

if (process.env.HIRESHADE_FORCE_SCALE) {
  // Evidence only: simulate a DPI/work-area change without a second monitor by
  // forcing Chromium's device scale factor. The app itself never sets this.
  app.commandLine.appendSwitch("force-device-scale-factor", String(process.env.HIRESHADE_FORCE_SCALE));
}

if (process.env.HIRESHADE_DEBUG_CDP) {
  // Automated verification only (docs/evidence/stealth-wiring). The app itself
  // never sets this; production builds stay closed to remote debugging.
  app.commandLine.appendSwitch("remote-debugging-port", String(process.env.HIRESHADE_DEBUG_CDP));
}

function entryUrl(name) {
  if (VITE_DEV_SERVER_URL) {
    // Dev server serves the raw HTML files from craft-vita's project root.
    return VITE_DEV_SERVER_URL.replace(/\/+$/, "") + "/" + name + ".html";
  }
  return "file://" + path.join(UI_DIST, name + ".html");
}

// ─── Window specs ───────────────────────────────────────────────────────────

const WINDOW_SPECS = [
  {
    id: "floating",
    // T-02 flag matrix. resizable/movable stay true because the HireShade
    // overlay is user-positioned (G-010) and position presets/moves persist.
    opts: {
      title: "HireShade Floating Screen",
      width: 700,
      height: 360,
      minWidth: 360,
      minHeight: 200,
      maxWidth: 1600,
      maxHeight: 1200,
      frame: false,
      transparent: true,
      roundedCorners: false,
      hasShadow: false,
      resizable: true,
      maximizable: true,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hiddenInMissionControl: true,
      acceptFirstMouse: true,
      show: false,
      movable: true,
      ...(IS_MAC ? { type: "panel" } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        experimentalFeatures: true,
        backgroundThrottling: false,
        preload: path.join(__dirname, "preload.js"),
      },
    },
    onTopLevel: "screen-saver",
  },
  {
    id: "launcher",
    opts: {
      title: "HireShade",
      width: 480,
      height: 680,
      minWidth: 320,
      minHeight: 180,
      frame: false,
      transparent: true,
      roundedCorners: false,
      hasShadow: false,
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hiddenInMissionControl: true,
      acceptFirstMouse: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        experimentalFeatures: true,
        backgroundThrottling: false,
        preload: path.join(__dirname, "preload.js"),
      },
    },
    onTopLevel: "floating",
  },
];

// ─── State ──────────────────────────────────────────────────────────────────

const windows = new Map();
const windowIdByWebContents = new Map();
const boundsSaveTimers = new Map();

let settings = geometry.DEFAULT_OVERLAY_SETTINGS;
let settingsPath = "";
let settingsSaveTimer = null;
// ── O2 capture state ────────────────────────────────────────────────────────
let captureState = captureLogic.DEFAULT_CAPTURE_STATE;
let captureStatePath = "";
let captureStateSaveTimer = null;
let captureReassertCount = 0;
const captureReassertLog = [];
let lastCaptureSuggestion = null;
let alwaysOnTopTimer = null;
let resolvedHotkeys = [];
let hotkeyIssues = [];
const registeredAccelerators = new Set();
let activeModel = DEFAULT_MODEL_CYCLE[0];

// ─── Settings persistence ───────────────────────────────────────────────────

function loadSettings() {
  settingsPath = path.join(app.getPath("userData"), SETTINGS_FILE);
  let text = null;
  try {
    text = fs.readFileSync(settingsPath, "utf8");
  } catch {
    text = null;
  }
  settings = parseSettingsJson(text);
  const resolved = resolveHotkeys(settings.hotkeys, PLATFORM);
  resolvedHotkeys = resolved.bindings;
  hotkeyIssues = resolved.issues;
  console.log("[settings] loaded " + settingsPath + " (opacity=" + settings.opacity + ", preset=" + settings.positionPreset + ", private=" + settings.isPrivate + ")");
  if (hotkeyIssues.length > 0) {
    console.warn("[settings] hotkey issues: " + JSON.stringify(hotkeyIssues));
  }
}

function saveSettingsNow() {
  if (!settingsPath) return;
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tmpPath = settingsPath + ".tmp";
    fs.writeFileSync(tmpPath, serializeSettings(settings), "utf8");
    fs.renameSync(tmpPath, settingsPath);
  } catch (error) {
    console.error("[settings] save failed: " + (error && error.message ? error.message : error));
  }
}

function scheduleSettingsSave() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(function () {
    settingsSaveTimer = null;
    saveSettingsNow();
  }, BOUNDS_SAVE_DEBOUNCE_MS);
}

// ─── O2 capture state persistence ───────────────────────────────────────────

function loadCaptureState() {
  captureStatePath = path.join(app.getPath("userData"), CAPTURE_STATE_FILE);
  let text = null;
  try {
    text = fs.readFileSync(captureStatePath, "utf8");
  } catch {
    text = null;
  }
  try {
    captureState = parseCaptureState(text ? JSON.parse(text) : null);
  } catch (error) {
    console.warn("[capture] ignoring unreadable capture-state.json: " + error);
    captureState = parseCaptureState(null);
  }
  if (CAPTURE_HINT_ENV) {
    captureState = setKnownBadCapturePathState(captureState, CAPTURE_HINT_ENV);
  }
  console.log(
    "[capture] loaded " + captureStatePath + " (compat=" + captureState.compatMode + ", profile=" + captureState.lastProfile + ", reportedVisible=" + captureState.reportedVisible + ")",
  );
}

function saveCaptureStateNow() {
  if (!captureStatePath) return;
  if (captureStateSaveTimer) {
    clearTimeout(captureStateSaveTimer);
    captureStateSaveTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(captureStatePath), { recursive: true });
    const tmpPath = captureStatePath + ".tmp";
    fs.writeFileSync(tmpPath, serializeCaptureState(captureState), "utf8");
    fs.renameSync(tmpPath, captureStatePath);
  } catch (error) {
    console.error("[capture] save failed: " + (error && error.message ? error.message : error));
  }
}

function scheduleCaptureStateSave() {
  if (captureStateSaveTimer) clearTimeout(captureStateSaveTimer);
  captureStateSaveTimer = setTimeout(function () {
    captureStateSaveTimer = null;
    saveCaptureStateNow();
  }, BOUNDS_SAVE_DEBOUNCE_MS);
}

// ─── Stealth (T-04) ─────────────────────────────────────────────────────────

function applyStealth(win) {
  if (!STEALTH_ENABLED || !win || win.isDestroyed()) return;
  // Windows: one code path only. Prefer the in-process native call (supports
  // 0x00/0x01/0x11). macOS/Linux or missing koffi: Electron's bool mapping.
  if (process.platform === "win32" && nativeAffinity) {
    const result = applyNativeAffinity(win);
    if (result.applied) {
      win.__hireshadeAffinity = { mode: result.mode, readback: result.readback, at: Date.now() };
      return;
    }
  }
  if (typeof win.setContentProtection !== "function") return;
  // Fallback primitive: Electron maps this to WDA_EXCLUDEFROMCAPTURE on Windows
  // and NSWindowSharingNone on macOS. Re-applied on every show/restore/focus.
  win.setContentProtection(settings.isPrivate);
}

function overlayAreaRatio(win) {
  if (!win || win.isDestroyed()) return 0;
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = Math.max(1, display.workArea.width * display.workArea.height);
    return Math.min(1, Math.max(0, (bounds.width * bounds.height) / area));
  } catch {
    return 0;
  }
}

function captureStateSnapshot() {
  const win = getWindow(LIVE_WINDOW_ID);
  return {
    ...captureState,
    transparent: !captureState.compatMode,
    opaqueSurfaceOnRestart: captureState.compatMode,
    runtimeSurfaceNote:
      "Electron's transparent flag is creation-only. Runtime compatibility mode applies an opaque renderer scrim + solid background colour; a true transparent:false surface is created on the next launch.",
    overlayAreaRatio: Number(overlayAreaRatio(win).toFixed(4)),
    stealthEnabled: STEALTH_ENABLED,
    reassertCount: captureReassertCount,
    lastReassert: captureReassertLog.length > 0 ? captureReassertLog[captureReassertLog.length - 1] : null,
    reassertLog: captureReassertLog.slice(-25),
    lastSuggestion: lastCaptureSuggestion || captureState.lastSuggestion,
    profiles: CAPTURE_PROFILES,
    affinity: {
      value: null,
      note: "OS affinity is verified externally by scripts/capture-matrix/affinity.ps1 (GetWindowDisplayAffinity == 0x11).",
    },
    windows: windowStateSnapshot(),
  };
}

function broadcastCaptureState() {
  const payload = captureStateSnapshot();
  for (const win of windows.values()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(CAPTURE_CHANNELS.stateChanged, payload);
    } catch (error) {
      console.warn("[capture] state broadcast failed: " + error);
    }
  }
  return payload;
}

function sendCaptureSuggestion(suggestion) {
  lastCaptureSuggestion = suggestion;
  for (const win of windows.values()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(CAPTURE_CHANNELS.suggestion, suggestion);
    } catch {
      // Suggestion delivery is best-effort.
    }
  }
}

/**
 * Re-assert capture exclusion after every transition that can silently drop the
 * display affinity: resize, move, preset/profile change, display metrics
 * change, re-show/restore/focus, window recreation, private/compat toggles.
 *
 * Electron exposes no getter for the content-protection flag, so this logs the
 * request with a reason/counter; the actual OS value (WDA_EXCLUDEFROMCAPTURE ==
 * 0x11) is asserted by scripts/capture-matrix/affinity.ps1 after each step.
 */
function reassertCaptureProtection(reason, win) {
  if (!shouldReassertCapture(reason)) {
    console.warn("[capture] unknown re-assert reason ignored: " + reason);
    return null;
  }
  const targets = win ? [win] : Array.from(windows.values());
  let applied = 0;
  for (const target of targets) {
    if (!target || target.isDestroyed()) continue;
    applyStealth(target);
    applied += 1;
  }
  captureReassertCount += 1;
  const entry = {
    at: Date.now(),
    reason: reason,
    description: describeReassert(reason),
    count: captureReassertCount,
    appliedWindows: applied,
    windows: Array.from(windows.keys()),
  };
  captureReassertLog.push(entry);
  if (captureReassertLog.length > 60) captureReassertLog.shift();
  console.log(
    "[capture] reassert #" + captureReassertCount + " reason=" + reason + " (" + entry.description + ") applied=" + applied,
  );
  broadcastCaptureState();
  return entry;
}

// ─── Platform window behavior (T-03) ────────────────────────────────────────

function applyPlatformWindowBehavior(win, spec) {
  win.setMenuBarVisibility(false);
  win.setSkipTaskbar(true);
  win.setAlwaysOnTop(true, spec.onTopLevel || "floating", 1);
  win.webContents.setBackgroundThrottling(false);
  if (IS_MAC) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (IS_WINDOWS) {
    // Immediate apply; the 1000 ms watchdog below keeps it in the topmost band.
    win.setAlwaysOnTop(true, "screen-saver", 1);
  }
}

function startAlwaysOnTopWatchdog() {
  if (alwaysOnTopTimer || !IS_WINDOWS) return;
  alwaysOnTopTimer = setInterval(function () {
    for (const win of windows.values()) {
      if (!win || win.isDestroyed() || !win.isVisible()) continue;
      win.setAlwaysOnTop(true, "screen-saver", 1);
      win.webContents.setBackgroundThrottling(false);
    }
  }, ALWAYS_ON_TOP_INTERVAL_MS);
}

function stopAlwaysOnTopWatchdog() {
  if (alwaysOnTopTimer) {
    clearInterval(alwaysOnTopTimer);
    alwaysOnTopTimer = null;
  }
}

// ─── Geometry application ───────────────────────────────────────────────────

function presetForWindow(windowId) {
  if (windowId !== "floating") return defaultPresetFor(windowId);
  return settings.positionPreset === "custom" ? "top-center" : settings.positionPreset;
}

function applyWindowGeometry(win, windowId) {
  const stored = settings.bounds[windowId];
  if (stored) {
    try {
      win.setBounds(stored);
      return;
    } catch (error) {
      console.warn("[geometry] failed to restore bounds for " + windowId + ": " + error);
    }
  }
  const current = win.getBounds();
  try {
    const display = screen.getDisplayMatching(current);
    const preset = presetForWindow(windowId);
    const next = boundsForPreset(display.workArea, current, preset);
    win.setBounds(next);
  } catch (error) {
    console.warn("[geometry] failed to apply default preset for " + windowId + ": " + error);
  }
}

function applyWindowState(win, windowId) {
  applyWindowGeometry(win, windowId);
  if (windowId === LIVE_WINDOW_ID) {
    // Window-level opacity is an overlay control; the launcher stays opaque.
    try {
      win.setOpacity(settings.opacity);
    } catch (error) {
      console.warn("[overlay] setOpacity failed: " + error);
    }
    // T-02/T-06: start click-through; preload flips this on pointer movement.
    try {
      win.setIgnoreMouseEvents(Boolean(settings.clickThrough), { forward: true });
    } catch (error) {
      console.warn("[overlay] setIgnoreMouseEvents failed: " + error);
    }
  }
  applyStealth(win);
}

function persistWindowBounds(win, windowId) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  let presetRect = null;
  try {
    const display = screen.getDisplayMatching(bounds);
    const preset = presetForWindow(windowId);
    presetRect = boundsForPreset(display.workArea, bounds, preset);
  } catch {
    presetRect = null;
  }
  const matchesPreset = presetRect !== null && rectEquals(bounds, presetRect);
  settings = matchesPreset
    ? recordPresetBounds(settings, windowId, bounds)
    : recordBounds(settings, windowId, bounds, true);
  scheduleSettingsSave();
}

function attachBoundsPersistence(win, windowId) {
  const scheduleWrite = function () {
    const existing = boundsSaveTimers.get(windowId);
    if (existing) clearTimeout(existing);
    boundsSaveTimers.set(
      windowId,
      setTimeout(function () {
        boundsSaveTimers.delete(windowId);
        persistWindowBounds(win, windowId);
      }, BOUNDS_SAVE_DEBOUNCE_MS),
    );
  };
  // O2: every user move/resize re-asserts capture exclusion immediately (not
  // debounced like persistence), then persists bounds.
  win.on("moved", function () {
    scheduleWrite();
    reassertCaptureProtection("move", win);
  });
  win.on("resized", function () {
    scheduleWrite();
    reassertCaptureProtection("resize", win);
  });
}

// ─── Public state snapshots ─────────────────────────────────────────────────

function resolvedHotkeyPayload() {
  return resolvedHotkeys.map(function (binding) {
    return {
      action: binding.action,
      set: binding.set,
      accelerator: binding.accelerator,
      display: formatAccelerator(binding.accelerator, PLATFORM),
      label: binding.label,
      description: binding.description,
      registered: registeredAccelerators.has(canonicalizeAccelerator(binding.accelerator) || binding.accelerator),
    };
  });
}

function publicSettings() {
  return {
    version: settings.version,
    opacity: settings.opacity,
    clickThrough: settings.clickThrough,
    isPrivate: settings.isPrivate && STEALTH_ENABLED,
    positionPreset: settings.positionPreset,
    bounds: settings.bounds,
    hotkeys: settings.hotkeys,
    activeModel: activeModel,
    platform: PLATFORM,
    settingsPath: settingsPath,
    presets: SELECTABLE_POSITION_PRESETS,
    resolvedHotkeys: resolvedHotkeyPayload(),
    hotkeyIssues: hotkeyIssues,
  };
}

function windowStateSnapshot() {
  const state = {};
  for (const windowId of WINDOW_IDS) {
    const win = windows.get(windowId);
    if (!win || win.isDestroyed()) {
      state[windowId] = { exists: false };
      continue;
    }
    state[windowId] = {
      exists: true,
      visible: win.isVisible(),
      focused: win.isFocused(),
      alwaysOnTop: win.isAlwaysOnTop(),
      opacity: win.getOpacity(),
      bounds: win.getBounds(),
    };
  }
  return state;
}

function stateSnapshot() {
  return {
    windows: windowStateSnapshot(),
    settings: publicSettings(),
    capture: captureStateSnapshot(),
    activeModel: activeModel,
    stealthEnabled: STEALTH_ENABLED,
    platform: PLATFORM,
    hotkeys: resolvedHotkeyPayload(),
  };
}

// ─── Hotkey registration (T-07) ─────────────────────────────────────────────

function bindingsForSet(set) {
  return resolvedHotkeys.filter(function (binding) {
    return binding.set === set;
  });
}

function registerHotkeySet(set) {
  for (const binding of bindingsForSet(set)) {
    const canonical = canonicalizeAccelerator(binding.accelerator) || binding.accelerator;
    if (registeredAccelerators.has(canonical)) continue;
    let registered = false;
    try {
      registered = globalShortcut.register(binding.accelerator, function () {
        handleHotkeyAction(binding.action);
      });
    } catch (error) {
      console.error("[hotkeys] register threw for " + binding.action + " (" + binding.accelerator + "): " + error);
    }
    if (registered) {
      registeredAccelerators.add(canonical);
      console.log("[hotkeys] registered set=" + set + " action=" + binding.action + " accelerator=" + binding.accelerator);
    } else {
      console.warn("[hotkeys] registration FAILED set=" + set + " action=" + binding.action + " accelerator=" + binding.accelerator + " (already owned by the OS or another app)");
    }
  }
}

function unregisterHotkeySet(set) {
  for (const binding of bindingsForSet(set)) {
    const canonical = canonicalizeAccelerator(binding.accelerator) || binding.accelerator;
    if (!registeredAccelerators.has(canonical)) continue;
    try {
      globalShortcut.unregister(binding.accelerator);
    } catch (error) {
      console.warn("[hotkeys] unregister failed for " + binding.accelerator + ": " + error);
    }
    registeredAccelerators.delete(canonical);
    console.log("[hotkeys] unregistered set=" + set + " action=" + binding.action);
  }
}

function registerAppHotkeys() {
  registerHotkeySet("app");
}

function registerLiveCallHotkeys() {
  registerHotkeySet("live-call");
}

function unregisterLiveCallHotkeys() {
  unregisterHotkeySet("live-call");
}

function broadcastHotkey(payload) {
  for (const win of windows.values()) {
    if (!win || win.isDestroyed()) continue;
    win.webContents.send(HOTKEY_EVENT_CHANNEL, payload);
  }
}

// ─── Hotkey actions ─────────────────────────────────────────────────────────

function getWindow(windowId) {
  const win = windows.get(windowId);
  return win && !win.isDestroyed() ? win : null;
}

function showOverlay() {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) return false;
  win.show();
  win.setAlwaysOnTop(true, "screen-saver", 1);
  applyStealth(win);
  registerLiveCallHotkeys();
  return true;
}

function hideOverlay() {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) return false;
  win.hide();
  unregisterLiveCallHotkeys();
  return true;
}

function toggleOverlay() {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) return;
  if (win.isVisible()) hideOverlay();
  else showOverlay();
}

function panicHide() {
  for (const win of windows.values()) {
    if (win && !win.isDestroyed()) win.hide();
  }
  unregisterLiveCallHotkeys();
}

function cycleModel() {
  const next = nextModel(DEFAULT_MODEL_CYCLE, activeModel);
  if (!next) return;
  activeModel = next;
  console.log("[hotkeys] model -> " + activeModel);
  broadcastHotkey({ action: "cycle-model", model: activeModel });
}

function nudgeOverlay(dx, dy) {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) return;
  let next;
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    next = nudgeBounds(bounds, { x: dx, y: dy }, display.workArea);
    win.setBounds(next);
  } catch (error) {
    console.warn("[hotkeys] nudge failed: " + error);
    return;
  }
  settings = recordBounds(settings, LIVE_WINDOW_ID, next, true);
  scheduleSettingsSave();
}

function handleHotkeyAction(action) {
  console.log("[hotkeys] fired " + action);
  switch (action) {
    case "toggle-overlay":
      toggleOverlay();
      break;
    case "panic-hide":
      panicHide();
      break;
    case "cycle-model":
      cycleModel();
      break;
    case "overlay-nudge-up":
      nudgeOverlay(0, -NUDGE_STEP_PX);
      break;
    case "overlay-nudge-down":
      nudgeOverlay(0, NUDGE_STEP_PX);
      break;
    case "overlay-nudge-left":
      nudgeOverlay(-NUDGE_STEP_PX, 0);
      break;
    case "overlay-nudge-right":
      nudgeOverlay(NUDGE_STEP_PX, 0);
      break;
    case "live-hide-overlay":
      hideOverlay();
      break;
    default:
      // Live-call answer/message shortcuts are consumed by the session UI.
      broadcastHotkey({ action: action });
      break;
  }
}

// ─── IPC (contextIsolation-safe) ────────────────────────────────────────────

function senderWindowId(event) {
  return windowIdByWebContents.get(event.sender.id) || null;
}

function requireKnownSender(event) {
  const windowId = senderWindowId(event);
  if (!windowId) throw new Error("IPC rejected: unknown sender");
  return windowId;
}

// ─── O2 capture actions ────────────────────────────────────────────────────

function maybeSuggestCaptureMode(reportedVisible) {
  const win = getWindow(LIVE_WINDOW_ID);
  const suggestion = suggestCompatibilityMode({
    reportedVisible: Boolean(reportedVisible),
    overlayAreaRatio: overlayAreaRatio(win),
    transparent: !captureState.compatMode,
    knownBadCapturePath: captureState.knownBadCapturePath,
  });
  if (suggestion.suggest) {
    lastCaptureSuggestion = suggestion;
    captureState = Object.assign({}, captureState, { lastSuggestion: suggestion });
    scheduleCaptureStateSave();
    sendCaptureSuggestion(suggestion);
  }
  return suggestion;
}

function applyCaptureCompatMode(enabled) {
  const plan = computeCompatPlan(Boolean(enabled));
  const changed = captureState.compatMode !== plan.enabled;
  captureState = setCaptureCompatMode(captureState, plan.enabled);
  saveCaptureStateNow();
  const win = getWindow(LIVE_WINDOW_ID);
  if (win) {
    // Runtime compatibility mode is scrim + opaque renderer surface: the
    // BrowserWindow transparent flag is creation-only in Electron. A true
    // transparent:false surface is used on the NEXT launch (createWindow reads
    // captureState.compatMode). Recreating the live window was attempted
    // during evidence collection and crashed the surface on this host, so it is
    // opt-in only for diagnostics.
    try {
      win.setBackgroundColor(plan.backgroundColor);
    } catch (error) {
      console.warn("[capture] setBackgroundColor failed: " + error);
    }
    if (changed && process.env.HIRESHADE_COMPAT_RECREATE === "1") {
      // Never destroy the window synchronously inside the IPC handler the
      // renderer is awaiting (S2 root-cause class): reply first, then recreate.
      setTimeout(function () {
        recreateFloatingSurface("compat-mode-changed");
      }, 60);
    }
  }
  reassertCaptureProtection("compat-mode-changed");
  if (!plan.enabled) maybeSuggestCaptureMode(captureState.reportedVisible);
  broadcastCaptureState();
  console.log(
    "[capture] compatibility mode=" + plan.enabled + " transparent=" + plan.transparent + " background=" + plan.backgroundColor + " surfaceRecreated=" + changed,
  );
  return captureStateSnapshot();
}

function applyCaptureProfile(profile) {
  const safe = normalizeCaptureProfile(profile);
  if (!isCaptureProfile(profile)) {
    console.warn("[capture] unknown profile " + JSON.stringify(profile) + "; using " + safe);
  }
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) throw new Error("floating overlay is not open");
  const display = screen.getDisplayMatching(win.getBounds());
  const next = computeCaptureLayout(safe, display.workArea);
  win.setBounds(next);
  captureState = setCaptureProfileState(captureState, safe, next);
  saveCaptureStateNow();
  reassertCaptureProtection("profile-change", win);
  const suggestion = maybeSuggestCaptureMode(false);
  broadcastCaptureState();
  console.log(
    "[capture] profile=" + safe + " bounds=" + JSON.stringify(next) + " workArea=" + JSON.stringify(display.workArea) + " suggestion=" + (suggestion.suggest ? suggestion.confidence : "none"),
  );
  return captureStateSnapshot();
}

function reportCaptureVisible(visible) {
  const win = getWindow(LIVE_WINDOW_ID);
  captureState = recordCaptureSelfCheck(captureState, {
    reportedVisible: Boolean(visible),
    at: Date.now(),
    overlayAreaRatio: overlayAreaRatio(win),
    transparent: !captureState.compatMode,
    knownBadCapturePath: captureState.knownBadCapturePath,
  });
  saveCaptureStateNow();
  if (captureState.lastSuggestion) sendCaptureSuggestion(captureState.lastSuggestion);
  broadcastCaptureState();
  console.log("[capture] self-check reported visible=" + Boolean(visible) + " suggestion=" + (captureState.lastSuggestion ? captureState.lastSuggestion.confidence : "none"));
  return captureStateSnapshot();
}

// ─── S3 pre-flight (GREEN/AMBER/RED routing) ───────────────────────────────

function preflightContext() {
  const win = getWindow(LIVE_WINDOW_ID);
  const bounds = win ? win.getBounds() : null;
  const displays = screen.getAllDisplays().map(function (display) {
    return {
      id: display.id,
      primary: display.id === screen.getPrimaryDisplay().id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
    };
  });
  let overlayDisplayId = null;
  if (bounds) {
    try {
      overlayDisplayId = screen.getDisplayMatching(bounds).id;
    } catch (error) {
      console.warn("[preflight] display matching failed: " + error);
    }
  }
  return {
    displays: displays,
    overlayBounds: bounds,
    overlayDisplayId: overlayDisplayId,
    captureState: Object.assign({}, captureStateSnapshot(), {
      overlayAreaRatio: overlayAreaRatio(win),
    }),
  };
}

function moveOverlayToDisplay(displayId) {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win) throw new Error("floating overlay is not open");
  const display = screen.getAllDisplays().find(function (candidate) {
    return candidate.id === Number(displayId);
  });
  if (!display) throw new Error("unknown display id: " + String(displayId));
  const profile = captureState.lastProfile || "banner";
  const next = computeCaptureLayout(profile, display.workArea);
  win.setBounds(next);
  settings = recordPresetBounds(settings, LIVE_WINDOW_ID, next);
  saveSettingsNow();
  reassertCaptureProtection("preflight-move", win);
  broadcastCaptureState();
  console.log("[preflight] moved overlay to display " + display.id + " bounds=" + JSON.stringify(next));
  return { ok: true, displayId: display.id, bounds: next };
}

function showPreflightSelfCheck(pattern) {
  const win = getWindow(LIVE_WINDOW_ID);
  if (!win || win.isDestroyed()) throw new Error("floating overlay is not open");
  const kind = pattern === "black-bar-leak" ? "black-bar-leak" : "content-leak";
  win.webContents.send(PREFLIGHT_CHANNELS.showSelfCheck, { pattern: kind });
  console.log("[preflight] self-check pattern requested: " + kind);
  return { ok: true, pattern: kind };
}

function registerIpc() {
  ipcMain.handle(DESKTOP_IPC.getSettings, function (event) {
    requireKnownSender(event);
    return publicSettings();
  });

  ipcMain.handle(DESKTOP_IPC.getHotkeys, function (event) {
    requireKnownSender(event);
    return resolvedHotkeyPayload();
  });

  ipcMain.handle(DESKTOP_IPC.getState, function (event) {
    requireKnownSender(event);
    return stateSnapshot();
  });

  ipcMain.handle(DESKTOP_IPC.setOpacity, function (event, value) {
    requireKnownSender(event);
    settings = applyOpacity(settings, Number(value));
    const win = getWindow(LIVE_WINDOW_ID);
    if (win) {
      try {
        win.setOpacity(settings.opacity);
      } catch (error) {
        console.warn("[overlay] setOpacity failed: " + error);
      }
    }
    saveSettingsNow();
    console.log("[overlay] opacity=" + settings.opacity);
    return publicSettings();
  });

  ipcMain.handle(DESKTOP_IPC.setClickThrough, function (event, enabled) {
    requireKnownSender(event);
    settings = setClickThrough(settings, Boolean(enabled));
    const win = getWindow(LIVE_WINDOW_ID);
    if (win) {
      try {
        win.setIgnoreMouseEvents(Boolean(enabled), { forward: true });
      } catch (error) {
        console.warn("[overlay] setIgnoreMouseEvents failed: " + error);
      }
    }
    saveSettingsNow();
    console.log("[overlay] dynamic click-through=" + settings.clickThrough);
    return publicSettings();
  });

  ipcMain.handle(DESKTOP_IPC.setPrivateMode, function (event, enabled) {
    requireKnownSender(event);
    settings = setPrivateMode(settings, Boolean(enabled));
    saveSettingsNow();
    reassertCaptureProtection("private-mode-changed");
    console.log("[overlay] private mode=" + settings.isPrivate);
    return publicSettings();
  });

  ipcMain.handle(DESKTOP_IPC.applyPositionPreset, function (event, preset, targetWindowId) {
    requireKnownSender(event);
    if (!isSelectablePositionPreset(preset)) {
      throw new Error("unknown position preset: " + String(preset));
    }
    const windowId = targetWindowId === "launcher" ? "launcher" : LIVE_WINDOW_ID;
    const win = getWindow(windowId);
    if (!win) throw new Error("window is not open: " + windowId);
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const next = boundsForPreset(display.workArea, bounds, preset);
    win.setBounds(next);
    settings = recordPresetBounds(settings, windowId, next);
    if (windowId === LIVE_WINDOW_ID) settings = setPositionPreset(settings, preset);
    saveSettingsNow();
    reassertCaptureProtection("preset-change", win);
    maybeSuggestCaptureMode(false);
    console.log(
      "[overlay] preset=" + preset + " window=" + windowId + " bounds=" + JSON.stringify(next) + " workArea=" + JSON.stringify(display.workArea),
    );
    return publicSettings();
  });

  // ── O2 capture protection / compatibility / self-check IPC ───────────────

  ipcMain.handle(CAPTURE_CHANNELS.getState, function (event) {
    requireKnownSender(event);
    return captureStateSnapshot();
  });

  ipcMain.handle(CAPTURE_CHANNELS.setCompatMode, function (event, enabled) {
    requireKnownSender(event);
    return applyCaptureCompatMode(Boolean(enabled));
  });

  ipcMain.handle(CAPTURE_CHANNELS.setAffinityMode, function (event, mode) {
    requireKnownSender(event);
    captureState = captureLogic.setAffinityMode(captureState, mode);
    saveCaptureStateNow();
    reassertCaptureProtection("affinity-mode-changed");
    broadcastCaptureState();
    console.log("[capture] affinity mode=" + captureState.affinityMode);
    return captureStateSnapshot();
  });

  ipcMain.handle(CAPTURE_CHANNELS.applyProfile, function (event, profile) {
    requireKnownSender(event);
    return applyCaptureProfile(profile);
  });

  ipcMain.handle(CAPTURE_CHANNELS.reportVisible, function (event, visible) {
    requireKnownSender(event);
    return reportCaptureVisible(Boolean(visible));
  });

  ipcMain.handle(CAPTURE_CHANNELS.markSelfCheck, function (event) {
    requireKnownSender(event);
    captureState = Object.assign({}, captureState, { lastSelfCheckAt: Date.now() });
    saveCaptureStateNow();
    broadcastCaptureState();
    return captureStateSnapshot();
  });

  ipcMain.handle(CAPTURE_CHANNELS.assertNow, function (event) {
    requireKnownSender(event);
    const entry = reassertCaptureProtection("manual-assert");
    return Object.assign({}, captureStateSnapshot(), { assertEntry: entry });
  });

  ipcMain.handle(CAPTURE_CHANNELS.simulateDisplayChange, function (event) {
    requireKnownSender(event);
    if (!DEBUG_IPC) throw new Error("simulated display change is debug-only");
    const entry = reassertCaptureProtection("display-metrics-changed");
    console.log("[capture] simulated display change -> reassert #" + (entry ? entry.count : 0));
    return Object.assign({}, captureStateSnapshot(), { simulated: true, assertEntry: entry });
  });

  ipcMain.handle(CAPTURE_CHANNELS.setHint, function (event, hint) {
    requireKnownSender(event);
    if (!DEBUG_IPC) throw new Error("capture hints are debug-only");
    captureState = setKnownBadCapturePathState(captureState, hint);
    saveCaptureStateNow();
    maybeSuggestCaptureMode(captureState.reportedVisible);
    broadcastCaptureState();
    return captureStateSnapshot();
  });

  // ── S3 pre-flight IPC ────────────────────────────────────────────────────

  ipcMain.handle(PREFLIGHT_CHANNELS.getContext, function (event) {
    requireKnownSender(event);
    return preflightContext();
  });

  ipcMain.handle(PREFLIGHT_CHANNELS.moveToDisplay, function (event, displayId) {
    requireKnownSender(event);
    return moveOverlayToDisplay(displayId);
  });

  ipcMain.handle(PREFLIGHT_CHANNELS.showSelfCheck, function (event, payload) {
    requireKnownSender(event);
    return showPreflightSelfCheck(payload && payload.pattern);
  });

  ipcMain.handle(PREFLIGHT_CHANNELS.rendered, function (event, payload) {
    requireKnownSender(event);
    console.log("[preflight] rendered status=" + String(payload && payload.status));
    return { ok: true };
  });

  ipcMain.handle(DESKTOP_IPC.debugInvokeAction, function (event, action) {
    requireKnownSender(event);
    if (!DEBUG_IPC) throw new Error("debug IPC is disabled");
    const known = resolvedHotkeys.some(function (binding) {
      return binding.action === action;
    });
    if (!known) throw new Error("unknown hotkey action: " + String(action));
    handleHotkeyAction(action);
    return { action: action, windows: windowStateSnapshot() };
  });

  // T-06: dynamic click-through hit-test from preload.js (fire-and-forget).
  ipcMain.on(POINTER_PASS_THROUGH_CHANNEL, function (event, ignore) {
    if (senderWindowId(event) !== LIVE_WINDOW_ID) return;
    if (!settings.clickThrough) return;
    const win = getWindow(LIVE_WINDOW_ID);
    if (!win) return;
    try {
      win.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
    } catch (error) {
      console.warn("[overlay] pointer pass-through failed: " + error);
    }
  });
}

// ─── Window creation ────────────────────────────────────────────────────────

function createWindow(spec, runtime) {
  const run = runtime || {};
  const compatPlan = spec.id === LIVE_WINDOW_ID ? computeCompatPlan(captureState.compatMode) : null;
  const windowOptions = Object.assign({}, spec.opts, run.windowOptions || {});
  if (compatPlan && spec.id === LIVE_WINDOW_ID) {
    // Compatibility mode creates a genuinely opaque surface (transparent:false)
    // with a solid scrim colour; see recreateFloatingSurface for the runtime toggle.
    windowOptions.transparent = compatPlan.transparent;
    windowOptions.backgroundColor = compatPlan.backgroundColor;
  }
  windowOptions.webPreferences = Object.assign(
    {},
    spec.opts.webPreferences,
    run.windowOptions && run.windowOptions.webPreferences ? run.windowOptions.webPreferences : {},
  );
  const win = new BrowserWindow(windowOptions);
  applyPlatformWindowBehavior(win, spec);
  applyWindowState(win, spec.id);
  if (run.bounds) {
    try {
      win.setBounds(run.bounds);
    } catch (error) {
      console.warn("[capture] failed to restore bounds after recreate: " + error);
    }
  }

  // T-04: re-apply the persisted private mode on every transition that can
  // silently drop the exclusion (re-show, restore, focus).
  win.on("show", function () {
    reassertCaptureProtection("show", win);
    if (spec.id === LIVE_WINDOW_ID) registerLiveCallHotkeys();
  });
  win.on("hide", function () {
    if (spec.id === LIVE_WINDOW_ID) unregisterLiveCallHotkeys();
  });
  win.on("restore", function () {
    reassertCaptureProtection("restore", win);
  });
  win.on("focus", function () {
    reassertCaptureProtection("focus", win);
  });

  win.once("ready-to-show", function () {
    if (run.showOnReady === false) return;
    win.show();
  });
  // Fallback: a recreated opaque surface can miss ready-to-show during the GPU
  // surface transition; force-show once the document has loaded.
  win.webContents.once("did-finish-load", function () {
    if (run.showOnReady === false || win.isDestroyed() || win.isVisible()) return;
    setTimeout(function () {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 300);
  });
  win.on("closed", function () {
    // Guard against a late "closed" from a previous surface deleting the map
    // entry of the replacement window (the S2 root-cause hazard when the
    // overlay is recreated for compatibility mode).
    if (windows.get(spec.id) === win) windows.delete(spec.id);
    if (windowIdByWebContents.get(win.webContents.id) === spec.id) {
      windowIdByWebContents.delete(win.webContents.id);
    }
    if (spec.id === LIVE_WINDOW_ID && !windows.has(LIVE_WINDOW_ID)) {
      unregisterLiveCallHotkeys();
    }
  });

  attachBoundsPersistence(win, spec.id);

  win.loadURL(entryUrl(spec.id)).catch(function (error) {
    console.error("[" + spec.id + "] failed to load " + entryUrl(spec.id) + ":", error);
  });

  windows.set(spec.id, win);
  windowIdByWebContents.set(win.webContents.id, spec.id);
  reassertCaptureProtection("window-recreated", win);
  return win;
}

function createAll() {
  for (const spec of WINDOW_SPECS) {
    createWindow(spec);
  }
}

/**
 * Runtime compatibility-mode toggle. Electron's transparent flag is creation
 * only, so a true opaque surface needs the floating window to be recreated with
 * transparent:false + a solid background colour. Bounds/visibility/focus are
 * preserved and capture exclusion is re-asserted on the new HWND.
 */
function recreateFloatingSurface(reason) {
  const old = windows.get(LIVE_WINDOW_ID);
  if (!old || old.isDestroyed()) return null;
  const bounds = old.getBounds();
  const wasVisible = old.isVisible();
  const wasFocused = old.isFocused();
  const plan = computeCompatPlan(captureState.compatMode);
  const baseSpec = WINDOW_SPECS.find(function (spec) {
    return spec.id === LIVE_WINDOW_ID;
  });
  if (!baseSpec) return null;
  const oldWebContentsId = old.webContents.id;
  windows.delete(LIVE_WINDOW_ID);
  windowIdByWebContents.delete(oldWebContentsId);
  try {
    // Clear protection before teardown so a protected surface cannot race the
    // new HWND's affinity/GPU surface setup.
    old.setContentProtection(false);
  } catch (error) {
    console.warn("[capture] clear protection before recreate failed: " + error);
  }

  const spec = Object.assign({}, baseSpec, {
    opts: Object.assign({}, baseSpec.opts, {
      transparent: plan.transparent,
      backgroundColor: plan.backgroundColor,
    }),
  });

  let recreated = false;
  const build = function () {
    if (recreated) return null;
    recreated = true;
    if (old && !old.isDestroyed()) {
      try {
        old.destroy();
      } catch (error) {
        console.warn("[capture] failed to destroy old floating surface: " + error);
      }
    }
    const win = createWindow(spec, { bounds: bounds, showOnReady: wasVisible });
    if (wasVisible) {
      win.once("ready-to-show", function () {
        if (wasFocused && !win.isDestroyed()) win.focus();
      });
    }
    console.log(
      "[capture] floating surface recreated (" + reason + "): compat=" + captureState.compatMode + " transparent=" + plan.transparent + " bounds=" + JSON.stringify(bounds),
    );
    reassertCaptureProtection("window-recreated", win);
    return win;
  };
  if (old.isDestroyed()) return build();
  // Wait for OS teardown before creating the new transparent:false surface;
  // immediate creation can race the GPU surface swap.
  old.once("closed", function () {
    setTimeout(build, 30);
  });
  setTimeout(function () {
    if (!recreated) build();
  }, 750);
  return null;
}

// The floating screen uses getUserMedia (Deepgram transcription) at runtime.
// Without an explicit allowance, Electron denies microphone access in the
// renderer even though the page asks via Permissions-Policy.
function allowMediaPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler(function (_wc, permission, callback, details) {
    const allowed = ["media", "mediaKeySystem", "display-capture"].includes(permission);
    if (process.env.ELECTRON_SHELL_DEBUG_PERMISSIONS) {
      console.log("permission request:", permission, "granted:", allowed, details && details.requestingUrl);
    }
    callback(allowed);
  });
  ses.setPermissionCheckHandler(function (_wc, permission) {
    return ["media", "mediaKeySystem", "display-capture"].includes(permission);
  });
}

function installMacDockBehavior() {
  if (!IS_MAC) return;
  // T-05: prefer LSUIElement in the packaged Info.plist; until electron-builder
  // packaging lands, a one-shot dock hide (no 2 s poll) is the honest fallback.
  if (app.dock && typeof app.dock.hide === "function") {
    app.dock.hide();
  }
}

function focusExistingLauncher() {
  const launcher = windows.get("launcher");
  if (launcher && !launcher.isDestroyed()) {
    if (launcher.isMinimized()) launcher.restore();
    launcher.show();
    launcher.focus();
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", function () {
    focusExistingLauncher();
  });

  app.whenReady().then(function () {
    loadSettings();
    loadCaptureState();
    allowMediaPermissions();
    registerIpc();
    installMacDockBehavior();
    createAll();
    registerAppHotkeys();
    startAlwaysOnTopWatchdog();

    // O2: display changes can drop the affinity (DPI/scale/work-area or
    // monitor add/remove). Re-assert on every real event. A real unplug/plug is
    // UNTESTED here (single display); the evidence run simulates the same code
    // path via the debug IPC.
    screen.on("display-metrics-changed", function () {
      reassertCaptureProtection("display-metrics-changed");
    });
    screen.on("display-added", function () {
      reassertCaptureProtection("display-added");
    });
    screen.on("display-removed", function () {
      reassertCaptureProtection("display-removed");
    });

    app.on("activate", function () {
      if (windows.size === 0) createAll();
    });
  });

  app.on("window-all-closed", function () {
    app.quit();
  });

  app.on("will-quit", function () {
    stopAlwaysOnTopWatchdog();
    unregisterLiveCallHotkeys();
    globalShortcut.unregisterAll();
    registeredAccelerators.clear();
    saveSettingsNow();
    saveCaptureStateNow();
  });
}
