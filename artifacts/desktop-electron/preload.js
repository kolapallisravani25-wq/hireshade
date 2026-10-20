"use strict";

/**
 * HireShade Electron preload.
 *
 * Runs in a sandboxed, contextIsolation-enabled renderer (no nodeIntegration)
 * and exposes a tiny, whitelisted bridge on window.hireshadeDesktop. No raw
 * ipcRenderer, no Node primitives.
 *
 * It also owns the dynamic click-through hit-test from docs/TARGET_VERIFIED.md
 * T-06: mousemove is throttled to 40 ms and main is told to ignore mouse events
 * whenever the cursor is over a transparent region ([data-transparent="true"]),
 * unless the user is dragging. Keeping this in the preload means every overlay
 * entry point gets the behavior without changing React entry files.
 *
 * IPC channel names mirror DESKTOP_IPC in
 * artifacts/craft-vita/src/overlay/hotkeys.ts (a vitest contract test asserts
 * they stay in sync).
 */

const { contextBridge, ipcRenderer } = require("electron");

const DESKTOP_IPC = {
  getSettings: "desktop:overlay:get-settings",
  getHotkeys: "desktop:hotkeys:get-bindings",
  getState: "desktop:overlay:get-state",
  setOpacity: "desktop:overlay:set-opacity",
  setClickThrough: "desktop:overlay:set-click-through",
  setPrivateMode: "desktop:overlay:set-private-mode",
  applyPositionPreset: "desktop:overlay:apply-position-preset",
  debugInvokeAction: "desktop:debug:invoke-action",
};

const HOTKEY_EVENT_CHANNEL = "desktop:hotkey";
const POINTER_PASS_THROUGH_CHANNEL = "desktop:overlay:pointer-pass-through";

const POINTER_THROTTLE_MS = 40;

function currentWindowId() {
  try {
    const pathname = String(window.location.pathname || "");
    if (pathname.endsWith("/floating.html") || pathname.endsWith("\\floating.html")) {
      return "floating";
    }
    if (pathname.endsWith("/launcher.html") || pathname.endsWith("\\launcher.html")) {
      return "launcher";
    }
  } catch {
    // Fall through to the neutral id below.
  }
  return "unknown";
}

const windowId = currentWindowId();

/**
 * Dynamic click-through (T-06). Main only honors this for the floating overlay
 * and only while the dynamic click-through setting is enabled.
 */
