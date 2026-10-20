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

installPointerPassThrough();
