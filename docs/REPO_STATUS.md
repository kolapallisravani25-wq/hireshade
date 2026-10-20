# HireShade Repository Status (baseline audit)

Audit date: 2026-10-20 ~19:20 IST | branch `complete-build` | HEAD `627eb98` | node v24.19.0 | pnpm 12.4.2 | cargo 1.99.0

Scope: read-only baseline. No source files modified. Written files: `docs/REPO_STATUS.md`, `docs/AUDIT_INVENTORY.md`, `docs/BASELINE_FAILURES.md`, `docs/CURRENT_STATE.md`, `docs/evidence/**`.
Companion docs: `docs/AUDIT_INVENTORY.md` (per-file COMPLETE/PARTIAL/STUB/BROKEN/ORPHANED inventory), `docs/BASELINE_FAILURES.md` (verbatim failures + command evidence), `docs/CURRENT_STATE.md` (works/does-not-work + A4 dev-server run).

## 1. Command results

| Command | Exit | Duration | Counts / result |
|---|---:|---:|---|
| `pnpm run typecheck` | 0 | 105.1 s | 3 artifact packages + lib project refs typecheck clean |
| `pnpm --dir artifacts/craft-vita test` | 0 | 25.1 s | **16 test files, 158 tests, 100% pass** |
| `pnpm --dir artifacts/api-server test` | 0 | 3.2 s | **no-op** - no `test` script; empty output (false green) |
| `pnpm --dir artifacts/api-server exec vitest run` | **1** | 157.1 s | **100/100 tests pass**, 18/19 files pass; `sessions.integration.test.ts` fails to load (no `DATABASE_URL`) |
| `pnpm --dir artifacts/craft-vita build` | 0 | 340.4 s | `vite v7.3.3`, 5,427 modules, `built in 5m 21s`; 3 warning groups; `page` chunk 4,068 kB |
| `cargo check --message-format short` (src-tauri) | 0 | 518.5 s | `Finished dev profile in 8m 37s`; **9 dead-code warnings** |
| `pnpm dev` + HTTP probes (A4 run) | n/a | ready 6.8 s | `GET /` 200 (1,035 B), `GET /launcher.html` 200, `GET /src/main.tsx` 200 (10,711 B, 12.9 s cold) |

Net: compile/typecheck/unit-test baseline is **green**; the only reds are the DB-less API integration suite and the silent API `test` script. Neither the desktop binary nor any authenticated runtime path was executed.

## 2. Feature matrix (mission) - DONE / PARTIAL / MISSING