function installPointerPassThrough() {
  if (windowId !== "floating") return;

  let dragging = false;
  let lastSent = null;
  let lastSentAt = 0;
  let timer = 0;
  let pending = null;

  function send(ignore) {
    pending = null;
    lastSentAt = Date.now();
    if (ignore === lastSent) return;
    lastSent = ignore;
    ipcRenderer.send(POINTER_PASS_THROUGH_CHANNEL, ignore);
  }

  function schedule(ignore) {
    const elapsed = Date.now() - lastSentAt;
    if (elapsed >= POINTER_THROTTLE_MS) {
      send(ignore);
      return;
    }
    pending = ignore;
    if (timer) return;
    timer = setTimeout(function () {
      timer = 0;
      if (pending !== null) send(pending);
    }, POINTER_THROTTLE_MS - elapsed);
  }

  // The target app marks transparent surfaces with [data-transparent='true'].
  // craft-vita does not use that attribute yet; it uses [data-interactive] on
  // the overlay card / launcher card layers (24 markers today). Support both:
  //  - data-transparent='true' -> always pass the click through
  //  - inside a [data-interactive] island -> capture the pointer
  //  - anything else -> pass through so the overlay never blocks the meeting app
  function shouldPassThrough(target) {
    if (!target || typeof target.closest !== "function") return true;
    if (target.closest("[data-transparent='true']") !== null) return true;
    return target.closest("[data-interactive]") === null;
  }

  window.addEventListener(
    "mousemove",
    function (event) {
      if (dragging) return;
      schedule(shouldPassThrough(event.target));
    },
    { passive: true },
  );

  // While dragging an interactive element the overlay must capture the mouse.
  window.addEventListener(
    "mousedown",
    function () {
      dragging = true;
      send(false);
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    function () {
      dragging = false;
    },
    true,
  );
  document.addEventListener("mouseleave", function () {
    send(true);
  });
  window.addEventListener("blur", function () {
    dragging = false;
  });

  // Match the target: start in pass-through mode immediately after creation
  // (main also applies this before the first paint).
  send(true);
}

// ─── O2 capture self-check + compatibility mode ─────────────────────────────
// Channel names / CSS / copy mirror src/overlay/capture/captureLogic.cjs (a
// vitest contract test asserts the main/preload copies stay in sync). Sandboxed
// preloads cannot require local files, so the values are inlined here.

const CAPTURE_CHANNELS = {
  getState: "desktop:capture:get-state",
  setCompatMode: "desktop:capture:set-compat-mode",
  applyProfile: "desktop:capture:apply-profile",
  reportVisible: "desktop:capture:report-visible",
  markSelfCheck: "desktop:capture:mark-self-check",
  assertNow: "desktop:capture:assert-now",
  simulateDisplayChange: "desktop:capture:simulate-display-change",
  setHint: "desktop:capture:set-hint",
  stateChanged: "desktop:capture:state-changed",
  suggestion: "desktop:capture:suggestion",
};

const CAPTURE_PROFILES = ["card", "banner", "reading"];
const COMPAT_CSS_CLASS = "hireshade-capture-compat";
const COMPAT_CSS =
  "html." + COMPAT_CSS_CLASS + ",html." + COMPAT_CSS_CLASS + " body{background:#0b0d12 !important;background-image:none !important;}" +
  "html." + COMPAT_CSS_CLASS + " #root{background:#0b0d12 !important;}" +
  "html." + COMPAT_CSS_CLASS + " *{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;filter:none !important;" +
  "border-radius:0 !important;box-shadow:none !important;text-shadow:none !important;}";

const SELF_CHECK_COPY = {
  title: "Can they see it?",
  instructions: "Look at the shared screen on the OTHER device (or ask the person on the call). The pattern is deliberately high contrast.",
  limitation: "We cannot reliably detect whether a capture app is showing this window. Capture apps use different Windows APIs, and some (notably DXGI Desktop Duplication) ignore capture exclusion.",
  hiddenLabel: "It is hidden",
  visibleLabel: "I can still see it",
  visibleReported: "Thanks - that means this capture path is showing the overlay. Try compatibility mode, or share a window/tab instead of the whole screen.",
  hiddenReported: "Good - the overlay was not visible in the capture you checked.",
  compatSuggestion: "Compatibility mode recreates the overlay as an opaque surface with a solid scrim (no transparency, blur or rounded compositing).",
};

const FALLBACK_LADDER = [
  { step: 1, id: "second-monitor", title: "Use a second monitor for the meeting", detail: "Share the meeting app's screen on the other monitor; keep HireShade on this one." },
  { step: 2, id: "share-window-or-tab", title: "Share a window or browser tab instead of the entire screen", detail: "Window/tab shares capture only that surface." },
  { step: 3, id: "compatibility-mode", title: "Turn on compatibility mode", detail: "Opaque surface + solid scrim, no transparency/blur/rounded compositing." },
  { step: 4, id: "browser-only", title: "Use the browser-only overlay", detail: "Open the web app in a normal browser window; keep it off the shared screen." },
];

const WIDGET_STYLE_ID = "hireshade-capture-styles";
const WIDGET_CSS =
  "#hireshade-capture-root{position:fixed;right:14px;bottom:14px;z-index:2147483000;font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#e6e9ef;}" +
  "#hireshade-capture-toggle{background:#151a23;border:1px solid #2c3648;color:#c9d6ea;border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.45);}" +
  "#hireshade-capture-toggle:hover{background:#1d2534;}" +
  "#hireshade-capture-panel{margin-top:8px;width:300px;background:#10141b;border:1px solid #2c3648;border-radius:10px;padding:12px;box-shadow:0 12px 34px rgba(0,0,0,.6);}" +
  "#hireshade-capture-panel h2{margin:0 0 6px;font-size:13px;color:#fff;}" +
  "#hireshade-capture-panel p{margin:0 0 8px;color:#9fb0c7;}" +
  "#hireshade-capture-panel .row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}" +
  "#hireshade-capture-panel button{background:#1b2433;border:1px solid #33425a;color:#dbe6f5;border-radius:7px;padding:5px 9px;cursor:pointer;}" +
  "#hireshade-capture-panel button:hover{background:#243043;}" +
  "#hireshade-capture-panel button.primary{background:#2b4a7a;border-color:#3f6aa8;}" +
  "#hireshade-capture-panel label{display:flex;gap:6px;align-items:center;color:#c9d6ea;margin:4px 0 8px;}" +
  "#hireshade-capture-panel details{margin-top:6px;color:#9fb0c7;}" +
  "#hireshade-capture-panel ol{margin:6px 0 0 18px;padding:0;}" +
  "#hireshade-capture-panel li{margin-bottom:5px;}" +
  "#hireshade-capture-result{color:#8fd19e;}" +
  "#hireshade-capture-suggestion{color:#ffd78a;}" +
  "#hireshade-selfcheck-pattern{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;cursor:default;" +
  "background:repeating-linear-gradient(45deg,#ffffff 0 28px,#000000 28px 56px);}" +
  "#hireshade-selfcheck-pattern .label{background:#000;color:#fff;padding:14px 22px;font:700 26px/1.2 system-ui,sans-serif;border:3px solid #fff;text-align:center;}" +
  "#hireshade-selfcheck-pattern button{background:#fff;color:#000;border:3px solid #000;border-radius:8px;padding:10px 18px;font:700 16px system-ui,sans-serif;cursor:pointer;}" +
  "#hireshade-selfcheck-pattern[hidden]{display:none !important;}" +
  "#hireshade-capture-panel[hidden]{display:none !important;}";

let captureWidgetReady = false;
let captureState = null;

function ensureCaptureStyles() {
  if (document.getElementById(WIDGET_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = WIDGET_STYLE_ID;
  style.textContent = WIDGET_CSS + COMPAT_CSS;
  (document.head || document.documentElement).appendChild(style);
}

function applyCompatVisual(enabled) {
  const root = document.documentElement;
  if (!root) return;
  root.classList.toggle(COMPAT_CSS_CLASS, Boolean(enabled));
}

function captureButton(label, id, primary) {
  const button = document.createElement("button");
  button.textContent = label;
  button.id = id;
  if (primary) button.className = "primary";
  return button;
}

function buildCaptureWidget() {
  if (captureWidgetReady || windowId !== "floating") return;
  if (!document.body) return;
  captureWidgetReady = true;
  ensureCaptureStyles();

  const root = document.createElement("div");
  root.id = "hireshade-capture-root";
  root.setAttribute("data-interactive", "true");

  const toggle = captureButton("Capture check", "hireshade-capture-toggle", false);
  const panel = document.createElement("section");
  panel.id = "hireshade-capture-panel";
  panel.hidden = true;

  const heading = document.createElement("h2");
  heading.textContent = SELF_CHECK_COPY.title;
  panel.appendChild(heading);

  const instructions = document.createElement("p");
  instructions.textContent = SELF_CHECK_COPY.instructions;
  panel.appendChild(instructions);

  const limitation = document.createElement("p");
  limitation.id = "hireshade-capture-note";
  limitation.textContent = SELF_CHECK_COPY.limitation;
  panel.appendChild(limitation);

  const row = document.createElement("div");
  row.className = "row";
  const runButton = captureButton("Show test pattern", "hireshade-selfcheck-run", true);
  row.appendChild(runButton);
  panel.appendChild(row);

  const result = document.createElement("p");
  result.id = "hireshade-capture-result";
  panel.appendChild(result);

  const suggestion = document.createElement("p");
  suggestion.id = "hireshade-capture-suggestion";
  panel.appendChild(suggestion);

  const compatLabel = document.createElement("label");
  const compatCheckbox = document.createElement("input");
  compatCheckbox.type = "checkbox";
  compatCheckbox.id = "hireshade-compat-toggle";
  compatLabel.appendChild(compatCheckbox);
  compatLabel.appendChild(document.createTextNode("Compatibility mode (opaque scrim)"));
  panel.appendChild(compatLabel);

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Still visible? Try these in order";
  details.appendChild(summary);
  const list = document.createElement("ol");
  list.id = "hireshade-capture-fallback";
  FALLBACK_LADDER.forEach(function (step) {
    const item = document.createElement("li");
    item.textContent = step.title + " - " + step.detail;
    list.appendChild(item);
  });
  details.appendChild(list);
  panel.appendChild(details);

  const pattern = document.createElement("div");
  pattern.id = "hireshade-selfcheck-pattern";
  pattern.hidden = true;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "HireShade self-check pattern - high contrast";
  pattern.appendChild(label);
  const done = captureButton("Done - hide pattern", "hireshade-selfcheck-done", false);
  pattern.appendChild(done);

  root.appendChild(toggle);
  root.appendChild(panel);
  root.appendChild(pattern);
  document.body.appendChild(root);

  toggle.addEventListener("click", function () {
    panel.hidden = !panel.hidden;
  });

  runButton.addEventListener("click", function () {
    pattern.hidden = false;
    panel.hidden = true;
    result.textContent = "";
    suggestion.textContent = "";
  });

  done.addEventListener("click", function () {
    pattern.hidden = true;
    panel.hidden = false;
  });

  const report = function (visible) {
    pattern.hidden = true;
    panel.hidden = false;
    result.textContent = visible ? SELF_CHECK_COPY.visibleReported : SELF_CHECK_COPY.hiddenReported;
    ipcRenderer
      .invoke(CAPTURE_CHANNELS.reportVisible, Boolean(visible))
      .catch(function () {});
  };

  const hiddenButton = captureButton(SELF_CHECK_COPY.hiddenLabel, "hireshade-selfcheck-hidden", false);
  const visibleButton = captureButton(SELF_CHECK_COPY.visibleLabel, "hireshade-selfcheck-visible", false);
  row.appendChild(hiddenButton);
  row.appendChild(visibleButton);
  hiddenButton.hidden = true;
  visibleButton.hidden = true;
  pattern.addEventListener("shown", function () {});

  // Outcome buttons appear with the pattern.
  const showOutcomeButtons = function () {
    hiddenButton.hidden = false;
    visibleButton.hidden = false;
  };
  runButton.addEventListener("click", showOutcomeButtons);
  hiddenButton.addEventListener("click", function () {
    report(false);
  });
  visibleButton.addEventListener("click", function () {
    report(true);
  });

  compatCheckbox.addEventListener("change", function () {
    ipcRenderer
      .invoke(CAPTURE_CHANNELS.setCompatMode, compatCheckbox.checked)
      .then(function (state) {
        if (state) applyCaptureState(state);
      })
      .catch(function () {});
  });

  ipcRenderer.on(CAPTURE_CHANNELS.stateChanged, function (_event, state) {
    applyCaptureState(state);
  });
  ipcRenderer.on(CAPTURE_CHANNELS.suggestion, function (_event, payload) {
    if (!payload || !payload.suggest) {
      suggestion.textContent = "";
      return;
    }
    suggestion.textContent =
      "Suggestion: " + (payload.reasons && payload.reasons[0] ? payload.reasons[0] : "this capture path may show the overlay") +
      ". " + SELF_CHECK_COPY.compatSuggestion;
  });

  function applyCaptureState(state) {
    if (!state) return;
    captureState = state;
    const compat = Boolean(state.compatMode);
    compatCheckbox.checked = compat;
    applyCompatVisual(compat);
    if (state.lastProfile) {
      toggle.title = "Capture check - profile: " + state.lastProfile;
    }
  }

  ipcRenderer
    .invoke(CAPTURE_CHANNELS.getState)
    .then(function (state) {
      applyCaptureState(state);
      if (state && state.lastSuggestion && state.lastSuggestion.suggest) {
        suggestion.textContent =
          "Suggestion: " + (state.lastSuggestion.reasons[0] || "") + ". " + SELF_CHECK_COPY.compatSuggestion;
      }
    })
    .catch(function () {});
}

function installCaptureWidget() {
  if (windowId !== "floating") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildCaptureWidget, { once: true });
  } else {
    buildCaptureWidget();
  }
}

function subscribeCaptureChannel(channel, listener) {
  if (typeof listener !== "function") return function () {};
  const wrapped = function (_event, payload) {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return function () {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

function subscribeHotkeys(listener) {
  if (typeof listener !== "function") return function () {};
  const wrapped = function (_event, payload) {
    listener(payload);
  };
  ipcRenderer.on(HOTKEY_EVENT_CHANNEL, wrapped);
  return function () {
    ipcRenderer.removeListener(HOTKEY_EVENT_CHANNEL, wrapped);
  };
}

contextBridge.exposeInMainWorld("hireshadeDesktop", {
  isElectron: true,
  windowId: windowId,
  platform: process.platform,
  getSettings: function () {
    return ipcRenderer.invoke(DESKTOP_IPC.getSettings);
  },
  getHotkeys: function () {
    return ipcRenderer.invoke(DESKTOP_IPC.getHotkeys);
  },
  getState: function () {
    return ipcRenderer.invoke(DESKTOP_IPC.getState);
  },
  setOpacity: function (value) {
    return ipcRenderer.invoke(DESKTOP_IPC.setOpacity, value);
  },
  setClickThrough: function (enabled) {
    return ipcRenderer.invoke(DESKTOP_IPC.setClickThrough, enabled);
  },
  setPrivateMode: function (enabled) {
    return ipcRenderer.invoke(DESKTOP_IPC.setPrivateMode, enabled);
  },
  applyPositionPreset: function (preset, targetWindowId) {
    return ipcRenderer.invoke(DESKTOP_IPC.applyPositionPreset, preset, targetWindowId);
  },
  debugInvokeAction: function (action) {
    return ipcRenderer.invoke(DESKTOP_IPC.debugInvokeAction, action);
  },
  onHotkey: subscribeHotkeys,
});

contextBridge.exposeInMainWorld("hireshadeCapture", {
  isElectron: true,
  windowId: windowId,
  profiles: CAPTURE_PROFILES,
  fallbackLadder: FALLBACK_LADDER,
  selfCheckCopy: SELF_CHECK_COPY,
  getState: function () {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.getState);
  },
  setCompatMode: function (enabled) {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.setCompatMode, Boolean(enabled));
  },
  applyProfile: function (profile) {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.applyProfile, profile);
  },
  reportVisible: function (visible) {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.reportVisible, Boolean(visible));
  },
  markSelfCheck: function () {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.markSelfCheck);
  },
  assertNow: function () {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.assertNow);
  },
  simulateDisplayChange: function () {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.simulateDisplayChange);
  },
  setKnownBadCapturePath: function (hint) {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.setHint, hint);
  },
  onStateChanged: function (listener) {
    return subscribeCaptureChannel(CAPTURE_CHANNELS.stateChanged, listener);
  },
  onSuggestion: function (listener) {
    return subscribeCaptureChannel(CAPTURE_CHANNELS.suggestion, listener);
  },
});

installPointerPassThrough();
installCaptureWidget();
