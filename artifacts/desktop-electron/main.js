"use strict";

const { app, BrowserWindow, session } = require("electron");
const path = require("path");

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

// UI artifacts produced by artifacts/craft-vita (vite build with
// ELECTRON_BUILD=1 --base ./). Three HTML entries, mirroring the Tauri windows.
const UI_DIST = path.resolve(__dirname, "..", "craft-vita", "dist", "public");

function entryUrl(name) {
  if (VITE_DEV_SERVER_URL) {
    // Dev server serves the raw HTML files from craft-vita's project root.
    return `${VITE_DEV_SERVER_URL.replace(/\/+$/, "")}/${name}.html`;
  }
  return `file://${path.join(UI_DIST, `${name}.html`)}`;
}

// ---------------------------------------------------------------------------
// Stealth mode: exclude windows from screen capture / screen sharing.
//
// BrowserWindow.setContentProtection(true) maps to:
//  - Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
//  - macOS:   CGSSetWindowSharingState (window excluded from capture/sharing)
//  - Linux:   GTK constraint on how well capture exclusion works
//
// The window remains fully visible on the user's screen; only capture
// pipelines (zoom share, OBS, screenshot tools) stop seeing it.
// Per product decision: stealth is always on for every app window.
// Opt-out for testing/debugging: ELECTRON_STEALTH=0.
const STEALTH_ENABLED = process.env.ELECTRON_STEALTH !== "0";

function applyStealth(win) {
  if (!STEALTH_ENABLED) return;
  if (typeof win.setContentProtection === "function") {
    win.setContentProtection(true);
  }
  // Re-assert after restore/show transitions; the flag is sticky on most
  // platforms, but re-applying on focus is cheap and guards against
  // platform quirks (e.g. macOS window recreation on apply).
  const reassert = () => {
    if (!win.isDestroyed()) {
      win.setContentProtection(true);
    }
  };
  win.on("show", reassert);
  win.on("restore", reassert);
  win.on("focus", reassert);
}

// Mirror of artifacts/craft-vita/src-tauri/tauri.conf.json window configs.
const WINDOW_SPECS = [
  {
    id: "floating",
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
      resizable: true,
      maximizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
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
      resizable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    },
    onTopLevel: "floating",
  },
];

const windows = new Map();

function createWindow({ id, opts, onTopLevel }) {
  const win = new BrowserWindow({
    ...opts,
    webPreferences: {
      ...opts.webPreferences,
    },
  });
  // Frameless transparent Tauri-style window: no native chrome, HTML paints itself.
  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, onTopLevel);
  applyStealth(win);
  win.once("ready-to-show", () => win.show());
  win.loadURL(entryUrl(id)).catch((err) => {
    console.error(`[${id}] failed to load ${entryUrl(id)}:`, err);
  });
  windows.set(id, win);
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
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const allowed = ["media", "mediaKeySystem", "display-capture"].includes(permission);
    if (process.env.ELECTRON_SHELL_DEBUG_PERMISSIONS) {
      console.log("permission request:", permission, "granted:", allowed, details?.requestingUrl);
    }
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    return ["media", "mediaKeySystem", "display-capture"].includes(permission);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const launcher = windows.get("launcher");
    if (launcher && !launcher.isDestroyed()) {
      if (launcher.isMinimized()) launcher.restore();
      launcher.focus();
    }
  });

  app.whenReady().then(() => {
    allowMediaPermissions();
    createAll();

    app.on("activate", () => {
      if (windows.size === 0) createAll();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