| # | Feature | Status | Evidence (file:line) | Notes |
|---|---|---|---|---|
| 1 | Native system-audio capture (macOS/Windows) | DONE (code) | `src-tauri/src/lib.rs:834` (macOS ScreenCaptureKit), `:1103` (Windows cpal mic), `:1284` (Windows WASAPI loopback); `deepgram.rs:1-88` transport | Linux capture is a stub: `lib.rs:1414-1436` returns empty. Runtime not executed. |
| 2 | Browser audio capture | DONE | `src/hooks/useScreenShare.ts:61` (`getDisplayMedia({audio})`), `src/hooks/useDeepgram.ts` (24 KB WS client), `src/features/session/audio/*` | Web path is the fallback when `getCaptureRuntime()==="browser"` (`src/capture/runtime.ts:20-34`, itself orphaned/dead). |
| 3 | ASR / transcription adapters | PARTIAL | Deepgram only: `src-tauri/src/deepgram.rs`, `src-tauri/src/lib.rs:1461,1638,1786,1936`, `routes/auth.ts:85` (minted key) | No Whisper/Speechmatics/AssemblyAI adapter. Requires server `DEEPGRAM_API_KEY`; 503 otherwise (`auth.ts:89-95`). |
| 4 | Question detection | DONE | `src/features/session/detection/activeQuestionDetector.ts:288`, `src/lib/utterance-completeness.ts:77`, `src/lib/transcript-stabilizer.ts`, `src/lib/semantic-classifier.ts`, `src/lib/grouped-question-engine.ts` | Heuristic pipeline with 37+13+4 unit tests; no ML model. |
| 5 | Auto-answer generation | DONE (code) | `routes/sessions.ts:1073` (`POST /:id/ai-answer`), `:1314` (stream), `src/lib/generation-pipeline.ts`, `src/hooks/useAIChat.ts` | Requires `OPENROUTER_API_KEY` (`lib/openrouter.ts:35-37`). Default model `anthropic/claude-haiku-4.5` (`sessions.ts:205`). |
| 6 | Session lifecycle | DONE | `routes/sessions.ts:191` create, `:382` activate, `:507` heartbeat, `:620` deactivate, `:724` save-message, `:829` transcript patch | Single-live-session invariant `sessions.ts:220-226`; free quota `:234-245`. |
| 7 | Stealth overlay (screen-share hiding) | PARTIAL | `tauri.conf.json:32-37` (mini: contentProtected/skipTaskbar/alwaysOnTop/visibleOnAllWorkspaces), `:52-57` (launcher), `lib.rs:545-550` (`set_content_protected`), `lib.rs:253-257,312-316` | `focus_bypass.rs`, `screen_protect.rs`, `cursor.rs` are **dead code** (9 cargo warnings; `mod` at `lib.rs:1-3` but never invoked). CSP is `null` (`tauri.conf.json:61`). |
| 8 | Resume builder / ATS | DONE | `routes/resumes.ts:104` upload, `:234` ATS, `:328-934` builder (save/generate/tailor/rewrite/export-pdf/keyword-match); `src/store/resumeBuilderSlice.ts`; `src/pages/Resume/**` | PDF/DOC-only for upload; PDF export via server `htmlPdf.ts` + client jsPDF. |
| 9 | Custom instructions | DONE | `components/Sessions/steps/Step4_LanguageAISettings.tsx:129-140`; persisted at `routes/sessions.ts:204,262`; injected into prompt `lib/interviewPrompt.ts:55,150`, `sessions.ts:1037,1332` | No documented 20k-char cap in code. |
| 10 | Model selection | DONE | `pages/Sessions/ActiveSession/components/ModelSelector.tsx:9-14` (4 models: Claude Haiku 4.5, Claude Sonnet 4.5, Gemini 3.1 Flash Lite, GPT-5); `sessions.ts:205` | Duplicate/divergent list in `Step4_LanguageAISettings.tsx:37-56` (3 models incl. Gemini 2.0 Flash); server does not validate model ids. |
| 11 | Mock interview | **MISSING** | grep `mock.?interview|MockInterview` over `artifacts/craft-vita/src` -> 0 feature matches; grep over `api-server/src` -> 0 | Only the competitor spec mentions it (`SPEC.md:2.3`). No route, page, or table. |
| 12 | Coding mode / code Q&A | **MISSING** | grep `coding.?mode|CodingMode|codingMode|codeAnswer` over craft-vita -> 0 matches | Code rendering exists incidentally (`react-syntax-highlighter` dependency, markdown renderer), but no coding-interview mode. |
| 13 | Notes / export | PARTIAL | `routes/sessionNotes.ts:9` (read-only transcript+summary; comment `:52-55` admits dual response shapes), `pages/Sessions/TranscriptDialog.tsx:612` (AI notes tab), `:533` (download transcript), `pages/Resume/ResumeEditor/components/TopBar.tsx:89` (PDF export), `routes/projects.ts:583` export-pdf | Session notes cannot be exported as a document; only transcript JSON download + resume/project PDFs. |
| 14 | Documents | PARTIAL | `routes/documents.ts:80` upload, `:120` list, `:136` delete; magic-byte check `lib/uploadValidation.ts:5`; UI `src/pages/Document/**` | **PDF only** (`docs.ts:20 ALLOWED_MIME_TYPES = application/pdf`); DOCX/DOC magic bytes are validated in code but the document upload rejects them. |
| 15 | Meeting detection | **MISSING** | grep `meeting|call.?detect|autoDetect` over `artifacts/craft-vita/src` -> 0 matches | No auto-start-on-call detection; user starts sessions manually (`ConnectDialog.tsx`). |
| 16 | Credits / billing / tiers | DONE (code) | `routes/credits.ts:39-397` (balance/brackets/plans/ledger/usage/feature-costs/purchase order/verify/webhook), `lib/featureCredits.ts:18-50` (per-action prices), `lib/sessionCredits.ts`, `lib/razorpay.ts`; UI `src/pages/Billing`, `components/Billing/*` | Payments = **Razorpay** (not Stripe as in competitor spec). No Razorpay keys here -> payment runtime UNVERIFIED. |
| 17 | 50+ languages | PARTIAL | `components/Sessions/steps/Step4_LanguageAISettings.tsx:31-35` -> **3** languages (English/Spanish/French); `components/Sessions/ConnectDialog.tsx:76-86` -> **9** (adds German/Hindi/Arabic/Chinese/Portuguese/Japanese) | No 50+ list anywhere; `language` is passed to Deepgram as a string. |
| 18 | Browser / web app | DONE | `index.html` -> `src/main.tsx`; `pnpm build` exit 0; A4 dev server 200 | Bundled without server keys the app throws `Missing Publishable Key` (`src/main.tsx:15-19`). |
| 19 | Desktop app (Tauri v2) | PARTIAL | `src-tauri/tauri.conf.json` (2 windows + updater), `src-tauri/src/lib.rs` (2,833 LOC); `cargo check` exit 0 | No packaged build attempted; `createUpdaterArtifacts:false` (`tauri.conf.json:74`); CSP null; one broad capability for all windows (`capabilities/default.json:6-63`). |
| 20 | Mobile app | **MISSING** | No mobile project; only responsive breakpoint hook `src/hooks/use-mobile.ts:5`; `artifacts/` has api-server, craft-vita, desktop-electron, mockup-sandbox | No React Native/Expo/Capacitor anywhere in workspace. |
| 21 | "No keys" mock/demo mode | **MISSING** | `lib/openrouter.ts:35-37` throws without key; `routes/auth.ts:89-95` 503; `src/main.tsx:15-19` throws without Clerk key; `lib/db/src/index.ts:7-9` throws without DB; 0 mock adapters in api-server | A session cannot run with zero keys. Free-session flag (`sessions.ts:234`) still needs all four services. |

