# HireShade Current State (evidence-paired)

Snapshot: 2026-10-20 ~19:15 IST | branch `complete-build` | HEAD `627eb98` | working tree clean + untracked `docs/raw/*`
Every claim below is paired with the exact command/output that proves it, or marked UNVERIFIED with the reason.
Raw logs: `docs/evidence/`. Full file inventory/classification: `docs/AUDIT_INVENTORY.md`. Failures verbatim: `docs/BASELINE_FAILURES.md`.

## 1. What works today (proved by command)

| Capability | Proof command | Exact result |
|---|---|---|
| Workspace typecheck | `pnpm run typecheck` | exit 0, 105.1 s; api-server + craft-vita + mockup-sandbox "Done", `tsc --build` libs OK (`docs/evidence/02-typecheck.txt`) |
| Frontend unit tests | `pnpm --dir artifacts/craft-vita test` | exit 0, 25.1 s; **16 files / 158 tests passed** (vitest 4.1.9) (`docs/evidence/03-frontend-test.txt`) |
| Frontend production build (web) | `pnpm --dir artifacts/craft-vita build` | exit 0, 340.4 s; `vite v7.3.3`, 5,427 modules, `built in 5m 21s`, output `dist/public` (`docs/evidence/07-frontend-build.txt`) |
| Rust/Tauri compile check | `cargo check --message-format short` in `artifacts/craft-vita/src-tauri` | exit 0, 518.5 s, `Finished dev profile in 8m 37s`, 9 dead-code warnings (`docs/evidence/06-cargo-check.txt`) |
| Dev server + web shell | `pnpm dev` (craft-vita) then HTTP GET | ready 6.8 s; `GET /` 200 / 1,035 B; `GET /launcher.html` 200 / 1,453 B; `GET /src/main.tsx` 200 / 10,711 B (`docs/evidence/08-vite-dev-server.txt`) |
| API unit tests | `pnpm --dir artifacts/api-server exec vitest run` | 18 of 19 files pass, **100/100 tests pass**; only `sessions.integration.test.ts` fails to load (no `DATABASE_URL`) (`docs/evidence/05-api-vitest.txt`) |

## 2. What does not work / is not wired (proved or compiler-proved)

| Item | Proof | Assessment |
|---|---|---|
| API integration tests | `pnpm --dir artifacts/api-server exec vitest run` exit **1**: `Error: DATABASE_URL must be set. Did you forget to provision a database?` at `lib/db/src/index.ts:8` via `tests/sessions.integration.test.ts:84` | **UNVERIFIED** - needs Postgres; no DB provisioned in this environment |
| API test entrypoint | `pnpm --dir artifacts/api-server test` exit **0** with empty output; `artifacts/api-server/package.json:7-12` has no `test` script | **BROKEN (false green)** - CI/agents will think API tests ran |
| Stealth focus-bypass | `cargo check` warnings: `focus_bypass.rs:18 install_focus_bypass is never used`, `:34 uninstall... never used`, `:8 event_hook never used`; callback body empty (`focus_bypass.rs:8-16`); `mod focus_bypass;` at `lib.rs:2` | **BROKEN** - module compiles but is never installed; no focus blocking exists |
| Screen-capture exclusion helper | `cargo check` warnings: `screen_protect.rs:7 set_screen_protection is never used`, `:18 apply_on_create never used`; not registered in `invoke_handler` | **BROKEN** - dead code; capture protection depends only on Tauri `contentProtected` config (`tauri.conf.json:32,52`) + `toggle_content_protection` (`lib.rs:545`) |
| Cursor hiding | `cargo check` warnings: `cursor.rs:5/10 hide_system_cursor/show_system_cursor never used`; `mod cursor;` at `lib.rs:3` | **BROKEN** - commands never registered |
| Session runtime (live interview) | Requires Clerk + Postgres + Deepgram + OpenRouter keys; none configured here. No `.env` for api-server (`artifacts/api-server/.env.example` only), and `src/main.tsx:15-19` throws `Missing Publishable Key` without `VITE_CLERK_PUBLISHABLE_KEY` | **UNVERIFIED** - cannot start an end-to-end session in this environment |
| Desktop app runtime / packaging | `cargo check` only; no `pnpm tauri build` run (would need signing key; `tauri.conf.json:74 createUpdaterArtifacts:false`, `:91-95 updater pubkey`). CSP still `null` (`tauri.conf.json:61`) | **UNVERIFIED / incomplete** |
| Audio capture | Rust impls exist for macOS (`lib.rs:834`, ScreenCaptureKit) and Windows (`lib.rs:1103,1284`, WASAPI loopback); Linux stubs return empty (`lib.rs:1414-1436`) | **Code present, runtime UNVERIFIED** (no audio device/session run) |
| Overlay unified runtime | `src/overlay/flags.ts:23-51` - all 5 migration flags `false`; `OverlayRoot`/layers unreachable in normal builds | **Not active** (legacy mini+launcher windows are what run) |
| Secret material on disk | `artifacts/craft-vita/src-tauri/src/db access token.txt` (69 B, untracked + gitignored) reportedly a live Supabase PAT | **ACTION REQUIRED: rotate + delete** (value not copied) |

