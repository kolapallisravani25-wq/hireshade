"use strict";
// macOS exclusion probe window: magenta, frameless, content-protected. The
// ScreenCaptureKit probe samples this rectangle. If SCK honours
// NSWindowSharingNone the sampled colour is the desktop, not magenta.
const { app, BrowserWindow, screen } = require("electron");

app.whenReady().then(() => {
  const display = screen.getPrimaryDisplay();
  const width = 400, height = 300;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = Math.round(display.bounds.y + (display.bounds.height - height) / 2);
  const win = new BrowserWindow({
    x, y, width, height, frame: false, transparent: false, show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setContentProtection(true);
  win.loadURL("data:text/html,<body style='margin:0;background:%23ff00ff;width:100vw;height:100vh'></body>");
  win.once("ready-to-show", () => {
    win.show();
    win.setContentProtection(true);
  });
  setTimeout(() => {
    console.log("PROBE_BOUNDS " + JSON.stringify({ x, y, width, height, display: display.bounds }));
  }, 1500);
  setTimeout(() => app.quit(), 20000);
});