## 3. Top gaps (ranked by mission impact)

1. **No offline/mock mode and four hard external dependencies** - OpenRouter (`lib/openrouter.ts:35`), Deepgram (`routes/auth.ts:89`), Clerk (`src/main.tsx:15`), Postgres (`lib/db/src/index.ts:7`). Nothing demos or verifies end-to-end without keys; there is no seed/demo script or Makefile.
2. **Mock interview missing entirely** - no route/page/table (grep 0). It is a headline mission feature.
3. **Coding mode missing** - no coding-interview flow, no code-runner, no code-specific prompt mode (grep 0).
4. **Meeting detection missing** - no auto-detect of Zoom/Meet/Teams calls, no calendar integration (grep 0).
5. **Stealth layer half-dead** - `focus_bypass.rs`, `screen_protect.rs`, `cursor.rs` compile but are never installed/registered (9 cargo warnings); no click-through/focus-blocking guarantee. CSP still `null` (`tauri.conf.json:61`).
6. **Language coverage 3-9, not 50+** - `Step4_LanguageAISettings.tsx:31-35`, `ConnectDialog.tsx:76-86`.
7. **Mobile absent** - no project; only `use-mobile.ts` breakpoint hook.
8. **API test entrypoint is a silent no-op** (`pnpm --dir artifacts/api-server test` exit 0, empty output) and the integration suite cannot load without Postgres (`tests/sessions.integration.test.ts:84`, `lib/db/src/index.ts:8`). CI can go green with zero API tests.
9. **Desktop release path unverified** - no `tauri build`, `createUpdaterArtifacts:false`, single broad capability for `main/mini/launcher/floating`, version 0.1.24 must be compared to the signing key/artifact chain at release time.
10. **Bundle hygiene / no meaningful code-splitting** - `page-*.js 4,068 kB`, `index-*.js 1,162 kB`; build warns dynamic+static dual imports (`src/tauri-stubs/api-event.ts`, `pages/Auth/SignIn/page.tsx`).

