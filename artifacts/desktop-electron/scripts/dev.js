"use strict";

// Serves artifacts/craft-vita via Vite dev server, then launches the Electron
// shell pointing at it (the floating screen and launcher windows pick up HMR).
const { spawn } = require("child_process");
const path = require("path");

const CRAFT_VITA = path.resolve(__dirname, "..", "..", "craft-vita");
const PORT = process.env.PORT ?? "5173";
const DEV_URL = `http://localhost:${PORT}`;

// Run binaries directly (no `pnpm`/`npx`/shell indirection): ComSpec may be
// unusable in restricted environments and this avoids arg-escaping issues.
const VITE_BIN = path.join(CRAFT_VITA, "node_modules", "vite", "bin", "vite.js");
const ELECTRON_BIN = require("electron"); // string: absolute path to electron.exe

let vite;
let electron;
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [electron, vite]) {
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        // best effort; child processes exit on their own in most cases
      }
    }
  }
  process.exit(code ?? 0);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

vite = spawn(process.execPath, [VITE_BIN, "--port", String(PORT), "--strictPort"], {
  cwd: CRAFT_VITA,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

let electronStarted = false;
vite.stdout.on("data", (buf) => {
  process.stdout.write(buf);
  if (!electronStarted && /ready in|vite v\d/.test(buf.toString())) {
    electronStarted = true;
    electron = spawn(ELECTRON_BIN, ["."], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
      env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
    });
    electron.on("exit", (code) => shutdown(code ?? 0));
  }
});
vite.stderr.on("data", (buf) => process.stderr.write(buf));
vite.on("error", (err) => {
  console.error("vite failed to start:", err);
  shutdown(1);
});
vite.on("exit", (code) => {
  if (!electronStarted && !shuttingDown) {
    console.error("vite exited before electron started, code", code);
    shutdown(1);
  }
});
