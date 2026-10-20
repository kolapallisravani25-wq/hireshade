# HireShade Runbook

Operational guide for install, configuration, running, verification, troubleshooting, and release.
Companion docs: `docs/CURRENT_STATE.md` (what works, proven), `docs/GAP_MATRIX.md` (requirement status), `docs/TEST_REPORT.md` (measurements), `docs/TARGET_VERIFIED.md` (competitor evidence).

---

## 1. Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Windows | 11 (10.0.22631) | Primary host; Windows capture exclusion needs Windows 10 2004+ |
| Node.js | 24.19.0 | CI/release also uses 24.x |
| pnpm | 11.17.0 | `corepack enable` or `npm i -g pnpm` |
| Rust | stable + MSVC target | Tauri shell only; `rustup target add x86_64-pc-windows-msvc` |
| WebView2 | Evergreen | Preinstalled on Windows 11 |
| Docker | 29.x | Local Postgres for integration tests |
| FFmpeg | 8.x | Fixture audio generation + stealth recordings (optional) |
| macOS | 13+ | Required for macOS runtime verification (not available on this host) |

---

## 2. Install

```powershell
git clone <repo> hireshade; cd hireshade
git checkout complete-build          # baseline snapshot: 627eb98, first repair commit: see git log
pnpm install --frozen-lockfile
```

`pnpm install` runs a preinstall guard that removes npm/yarn lockfiles and requires pnpm. Electron is installed under `artifacts/desktop-electron`; the Tauri toolchain is used through `@tauri-apps/cli`.

---

## 3. Environment

Copy templates; never commit real values (`.env` is gitignored):

```powershell
Copy-Item .env.example .env
Copy-Item artifacts/api-server/.env.example artifacts/api-server/.env
Copy-Item artifacts/craft-vita/.env.example artifacts/craft-vita/.env
```

| Variable | Service | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API | For sessions/billing; not for demo | Postgres DSN |
| `PORT` | API | no (default 5051) | HTTP port |
| `NODE_ENV` | API | yes in prod | `production` disables demo mode |
| `CLERK_SECRET_KEY` / `CLERK_ISSUER_DOMAIN` / `CLERK_AUTHORIZED_PARTIES` | API | real auth | Bearer JWT verification |
| `VITE_CLERK_PUBLISHABLE_KEY` | web/desktop | real auth | Clerk browser SDK |
| `VITE_BACKEND_URL`, `VITE_APP_WEB_URL`, `VITE_FRONTEND_URL` | web/desktop | yes | API/web origins |
| `OPENROUTER_API_KEY` | API | real AI | LLM gateway (multi-provider) |
| `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` / `DEEPGRAM_TEMP_KEY_TTL_SECONDS` | API | real ASR | Mints short-lived Deepgram tokens |
| `DESKTOP_TOKEN_SECRET` | API/desktop | real desktop | Desktop session token signing |
| `CORS_ORIGINS` | API | prod | Comma-separated allowlist (fails closed in prod) |
| `PUBLIC_BACKEND_URL`, `DESKTOP_RELEASES_REPO`, `GITHUB_RELEASES_TOKEN` | API | updater | Release proxy |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | API | existing billing | Razorpay |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*` | API | new billing | Stripe checkout/webhooks |
| `LOG_LEVEL` | API | no | pino level |
| `OPENROUTER_TIMEOUT_MS` / `OPENROUTER_STREAM_IDLE_MS` / `OPENROUTER_MAX_TOKENS` | API | no | Provider timeouts |
| `FREE_SESSIONS_PER_DAY` | API | no | Free-session quota |
| `PDF_CHROME_PATH`, `PDF_RENDER_TIMEOUT_MS` | API | export | Chrome path for PDF render |
| `UPLOADS_SIGNING_SECRET` | API | uploads | Signed URLs |
| `DEMO_MODE` / `VITE_DEMO_MODE` | API/web | demo only | Enables mock providers; refused when `NODE_ENV=production` |

### Local Postgres

A container named `hireshade-postgres` (Postgres 16) on port 5433 was used for validation:

```powershell
docker run -d --name hireshade-postgres -e POSTGRES_USER=hireshade_dev -e POSTGRES_PASSWORD=hireshade_dev -e POSTGRES_DB=hireshade_dev -p 5433:5432 postgres:16
$env:DATABASE_URL='postgresql://hireshade_dev:hireshade_dev@localhost:5433/hireshade_dev'
pnpm --dir lib/db run push-force
```

`artifacts/api-server/tests/setup/load-env.ts` loads `artifacts/api-server/.env` for Vitest, so `DATABASE_URL` there is enough for `pnpm --dir artifacts/api-server test`.

---

## 4. Run

### API

```powershell
pnpm --dir artifacts/api-server build
pnpm --dir artifacts/api-server start          # reads artifacts/api-server/.env
# or: artifacts\api-server\run-server.cmd
```

Health: `curl http://127.0.0.1:5051/api/healthz`.

### Web

```powershell
pnpm --dir artifacts/craft-vita dev            # http://localhost:5173
```

