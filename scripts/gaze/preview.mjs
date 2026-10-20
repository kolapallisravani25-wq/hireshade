import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/**
 * Build and serve the standalone gaze preview.
 *
 * Usage:
 *   node scripts/gaze/preview.mjs              # build + serve http://127.0.0.1:8765
 *   node scripts/gaze/preview.mjs --no-serve   # build only (CI)
 *   node scripts/gaze/preview.mjs --port 9000
 */
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const distDir = path.join(repoRoot, "docs", "evidence", "gaze", "preview-dist");
const viteBin = path.join(repoRoot, "artifacts", "craft-vita", "node_modules", "vite", "bin", "vite.js");
const configPath = path.join(repoRoot, "scripts", "gaze", "preview", "vite.config.mjs");

const args = process.argv.slice(2);
const noServe = args.includes("--no-serve");
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 8765;

if (!fs.existsSync(viteBin)) {
  console.error("[gaze-preview] vite not installed at " + viteBin + "; run pnpm install at the repo root");
  process.exit(1);
}

const build = spawnSync(process.execPath, [viteBin, "build", "--config", configPath], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (build.status !== 0) {
  console.error("[gaze-preview] build failed with exit code " + build.status);
  process.exit(build.status ?? 1);
}
console.log("[gaze-preview] built " + path.relative(repoRoot, distDir));

if (noServe) process.exit(0);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

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

server.listen(port, "127.0.0.1", () => {
  console.log("[gaze-preview] serving " + "http://127.0.0.1:" + port + "/");
  console.log("[gaze-preview] press Ctrl+C to stop");
});
