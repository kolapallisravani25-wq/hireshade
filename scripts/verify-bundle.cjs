#!/usr/bin/env node
/**
 * verify-bundle.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Fails the build (exit 1) if the built frontend bundle is INTERNALLY
 * INCONSISTENT — i.e. an HTML entry references a JS/CSS asset that was never
 * emitted to disk.
 *
 * WHY THIS EXISTS:
 *   A desktop build once shipped HTML entries (index/launcher/floating) that
 *   referenced hashed chunks which were missing from the bundle. At runtime the
 *   Tauri asset server returns index.html (text/html) for those missing paths,
 *   the webview refuses to execute HTML as a module script
 *   ("Failed to load module script: ... MIME type text/html"), and EVERY window
 *   renders blank. That is a silent, ship-breaking failure.
 *
 *   This check turns that silent failure into a LOUD CI failure with the exact
 *   list of missing assets, BEFORE Tauri bundles the broken dist into an
 *   installer. It runs inside tauri.conf.json's beforeBuildCommand so it fires
 *   on every platform (ubuntu/windows/macos) right after the frontend build.
 *
 * USAGE:  node scripts/verify-bundle.cjs [distDir]
 *   distDir defaults to artifacts/craft-vita/dist/public
 */

const fs = require("fs");
const path = require("path");

const distDir =
  process.argv[2] ||
  path.resolve(__dirname, "..", "artifacts", "craft-vita", "dist", "public");

function fail(msg) {
  console.error(`\n[verify-bundle] ✗ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail(`dist directory not found: ${distDir}`);
}

// The desktop app loads these three HTML entries as separate windows. All three
// must exist and every asset they reference must be present on disk.
const requiredHtml = ["index.html", "launcher.html", "floating.html"];

const htmlFiles = requiredHtml.filter((f) =>
  fs.existsSync(path.join(distDir, f)),
);

const missingHtml = requiredHtml.filter((f) => !htmlFiles.includes(f));
if (missingHtml.length > 0) {
  fail(
    `missing HTML entry point(s) in the bundle: ${missingHtml.join(", ")}. ` +
      `The multi-page (Tauri) build did not run — launcher/mini windows will be blank. ` +
      `Ensure TAURI_ENV_PLATFORM is set so vite.config emits all entries.`,
  );
}

// Match src="..." and href="..." that point at built assets (/assets/*.js|css).
const ASSET_RE = /(?:src|href)\s*=\s*"([^"]*\/assets\/[^"]+\.(?:js|css|mjs))"/g;

let totalRefs = 0;
const missing = [];

for (const html of htmlFiles) {
  const full = path.join(distDir, html);
  const content = fs.readFileSync(full, "utf8");
  let m;
  while ((m = ASSET_RE.exec(content)) !== null) {
    totalRefs += 1;
    // Strip a leading slash so we resolve relative to distDir root.
    const rel = m[1].replace(/^\//, "");
    const assetPath = path.join(distDir, rel);
    if (!fs.existsSync(assetPath)) {
      missing.push({ html, ref: m[1] });
    }
  }
}

if (missing.length > 0) {
  console.error(
    `\n[verify-bundle] ✗ ${missing.length} referenced asset(s) are MISSING from the bundle:`,
  );
  for (const { html, ref } of missing) {
    console.error(`    ${html}  →  ${ref}`);
  }
  fail(
    `The bundle is inconsistent — shipping it would produce a blank app ` +
      `(JS served as text/html). Aborting before Tauri packages the installer.`,
  );
}

console.log(
  `[verify-bundle] ✓ bundle consistent — ${htmlFiles.length} HTML entries, ` +
    `${totalRefs} referenced assets all present.`,
);
