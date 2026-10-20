/**
 * S4 capture-sprint preload: lets the harness toggle click-through at runtime so
 * one Electron instance can prove ON and OFF without a restart.
 */
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("sprintControl", {
  setIgnoreMouseEvents: function (value) {
    ipcRenderer.send("sprint:ignore-mouse", Boolean(value));
  },
  isClickThrough: function () {
    return ipcRenderer.sendSync("sprint:is-ignore-mouse");
  },
});
