"use strict";

/**
 * Render the standalone gaze preview in Electron and save a screenshot as
 * evidence (docs/evidence/gaze/preview.png). Serves preview-dist over loopback so
 * ES modules load without file:// restrictions.
 *
 * Usage (from repo root, ELECTRON_RUN_AS_NODE removed):
 *   electron scripts/gaze/capture-preview.cjs
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const distDir = path.join(repoRoot, "docs", "evidence", "gaze", "preview-dist");
const outFile = path.join(repoRoot, "docs", "evidence", "gaze", "preview.png");
const port = 8767;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const urlPath = decodeURIComponent((request.url || "/").split("?")[0] || "/");
      const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.join(distDir, relative);
      if (!filePath.startsWith(distDir)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      fs.readFile(filePath, (error, buffer) => {
        if (error) {
          response.writeHead(404);
          response.end("not found");
          return;
        }
        response.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
        response.end(buffer);
      });
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(path.join(distDir, "index.html"))) {
    throw new Error("preview-dist missing; run node scripts/gaze/preview.mjs --no-serve first");
  }
  const server = await startServer();
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1240,
    height: 960,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Offscreen rendering makes capturePage() reliable in non-interactive
      // sessions (CI / agent shells) where a hidden window has no surface.
      offscreen: true,
      paintWhenInitiallyHidden: true,
    },
  });
  try {
    await window.loadURL("http://127.0.0.1:" + port + "/");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const image = await window.capturePage();
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, image.toPNG());
    const stats = await window.webContents.executeJavaScript("document.getElementById('stats').innerText");
    console.log("[gaze-preview-capture] wrote " + outFile);
    console.log("[gaze-preview-capture] stats:\n" + stats);
  } finally {
    window.destroy();
    server.close();
    app.quit();
  }
}

main().catch((error) => {
  console.error("[gaze-preview-capture] " + (error && error.message ? error.message : error));
  app.quit();
  process.exitCode = 1;
});
