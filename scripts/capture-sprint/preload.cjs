/**
 * S4 capture-sprint preload: runtime click-through toggling + authoritative
 * window-state queries for the V4 flake-free harness.
 */
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("sprintControl", {
  setIgnoreMouseEvents: function (value) {
    ipcRenderer.send("sprint:ignore-mouse", Boolean(value));
  },
  focusOverlay: function () {
    ipcRenderer.send("sprint:focus-overlay");
  },
  isClickThrough: function () {
    return ipcRenderer.sendSync("sprint:is-ignore-mouse");
  },
  /** { overlayHwnd, targetHwnd, ignoreMouseTracked, electronGetter, focus flags... } */
  getWindowState: function () {
    return ipcRenderer.invoke("sprint:window-state");
  },
  /** Focus/stack the windows deterministically for a click-through phase. */
  prepare: function (mode) {
    return ipcRenderer.invoke("sprint:prepare", mode === "on" ? "on" : "off");
  },
});