Without `VITE_CLERK_PUBLISHABLE_KEY` the app shell renders but the auth provider throws; use demo mode for a keyless run.

### Electron desktop shell

```powershell
node artifacts/desktop-electron/scripts/build-ui.js     # build once with relative asset base
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # CRITICAL
cd artifacts/desktop-electron
.\node_modules\.bin\electron.cmd .                     # production file:// mode
# HMR mode: pnpm --filter @workspace/desktop-electron dev
```

`ELECTRON_RUN_AS_NODE=1` (set by some agent hosts/IDE terminals) makes electron.exe run as plain Node and crashes at `app.requestSingleInstanceLock`. Scrub it in every launcher script.

### Tauri desktop app

```powershell
pnpm --dir artifacts/craft-vita tauri dev     # dev; requires Rust + MSVC
pnpm --dir artifacts/craft-vita tauri build   # packaging (see §9)
```

### Demo session (no keys)

GNU make is not bundled with Windows. Install it once (`choco install make`, needs an elevated shell) or use any portable GNU make; the demo itself has no make dependency:

```powershell
make demo
# equivalent, no make required:
node scripts/demo/run-demo.mjs demo
```

The orchestrator removes every provider key from the child environment and sets `DEMO_MODE=1`. It runs fixtures, the new-module tests, the pipeline latency proof and the Electron overlay e2e, then exits non-zero if any budget fails. On this validation host GNU make 4.4.1 came from a portable w64devkit because the Chocolatey install needed elevation.

Runs the fixture audio → VAD/endpointing → mock ASR → real question detector → real prompt assembly → mock LLM stream → overlay event pipeline, measures the latency budget, and writes `docs/evidence/demo/demo-latency.json`. It must be run with provider keys unset; `DEMO_MODE` refuses to activate when `NODE_ENV=production`.

---

## 5. Tests

```powershell
pnpm run typecheck                         # workspace TypeScript (~2 min)
pnpm --dir artifacts/craft-vita test       # frontend unit tests (~25 s)
pnpm --dir artifacts/api-server test       # API unit + integration (needs Postgres; serial only)
pnpm --dir artifacts/api-server test:unit  # API unit only, no DB
(cd artifacts/craft-vita/src-tauri; cargo check)
make demo                                  # keyless end-to-end + latency assertions
```

**Do not run the DB-backed API suite twice concurrently** — the integration tests truncate shared tables and use fixed users, so parallel runs collide with `credits_balance_user_id_unique`. Run one suite at a time, or give each environment its own database.

Classifier metrics regenerate from the labeled set (see `artifacts/craft-vita/src/features/session/detection/classifierMetrics.test.ts`); the report is `docs/evidence/classifier/report.md`.

---

## 6. Stealth verification

### Automated (Windows, this repo)

```powershell
node artifacts/desktop-electron/scripts/build-ui.js
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
cd artifacts/desktop-electron

# control: stealth OFF
$env:ELECTRON_STEALTH='0'
Start-Process .\node_modules\.bin\electron.cmd -ArgumentList '.'
powershell -File scripts/bring-to-front.ps1
powershell -File scripts/verify-capture-affinity.ps1     # expect 0x0
ffmpeg -y -f gdigrab -framerate 10 -i desktop -t 5 -c:v libx264 ..\..\docs\evidence\stealth\recording-stealth-off.mp4

# stealth ON
Get-Process electron | Stop-Process -Force
Remove-Item Env:ELECTRON_STEALTH
Start-Process .\node_modules\.bin\electron.cmd -ArgumentList '.'
powershell -File scripts/bring-to-front.ps1
powershell -File scripts/verify-capture-affinity.ps1     # expect 0x11
powershell -File scripts/capture-stealth-proof.ps1       # affinity + rectangle captures + JSON
ffmpeg -y -f gdigrab -framerate 10 -i desktop -t 5 -c:v libx264 ..\..\docs\evidence\stealth\recording-stealth-on.mp4
```

Expected: with stealth ON the windows are absent from both recordings and rectangle captures while `GetWindowDisplayAffinity` is `0x11`; with stealth OFF they are plainly visible. Stored proof: `docs/evidence/stealth/README.md`.

### Manual per-platform matrix

Join each call from a second device (or record locally with a second capture tool), share the **entire screen**, and inspect the remote view/recording. The overlay must be invisible; the physical screen must still show it.

| Platform | What to do | Expected |
|---|---|---|
| Zoom (desktop) | Share entire screen, start local recording | Overlay absent from shared view + recording; still visible locally |
| Microsoft Teams (desktop) | Share entire screen | Absent |
| Google Meet (Chrome) | Share entire screen; also test "share a tab" | Absent from screen share; tab-share without the overlay tab unaffected |
| Webex (desktop) | Share entire screen | Absent |
| Lark / Feishu | Share entire screen | Absent |
| Amazon Chime | Share entire screen | Absent |
| CoderPad | Screen share + browser video | Absent |
| HackerRank | Screen share / proctored test view | Absent from capture; cursor/process still observable by kernel-level proctors |