## 4. Security findings recorded during the audit (do not fix here)

- **Live Supabase PAT on disk**: `artifacts/craft-vita/src-tauri/src/db access token.txt` (69 B, untracked and `.gitignore`d). **Rotate immediately**, then delete. Value not copied.
- **Desktop refresh token in URL query**: `src/pages/DesktopAuth/DesktopAuthHandoff.tsx:12,91` sends `?desktop_refresh=<token>` to `http://localhost:<port>/`; server stores only `tokenHash` (`routes/desktop.ts:210,247`) but the token still transits URL/history surfaces.
- **CSP disabled**: `src-tauri/tauri.conf.json:61` `"csp": null`.
- **Process-local rate limiter**: `api-server/src/lib/aiRateLimit.ts:1,30` (in-memory Map; not shared across replicas).
- **Broad Tauri capability**: `src-tauri/capabilities/default.json` grants one permission set to `main/mini/launcher/floating`, incl. `core:window:allow-create`, `core:webview:allow-create-webview-window`, `updater:allow-download-and-install`, `process:allow-restart`.

## 5. Runtime-verification unknowns (cannot be resolved in this environment)

| Unknown | Why it is unknown | How to verify |
|---|---|---|
| Live session end-to-end (create -> activate -> transcript -> auto-answer -> end) | Needs Clerk sign-in, Postgres, Deepgram key, OpenRouter key; none configured | `pnpm --dir artifacts/api-server dev` with filled `.env`, then real browser/desktop sign-in |
| Native audio capture + Deepgram WebSocket on Windows/macOS | Requires a Tauri desktop runtime and real audio devices | `pnpm --dir artifacts/craft-vita tauri dev`, join a call, watch `stt:status:*`/`stt:health:*` events |
| Screen-capture exclusion during a call | Requires desktop build + a screen recorder | PowerShell `tools/capture-affinity`-style check or Zoom/Meet share while overlay is open |
| Payment/billing end-to-end | No Razorpay keys; webhook signature path untested | Razorpay test keys + `credits/purchase/order` -> checkout -> webhook replay |
| Desktop packaging/updater/signing | Not attempted (long build + signing key absent) | `pnpm --dir artifacts/craft-vita tauri build` with signer env vars |
| React hydration/render/console errors | Only HTTP shell was probed (A4); no browser driver used | Playwright/agent-browser against `http://127.0.0.1:5173` with Clerk test key |

## 6. Repo-state caveats

- The working tree changed under the audit: started on `fix/windows-reopen-compile` @ `491f4b6`, switched to `complete-build` @ `627eb98` at 18:49-18:50 IST by another team process. All results above are from the post-switch `complete-build` state.
- 3 git stashes preserved (`wip(auto-scroll)` etc.); a prunable second worktree `C:/Users/user/Desktop/hireshade-emitto-fix` exists. Not touched.
- `artifacts/desktop-electron/` (Electron shell, `main.js` + scripts) and `admin/` (separate Kottster app with own lockfile) are outside the pnpm workspace runtime; neither was built or verified.
- `rea/` is a gitignored external tool checkout, not product code; `SPEC.md` and `docs/raw/**` are competitor (ParakeetAI) recon artifacts, not HireShade specs.