## 3. A4 run (Vite dev server) - exact record

Start: `cd artifacts/craft-vita; pnpm dev` -> `vite --config vite.config.ts --host 0.0.0.0 --port 5173`
Server log (verbatim): `VITE v7.3.3  ready in 6813 ms`, `➜  Local:   http://localhost:5173/`, `[vite] (client) Re-optimizing dependencies because vite config has changed`.

Probes (`Invoke-WebRequest -UseBasicParsing`):

- `GET http://127.0.0.1:5173/` -> **200**, `text/html`, 1,035 bytes. Body starts with the react-refresh preamble, contains `<div id="root"></div>`, `/src/main.tsx`, `<title>HireShade</title>`.
- `GET /launcher.html` -> **200**, 1,453 bytes (loads `/src/pages/Launcher/WidgetApp.tsx`).
- `GET /src/main.tsx` -> **200**, 10,711 bytes, **12.9 s** cold (dependency optimization); a first 15 s-timeout probe failed before optimization finished.

Not proved: browser render/hydration, console errors, network calls. The HTML shell is served but the React app cannot boot without `VITE_CLERK_PUBLISHABLE_KEY` (`src/main.tsx:15-19`).

## 4. "No keys = mock mode" assessment: **NO mock mode exists**

| Dependency | Hard requirement evidence |
|---|---|
| OpenRouter | `artifacts/api-server/src/lib/openrouter.ts:35-37`: without `OPENROUTER_API_KEY` it throws `OPENROUTER_API_KEY not set. AI features are unavailable.`; `sessions.ts:1301` logs `ai-answer unavailable: OPENROUTER_API_KEY is not configured` |
| Deepgram | `artifacts/api-server/src/routes/auth.ts:89-95`: `/auth/deepgram-token` returns **503** `Deepgram is not configured on the server` when `DEEPGRAM_API_KEY` is unset; no client-side fallback key (removed deliberately) |
| Clerk | `artifacts/craft-vita/src/main.tsx:15-19` throws `Missing Publishable Key` when `VITE_CLERK_PUBLISHABLE_KEY` is unset; `main.tsx:26` wraps the app in `ClerkProvider`. `api-server` health check warns on `CLERK_SECRET_KEY` absence (`src/index.ts:13-17`) |
| Database | `lib/db/src/index.ts:7-9` throws at import when `DATABASE_URL` is unset |
| Mock/demo adapters | grep for `mock|MOCK_|demo mode|DEMO_` over `artifacts/api-server/src` -> **0 matches**; only test-local `vi.mock(...)` in `*.test.ts` files and a resume-editor helper `mockAIEnhance` (`src/pages/Resume/ResumeEditor/types.ts:102`) |
| Makefile/demo script | none at repo root (`Makefile*` absent); `scripts/` has only `verify-bundle.cjs`, `sync-version-from-tag.mjs` |

Conclusion: a full mock session **cannot** run with zero API keys. The closest thing is the free-session quota flag (`sessions.ts:234-245`, `FREE_SESSIONS_PER_DAY`), which still requires Clerk + Postgres + Deepgram + OpenRouter. What is missing: a mock ASR transport, a stub LLM provider, a no-auth local mode, and a seed/demo script.

## 5. Command evidence index