macOS (when hardware is available):
1. `pnpm --dir artifacts/craft-vita tauri build` and install the app; confirm `LSUIElement`/dock behavior from `Info.plist` (target uses a dock re-hide poll; prefer `LSUIElement`).
2. Confirm `contentProtected:true` windows are invisible to QuickTime `File → New Screen Recording` and to `screencapture -v`.
3. Grant Screen Recording + Microphone permissions (macOS 13+); system-audio capture uses ScreenCaptureKit/Core Audio tap, no BlackHole required.
4. Save recording under `docs/evidence/stealth/macos/`. **Currently DEFERRED on this Windows host (GAP_MATRIX G-007) — do not claim it without this evidence.**

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `app.requestSingleInstanceLock is not a function` / Electron runs as Node | `ELECTRON_RUN_AS_NODE=1` | `Remove-Item Env:ELECTRON_RUN_AS_NODE` before launching |
| Electron windows blank / `file://` assets 404 | UI built without relative base | `node artifacts/desktop-electron/scripts/build-ui.js` (sets `ELECTRON_BASE`/`--base ./`) |
| `Missing Publishable Key` | no `VITE_CLERK_PUBLISHABLE_KEY` | set it, or use `VITE_DEMO_MODE=1` |
| API 503 "Deepgram is not configured" | no `DEEPGRAM_API_KEY` | set key, or demo mode |
| API AI errors / `OPENROUTER_API_KEY not set` | no key | set key, or demo mode |
| `DATABASE_URL must be set` in tests | no `.env` / env var | create `artifacts/api-server/.env` or export it |
| Integration suite duplicate-key failures | two suites ran concurrently | run serially |
| API test command exits 0 with no output | package had no test script (fixed) | use `pnpm --dir artifacts/api-server test`; scripts now exist |
| Port 5173/5051/5433 in use | another dev server/container | stop it or override `PORT`/`--port`/DB port |
| `cargo check` seems hung | first build compiles ~550 crates (8+ min) | let it finish; use a background job |
| Tauri build updater signing fails | no `TAURI_SIGNING_PRIVATE_KEY` | configure signing (see `docs/Desktop-Release-Runbook.md`) |
| Overlay visible in screen share | private mode off / window recreated | ensure `setContentProtection(true)` re-applied on show; check affinity `0x11` |
| Overlay behind fullscreen app | always-on-top lost | Windows: `setAlwaysOnTop(true,"screen-saver",1)` re-assert loop + disable native occlusion; macOS: `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` |
| Click-through stuck on | hit-test state left true | move cursor over a `[data-transparent='false']` region; verify `mousemove` listener + IPC |
| `vitest` hook timeouts under load | CPU saturation during parallel agent work | rerun when idle; DB suite is not parallel-safe |

---

## 8. Security

- **Rotate the Supabase PAT** that was found at `artifacts/craft-vita/src-tauri/src/db access token.txt` on 2026-10-20 (SHA-256 `79AFD7DE…F15D`). The file was never committed and has been deleted from disk; treat the token as compromised and revoke it in the Supabase dashboard.
- Never commit `.env` files; `.env.example` holds placeholders only.
- Desktop refresh credentials must move to OS secure storage (GAP G-031); the legacy loopback callback puts a bearer token in the URL query — do not enable that flow in production until fixed.
- CSP is set in `tauri.conf.json`; verify it includes only required origins (Clerk, API, payments, `wss://` ASR).
- Run a secret scan before release: `git grep -nE '(sk_live|pk_live|SUPABASE|sbp_|OPENROUTER_API_KEY=)' -- . ':!*.example'`.

---

## 9. Release

1. `pnpm run typecheck && pnpm --dir artifacts/craft-vita test && pnpm --dir artifacts/api-server test`
2. `cargo test` in `artifacts/craft-vita/src-tauri`.
3. `pnpm --dir artifacts/craft-vita tauri build` with signing secrets configured (`TAURI_SIGNING_PRIVATE_KEY`, password). Updater archives must be signed (`.msi.zip`/`.nsis.zip`, `.app.tar.gz`).
4. Verify version consistency across `package.json`, `tauri.conf.json`, `Cargo.toml`, and the produced artifact.
5. Keep updater enabled only with a matching public key; test an actual signed update on a disposable machine.
6. macOS release requires an Apple Developer ID + notarization; **not performed on this host**.

---

## 10. Evidence index

| Path | What it contains |
|---|---|
| `docs/evidence/stealth/README.md` | A/B Windows capture-exclusion proof + recordings + hashes |
| `docs/evidence/classifier/` | labeled-set metrics, confusion matrix, per-category breakdown |
| `docs/evidence/demo/` | keyless demo latency + transcript artifacts |
| `docs/evidence/01..10*` | baseline typecheck/build/test/cargo/dev-server logs |
| `docs/evidence/_inventory.json` | machine-readable file classification |
| `docs/TEST_REPORT.md` | aggregated test counts and measured latencies |
