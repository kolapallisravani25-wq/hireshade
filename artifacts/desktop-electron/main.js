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
const BOUNDS_SAVE_DEBOUNCE_MS = 250;
const ALWAYS_ON_TOP_INTERVAL_MS = 1000;

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

// ─── Stealth (T-04) ─────────────────────────────────────────────────────────

function applyStealth(win) {
  if (!STEALTH_ENABLED || !win || win.isDestroyed()) return;
  if (typeof win.setContentProtection !== "function") return;
  // Only primitive: Electron maps this to WDA_EXCLUDEFROMCAPTURE on Windows and
  // NSWindowSharingNone on macOS. Re-applied on every show/restore/focus below.
  win.setContentProtection(settings.isPrivate);
}

function reassertStealth(win) {
  applyStealth(win);
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
  const onChange = function () {
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
  win.on("moved", onChange);
  win.on("resized", onChange);
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
    for (const win of windows.values()) {
      applyStealth(win);
    }
    saveSettingsNow();
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
    console.log(
      "[overlay] preset=" + preset + " window=" + windowId + " bounds=" + JSON.stringify(next) + " workArea=" + JSON.stringify(display.workArea),
    );
    return publicSettings();
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

function createWindow(spec) {
  const win = new BrowserWindow({
    ...spec.opts,
    webPreferences: {
      ...spec.opts.webPreferences,
    },
  });
  applyPlatformWindowBehavior(win, spec);
  applyWindowState(win, spec.id);

  // T-04: re-apply the persisted private mode on every transition that can
  // silently drop the exclusion (re-show, restore, focus).
  win.on("show", function () {
    reassertStealth(win);
    if (spec.id === LIVE_WINDOW_ID) registerLiveCallHotkeys();
  });
  win.on("hide", function () {
    if (spec.id === LIVE_WINDOW_ID) unregisterLiveCallHotkeys();
  });
  win.on("restore", function () {
    reassertStealth(win);
  });
  win.on("focus", function () {
    reassertStealth(win);
  });

  win.once("ready-to-show", function () {
    win.show();
  });
  win.on("closed", function () {
    windows.delete(spec.id);
    windowIdByWebContents.delete(win.webContents.id);
    if (spec.id === LIVE_WINDOW_ID) unregisterLiveCallHotkeys();
  });

  attachBoundsPersistence(win, spec.id);

  win.loadURL(entryUrl(spec.id)).catch(function (error) {
    console.error("[" + spec.id + "] failed to load " + entryUrl(spec.id) + ":", error);
  });

  windows.set(spec.id, win);
  windowIdByWebContents.set(win.webContents.id, spec.id);
  return win;
}

function createAll() {
  for (const spec of WINDOW_SPECS) {
    createWindow(spec);
  }
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
    allowMediaPermissions();
    registerIpc();
    installMacDockBehavior();
    createAll();
    registerAppHotkeys();
    startAlwaysOnTopWatchdog();

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
  });
}
