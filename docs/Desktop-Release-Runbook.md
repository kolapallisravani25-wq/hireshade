# Desktop Release & Auto-Update Runbook

This document covers the one-time setup and the per-release process for shipping
the HireShade desktop app so that:

1. The web **"Download Desktop App"** button serves a real, current installer.
2. Installed apps **auto-update** to new versions.

## Why this exists

The desktop distribution was scaffolded but never connected:

- `desktop-build.yml` only uploaded builds to **ephemeral GitHub Actions
  artifacts** (auth-gated, expire in 90 days) — nothing populated a public
  download URL.
- The download button fetched a **Cloudflare R2 `latest.json`** that no
  workflow ever created.
- The Tauri updater plugin was compiled in and the frontend `lib/updater.ts`
  was complete, but `tauri.conf.json` had `endpoints: []` and `pubkey: ""`, and
  `bundle.createUpdaterArtifacts` was unset — so no signatures were produced and
  the updater had nowhere to look.

The new `desktop-release.yml` workflow + the `tauri.conf.json` changes close all
three gaps. It publishes to a **GitHub Release**, and both the button and the
updater read the same `latest.json` from:

```
https://github.com/kolapallisravani25-wq/hireshade/releases/latest/download/latest.json
```

## One-time setup (required before the first release)

### 1. Generate the updater signing keypair

On your machine, in `artifacts/craft-vita`:

```bash
pnpm tauri signer generate -w ~/.tauri/hireshade-updater.key
```

This prints/produces:

- a **private key** (the file, plus its base64 content) — **NEVER commit or
  share this**. If lost, you can no longer push updates to existing installs.
- a **password** you chose (may be empty).
- a **public key** (base64 string).

### 2. Add repository secrets

In GitHub → repo → Settings → Secrets and variables → Actions, add:

- `TAURI_SIGNING_PRIVATE_KEY` — the **contents** of the private key file (base64).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password (set an empty secret if none).

(The `VITE_*` secrets are already used by `desktop-build.yml` and are reused here.)

### 3. Paste the public key into config

In `artifacts/craft-vita/src-tauri/tauri.conf.json`, replace the placeholder:

```json
"updater": {
  "endpoints": [
    "https://github.com/kolapallisravani25-wq/hireshade/releases/latest/download/latest.json"
  ],
  "pubkey": "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY"
}
```

with the real public key. Commit this change (the public key is safe to commit).

> The release workflow **fails fast** if either the secret is missing or the
> placeholder is still present, so you can't accidentally publish an unsigned
> release the updater would reject.

### 4. (Optional but recommended) OS code signing

The steps above cover **updater** signing (required). They do **not** cover OS
code signing / notarization:

- **macOS**: without an Apple Developer cert, Apple-silicon builds downloaded
  from the web may be flagged "damaged". Configure an ad-hoc identity or add
  Apple signing secrets (`APPLE_CERTIFICATE`, `APPLE_ID`, etc.) to the
  `tauri-action` env. See the Tauri macOS code-signing guide.
- **Windows**: without a code-signing cert, users see a SmartScreen warning.
  Add Windows signing secrets when you have a cert.

These are cost/vendor decisions; the app ships and updates without them, just
with OS trust prompts.

## Per-release process

1. Bump the version in **all three** files so they match:
   - `artifacts/craft-vita/src-tauri/tauri.conf.json` (`version`)
   - `artifacts/craft-vita/src-tauri/Cargo.toml` (`package.version`)
   - `artifacts/craft-vita/package.json` (`version`)
2. Commit to `develop`.
3. Tag and push:
   ```bash
   git tag v0.0.11
   git push origin v0.0.11
   ```
   (Or run **Desktop Release** manually via workflow_dispatch.)
4. The workflow builds macOS (arm64 + x64), Windows, and Linux, signs the
   updater artifacts, creates a **draft** GitHub Release, and uploads the
   installers + `latest.json`.
5. Review the draft release, then **publish** it. Publishing makes
   `releases/latest/download/latest.json` resolve — the button and updater go
   live for that version.

## Verifying it works

- **Download button**: on the web dashboard, click Download for each platform;
  it should open the correct installer asset from the release.
- **Auto-update**: install an older version, publish a newer release, reopen the
  app — `lib/updater.ts` `check()` should detect it and offer to update.

## Notes

- The release is created as a **draft** so a broken build never auto-goes-live.
- `updaterJsonPreferNsis: true` makes the Windows updater use the NSIS
  (`setup.exe`) bundle.
- Keep `desktop-build.yml` as the per-push CI check (it still runs on develop);
  use `desktop-release.yml` only to cut releases.
