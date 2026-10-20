"use strict";

// Builds the craft-vita UI for the Electron shell: same web build the
// plain-browser path uses, but with all three HTML entries emitted
// (ELECTRON_BUILD=1) and relative asset URLs (--base ./) so windows can
// load the files over file:// in production mode.
const { spawnSync } = require("child_process");
const path = require("path");

const CRAFT_VITA = path.resolve(__dirname, "..", "..", "craft-vita");

const VITE_BIN = path.join(CRAFT_VITA, "node_modules", "vite", "bin", "vite.js");

const result = spawnSync(process.execPath, [VITE_BIN, "build", "--base", "./"], {
  cwd: CRAFT_VITA,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_BUILD: "1" },
});

process.exit(result.status ?? 1);
