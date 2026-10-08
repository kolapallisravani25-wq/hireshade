#!/usr/bin/env node
/**
 * sync-version-from-tag.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Stamps the desktop app version to match the release tag, at build time.
 *
 * WHY THIS EXISTS:
 *   The Tauri auto-updater decides "is there a newer version?" by comparing the
 *   RUNNING app's version (baked from tauri.conf.json/Cargo.toml at build) against
 *   the version in the update manifest (derived from the release tag). If those
 *   two ever disagree, the updater misbehaves — most visibly the "keeps asking to
 *   install" loop we hit when every build was stamped 0.0.10 while releases were
 *   tagged v0.1.x. Hand-editing the version every release is fragile and already
 *   drifted once. This makes drift IMPOSSIBLE: on a tagged/publishing build, the
 *   version is written straight from the tag, so app version == release tag,
 *   always.
 *
 * BEHAVIOUR:
 *   - Resolves the version from (in priority order): the RELEASE_TAG env var, then
 *     GITHUB_REF_NAME when the ref is a tag. Strips a leading "v".
 *   - If no tag is available (ordinary branch push / local dev), it does NOTHING
 *     and leaves the committed version untouched — those builds aren't published.
 *   - Only accepts a strict semver x.y.z (optionally with a -prerelease suffix);
 *     anything else is ignored so a weird ref can't write a garbage version.
 *   - Writes the version into tauri.conf.json and Cargo.toml (and Cargo.lock's
 *     own package entry) so the compiled binary reports the right getVersion().
 *
 * USAGE:  node scripts/sync-version-from-tag.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const tauriConfPath = resolve(root, "artifacts/craft-vita/src-tauri/tauri.conf.json");
const cargoTomlPath = resolve(root, "artifacts/craft-vita/src-tauri/Cargo.toml");
const cargoLockPath = resolve(root, "artifacts/craft-vita/src-tauri/Cargo.lock");

function resolveTagVersion() {
  const releaseTag = (process.env.RELEASE_TAG ?? "").trim();
  const refType = (process.env.GITHUB_REF_TYPE ?? "").trim();
  const refName = (process.env.GITHUB_REF_NAME ?? "").trim();

  let raw = "";
  if (releaseTag) raw = releaseTag;
  else if (refType === "tag" && refName) raw = refName;

  if (!raw) return null;

  const version = raw.replace(/^v/, "").trim();
  // Strict semver: x.y.z with optional -prerelease / +build metadata.
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    console.warn(
      `[sync-version] tag "${raw}" does not look like a semver version — leaving the committed version unchanged.`,
    );
    return null;
  }
  return version;
}

const version = resolveTagVersion();
if (!version) {
  console.log(
    "[sync-version] no release tag in the environment — using the version already in the repo (this build is not a published release).",
  );
  process.exit(0);
}

// tauri.conf.json — top-level "version"
{
  const conf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  const prev = conf.version;
  conf.version = version;
  writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + "\n");
  console.log(`[sync-version] tauri.conf.json: ${prev} -> ${version}`);
}

// Cargo.toml — the [package] version = "x.y.z" line
{
  const toml = readFileSync(cargoTomlPath, "utf8");
  const next = toml.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  writeFileSync(cargoTomlPath, next);
  console.log(`[sync-version] Cargo.toml version set to ${version}`);
}

// Cargo.lock — the hireshade package's own version entry (keeps the lock consistent)
if (existsSync(cargoLockPath)) {
  const lock = readFileSync(cargoLockPath, "utf8");
  const next = lock.replace(
    /(name = "hireshade"\nversion = )"[^"]*"/,
    `$1"${version}"`,
  );
  writeFileSync(cargoLockPath, next);
  console.log(`[sync-version] Cargo.lock hireshade version set to ${version}`);
}

console.log(`[sync-version] ✓ app version stamped to ${version} (== release tag)`);
