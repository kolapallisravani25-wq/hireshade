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

## Appendix: the `desktop-release.yml` workflow

This file must live at `.github/workflows/desktop-release.yml`. It could not be
committed by the automation token (which lacks GitHub's `workflow` scope). Add it
yourself: either create the file in the GitHub web UI (Add file → Create new
file), or push it with a PAT that has `workflow` scope. Contents:

```yaml
name: Desktop Release

# Publishes signed desktop installers to a GitHub Release and generates the
# updater manifest (latest.json) that BOTH the in-app auto-updater and the
# web "Download Desktop App" button read from:
#   https://github.com/<owner>/<repo>/releases/latest/download/latest.json
#
# This is the piece the old `desktop-build.yml` never had: that workflow only
# uploaded to ephemeral GitHub Actions artifacts, so nothing ever populated a
# public download URL or the updater endpoint. Keep desktop-build.yml as the
# per-push CI check; use THIS workflow to actually ship a release.
#
# Trigger: push a version tag (e.g. `v0.0.11`) OR run manually. Tagging is
# deliberate — you don't want every develop push cutting a public release.
#
# REQUIRED repository secrets (see docs/Desktop-Release-Runbook.md):
#   TAURI_SIGNING_PRIVATE_KEY           - updater private key (from `tauri signer generate`)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  - its password (may be empty string)
#   plus the existing VITE_* build secrets already used by desktop-build.yml.
#
# The updater PUBLIC key must be pasted into src-tauri/tauri.conf.json
# ("plugins.updater.pubkey"), replacing REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY.
# Until both the secret and the pubkey are set, this workflow will fail fast
# (see the "Verify signing configuration" step) rather than publish an
# unsigned release the updater can never accept.

on:
  workflow_dispatch:
  push:
    tags:
      - "v*"

permissions:
  contents: write

defaults:
  run:
    shell: bash

jobs:
  publish:
    name: Publish desktop (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            args: "--target aarch64-apple-darwin"
          - os: macos-latest
            args: "--target x86_64-apple-darwin"
          - os: ubuntu-latest
            args: ""
          - os: windows-latest
            args: ""

    env:
      CI: true
      NODE_ENV: production
      VITE_CLERK_PUBLISHABLE_KEY: ${{ secrets.VITE_CLERK_PUBLISHABLE_KEY }}
      VITE_DEEPGRAM_API_KEY: ${{ secrets.VITE_DEEPGRAM_API_KEY }}
      VITE_RAZORPAY_KEY_ID: ${{ secrets.VITE_RAZORPAY_KEY_ID }}
      VITE_FRONTEND_URL: ${{ secrets.VITE_FRONTEND_URL }}
      VITE_BACKEND_URL: ${{ secrets.VITE_BACKEND_URL }}
      VITE_CLERK_SIGN_IN_URL: ${{ secrets.VITE_CLERK_SIGN_IN_URL }}
      VITE_CLERK_SIGN_UP_URL: ${{ secrets.VITE_CLERK_SIGN_UP_URL }}
      VITE_CLERK_AFTER_SIGN_IN_URL: ${{ secrets.VITE_CLERK_AFTER_SIGN_IN_URL }}
      VITE_CLERK_AFTER_SIGN_UP_URL: ${{ secrets.VITE_CLERK_AFTER_SIGN_UP_URL }}
      VITE_INACTIVITY_TIMEOUT_MS: ${{ secrets.VITE_INACTIVITY_TIMEOUT_MS }}
      VITE_INACTIVITY_WARNING_MS: ${{ secrets.VITE_INACTIVITY_WARNING_MS }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Verify signing configuration
        run: |
          if [ -z "${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}" ]; then
            echo "::error::TAURI_SIGNING_PRIVATE_KEY secret is not set. The updater requires signed artifacts — generate a keypair with 'pnpm tauri signer generate' and add the private key as a repo secret. See docs/Desktop-Release-Runbook.md." >&2
            exit 1
          fi
          if grep -q "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY" artifacts/craft-vita/src-tauri/tauri.conf.json; then
            echo "::error::The updater public key placeholder is still in tauri.conf.json. Paste the public key from your keypair into plugins.updater.pubkey before releasing. See docs/Desktop-Release-Runbook.md." >&2
            exit 1
          fi

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.os == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux Tauri dependencies
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            pkg-config \
            libssl-dev

      - name: Install dependencies
        run: |
          pnpm store prune || true
          pnpm install --no-frozen-lockfile --config.optional=true

      - name: Apply CI Tauri compatibility patch
        run: bash scripts/ci-patch-tauri-build.sh

      - name: Typecheck desktop package
        run: pnpm --filter @workspace/craft-vita typecheck

      - name: Build & publish desktop release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: artifacts/craft-vita
          tagName: ${{ github.ref_type == 'tag' && github.ref_name || format('v{0}', github.run_number) }}
          releaseName: "HireShade v__VERSION__"
          releaseBody: "See the assets below to download and install this version. Installed apps update automatically."
          releaseDraft: true
          prerelease: false
          includeUpdaterJson: true
          updaterJsonPreferNsis: true
          args: ${{ matrix.args }}
```