| File | Content |
|---|---|
| `docs/evidence/01-environment.txt` | initial git/node/pnpm/cargo snapshot (pre-switch) |
| `docs/evidence/01b-environment-after-branch-switch.txt` | git reflog + branch/HEAD after switch to `complete-build` |
| `docs/evidence/02-typecheck.txt` / `-exit.txt` | typecheck output / `EXITCODE=0 DURATION_SEC=105.1` |
| `docs/evidence/03-frontend-test.txt` / `-exit.txt` | 16 files, 158 tests / `EXITCODE=0 DURATION_SEC=25.1` |
| `docs/evidence/04-api-test-script.txt` | `pnpm test` no-op (exit 0, empty output) |
| `docs/evidence/05-api-vitest.txt` / `-exit.txt` | 100/100 pass, 1 suite fail (DATABASE_URL) / `VITEST_EXITCODE=1` |
| `docs/evidence/06-cargo-check.txt` / `-exit.txt` | cargo check + 9 warnings / `EXITCODE=0 DURATION_SEC=518.5` |
| `docs/evidence/07-frontend-build.txt` / `-exit.txt` | vite build log + warnings / `EXITCODE=0 DURATION_SEC=340.4` |
| `docs/evidence/08-vite-dev-server.txt` | dev server log |
| `docs/evidence/_inventory.json` + `_scripts/inventory.mjs` | machine-generated file/classification data |

## 7. Lead corrections and new evidence (2026-10-20 19:10 IST)

The audit's environment sweep ran before the API package env was inspected. Three corrections, each with fresh evidence:

| Audit claim | Corrected fact | Evidence |
|---|---|---|
| "no DB provisioned in this environment" | A Postgres 16 container `hireshade-postgres` is running on host port 5433 with user/db `hireshade_dev`; `artifacts/api-server/.env` (gitignored) points at it; all 17 app tables exist | `docker ps`; `docker exec hireshade-postgres psql -U hireshade_dev -d hireshade_dev -c '\dt'` |
| integration suite blocked by DATABASE_URL | With `DATABASE_URL` present the suite passes **63/63 in 42.5 s**. It is not safe to run twice concurrently (fixed `user-a`/`user-b` + shared truncation), so runs are serial | `docs/evidence/09-api-integration-with-db.txt`; `docs/evidence/10-api-full-suite.txt` |
| `pnpm ... test` is a false-green no-op | Fixed: `test` / `test:unit` / `test:integration` scripts added, plus a Vitest setup file that loads the package-local `.env` when `DATABASE_URL` is absent | `artifacts/api-server/package.json`; `artifacts/api-server/tests/setup/load-env.ts` |

Additional runtime evidence produced by the Lead:

| Capability | Result | Evidence |
|---|---|---|
| Electron shell launches and renders real UI | Both windows load `floating.html` / `launcher.html`; CDP DOM text shows the live overlay ("Claude Haiku 4.5 / Waiting for session...") and launcher ("HireShade / Login...") | `docs/evidence/stealth/cdp-*.png`; `artifacts/desktop-electron/scripts/cdp-inspect.mjs` |
| Windows screen-capture exclusion | Windows report `GetWindowDisplayAffinity = 0x11 (WDA_EXCLUDEFROMCAPTURE)`; screen capture of their exact rectangles contains **no** HireShade pixels while a stealth-OFF control capture clearly shows the UI; CDP proves the DOM renders in both cases | `docs/evidence/stealth/capture-proof.json`, `window-region-*-190240.png` (ON) vs `*-190216.png` (OFF) |
| macOS capture exclusion | **DEFERRED** — no macOS host available. Code/config paths documented; runtime claim not made | `docs/GAP_MATRIX.md` G-007; `docs/RUNBOOK.md` |
| Leaked secret | `artifacts/craft-vita/src-tauri/src/db access token.txt` (Supabase PAT-like value, SHA-256 `79AFD7DE…F15D`) was gitignored, never committed, and deleted from disk; rotation still required | `git log --all -- <file>` (no history); `docs/RUNBOOK.md` §Rotate |

A4 runtime note: the Vite dev server starts and serves the shell, but the React app cannot hydrate without `VITE_CLERK_PUBLISHABLE_KEY` (`src/main.tsx:15-19`). The Electron shell renders because it loads a built bundle and the app tolerates missing auth config at render time (login CTA shown).
