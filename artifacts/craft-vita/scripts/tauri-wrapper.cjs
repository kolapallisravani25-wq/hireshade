/**
 * Wraps the Tauri CLI so that `pnpm tauri build` automatically bumps the
 * patch version before building.  All other sub-commands (`dev`, `info`,
 * `signer`, etc.) are forwarded unchanged.
 *
 * How it works:
 *   - package.json `"tauri"` script points here instead of the raw tauri bin
 *   - On `build`, we bump package.json, sync tauri.conf.json + Cargo.toml,
 *     then exec the real tauri CLI with the original args
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const root = path.resolve(__dirname, "..");

// ── Auto-bump only for production builds (skip on CI — version already bumped locally) ──
if (args[0] === "build" && !process.env.CI) {
  // 1. Bump package.json (patch)
  const npmResult = spawnSync(
    "npm",
    ["version", "patch", "--no-git-tag-version"],
    { cwd: root, stdio: "inherit", shell: true },
  );
  if (npmResult.status !== 0) process.exit(npmResult.status ?? 1);

  // Re-read fresh version after bump
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const newVersion = pkg.version;

  // 2. Sync src-tauri/tauri.conf.json
  const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = newVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

  // 3. Sync src-tauri/Cargo.toml — only the first version = "..." line
  //    (the [package] section), not crate dependency versions
  const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
  let cargo = fs.readFileSync(cargoPath, "utf8");
  cargo = cargo.replace(/^version = ".*"/m, `version = "${newVersion}"`);
  fs.writeFileSync(cargoPath, cargo);

  console.log(`\n✓ Version auto-bumped to ${newVersion}\n`);
}

// ── Delegate to the real Tauri CLI ──────────────────────────────────────────
const tauriBin = path.join(root, "node_modules", ".bin", "tauri");
const result = spawnSync(tauriBin, args, {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 0);
