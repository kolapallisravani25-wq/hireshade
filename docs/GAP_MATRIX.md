# HireShade Gap Matrix

Snapshot: 2026-10-20 | Branch: `complete-build` | Baseline: `627eb98`
Sources: `docs/CURRENT_STATE.md`, `docs/AUDIT_INVENTORY.md`, `docs/REPO_STATUS.md`, `SPEC.md` (competitor RE, 2026-10-20), `docs/raw/**` (REA captures), `docs/TARGET_VERIFIED.md` (in progress).

Legend — status: **PASS** (proved by the listed test/command), **PARTIAL** (implemented but unproven or incomplete), **MISSING**, **DEFERRED** (blocked by host/tooling; reason recorded).
Severity: **blocker** = product unusable · **high** = core promise broken · **med** = feature gap · **low** = polish.
Evidence classes: OBSERVED (command/file evidence) / INFERRED (reasoned, no direct observation) / UNKNOWN.

## Target facts that drive this matrix (short form)

| Fact | Evidence | Confidence |
|---|---|---|
| Target is a Next.js marketing site + a separate **Electron** desktop client | `SPEC.md` §2.2/§4; `docs/raw/desktop/asar-filelist.txt`; `docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Frameworks/Electron Framework.framework` | OBSERVED |
| Streaming ASR is a hosted vendor (Speechmatics named in public copy) | `SPEC.md` §2.1, §2.3 | OBSERVED (public copy) |
| Answers stream from selectable hosted models (OpenAI / Google / Anthropic / Cerebras) | `SPEC.md` §2.1, §5 | OBSERVED (public copy) |
| Billing is Stripe with credit packs + subscriptions; free tier = 10×10-minute sessions + 1 mock interview | `SPEC.md` §5 | OBSERVED (public price payload) |
| Overlay promises 5 stealth vectors + 8 verified platforms | `SPEC.md` §2, competitor landing copy captured under `docs/raw/pages/home.html` | OBSERVED (marketing claim) |
| Desktop overlay flags/stealth primitive implementation | `docs/TARGET_VERIFIED.md` rows T-01..T-12 (REA) | PENDING (this run) |

## Rows

| ID | Requirement | Target evidence | Current state (evidence) | Severity | Fix plan | Proving test | Status |
|---|---|---|---|---|---|---|---|
| G-001 | Full mock session with **zero API keys** | competitor has no equivalent (our DoD requirement) | No mock adapters in api-server; Clerk/OpenRouter/Deepgram/DATABASE_URL all hard-fail (`docs/CURRENT_STATE.md` §4; `lib/openrouter.ts:35-37`, `src/main.tsx:15-19`, `lib/db/src/index.ts:7-9`) | blocker | Add provider interfaces + mock adapters (LLM, ASR, TTS, auth/demo user, DB-optional demo store); add `DEMO_MODE` fail-closed to non-production; build `make demo` runner | `make demo` exits 0, prints transcript+question+streamed answer, writes `docs/evidence/demo-*.json`; run with all provider keys unset | MISSING |
| G-002 | API test entrypoint must actually run tests (no false green) | — | `pnpm --dir artifacts/api-server test` exited 0 with empty output; no `test` script (`artifacts/api-server/package.json`) | high | Add `test`/`test:unit`/`test:integration` scripts + vitest env loader | `pnpm --dir artifacts/api-server test` shows 19 files / 163 tests | PARTIAL (script added; proving run pending) |
| G-003 | API integration suite green against real Postgres | — | With `DATABASE_URL` from `.env` and the local `hireshade-postgres` container: 63/63 pass in 42.5s (`docs/evidence/09-api-integration-with-db.txt`); concurrent runs collide on fixed user ids | high | Document DB provisioning; ensure serial runs; add docker-compose fixture | `pnpm --dir artifacts/api-server test` one-shot: 163/163 pass | PARTIAL |
| G-004 | Measured latency budget: partial <500 ms, silence→question <800 ms, question→first token <1200 ms, answer visible <3000 ms p50 / <5000 ms p95 | competitor marketing claims 2–4 s | No instrumentation or measurement exists anywhere in repo | blocker (DoD) | Add pipeline timing harness using real detector + prompt builder + mock/real provider; record p50/p95; assert in test | `make demo` / vitest latency test emits `p50`/`p95` and passes thresholds | MISSING |
| G-005 | e2e: fixture audio → transcript → classified question → streamed answer rendered in overlay inside budget | competitor core loop per `SPEC.md` §2.1 | No e2e harness; Electron shell renders (CDP text proves login/overlay) but no session driver | blocker (DoD) | Build headless e2e: fixture WAV (16 kHz mono) → VAD/segmenter → mock ASR → real classifier → real prompt → mock stream → overlay DOM; assert DOM text + timings | e2e test passes; artifacts under `docs/evidence/e2e/` | MISSING |
| G-006 | Screen-share invisibility on Windows, proof saved | competitor claims all 8 platforms | Electron `setContentProtection` verified: affinity 0x11, captured pixels exclude windows, A/B control shows UI when off (`docs/evidence/stealth/`) | high | Keep evidence; wire same primitive into Tauri path + add runtime self-check command | A/B capture logs + PNGs; affinity script exit 0 | PASS (Windows) |
| G-007 | Screen-share invisibility on macOS | competitor ships macOS build | No macOS host; Tauri `contentProtected` + `macOSPrivateApi` config present; Electron path documented | high | Document macOS verification steps; add config/manifest test | `docs/RUNBOOK.md` procedure + config test | DEFERRED (no macOS host) |
| G-008 | Dock/taskbar invisibility + non-suspicious process name | `SPEC.md` §2; marketing stealth vectors | Tauri windows `skipTaskbar:true`, `visibleOnAllWorkspaces:true` (`tauri.conf.json`); Electron mirrors it (`main.js`); process name `electron`/`hireshade` (review) | med | Verify macOS LSUIElement/Info.plist; set product name; document residual risk | config test + launch check | PARTIAL |
| G-009 | Global hotkeys: toggle overlay, panic-hide, cycle model | competitor desktop hotkeys (REA pending) | No `globalShortcut` anywhere (grep 0); only in-window zoom shortcuts | high | Add hotkey manager (Electron `globalShortcut` + Tauri plugin), panic-hide all windows, persisted bindings; pure resolver unit tests | unit tests + CDP/affinity check that panic-hide hides windows | MISSING |
| G-010 | Overlay: frameless, transparent, always-on-top, draggable, click-through toggle, opacity control, position presets | `SPEC.md` §2 + competitor UI | Tauri: frameless/transparent/alwaysOnTop/click-through commands exist (`lib.rs:545-590`); Electron: frameless/transparent/top/skipTaskbar but no click-through/opacity/position presets; overlay unified runtime flags all false (`src/overlay/flags.ts:23-51`) | high | Verify dragged position persists; add Electron click-through/opacity/position IPC; test pure layout math | unit tests + CDP assertions | PARTIAL |
| G-011 | Stealth Rust modules wired (not dead code) | — | `focus_bypass.rs`, `screen_protect.rs`, `cursor.rs` declared but never invoked; 9 cargo dead-code warnings; `screen_protect.rs` uses WDA_MONITOR not WDA_EXCLUDEFROMCAPTURE | high | Wire or delete; use WDA_EXCLUDEFROMCAPTURE (0x11) with fallback; register commands; add Rust tests | `cargo check` no dead-code warnings for these; affinity test on Tauri build if feasible | MISSING |
| G-012 | CSP configured (not `null`) | — | `tauri.conf.json` `"csp": null` | high | Set CSP for Clerk/Razorpay/API/Tauri schemes; test manifest | config test | MISSING |
| G-013 | Dual audio capture: mic AND system loopback + device picker | `SPEC.md` §2.1 | Rust WASAPI (`lib.rs:1103,1284`) + ScreenCaptureKit (`:834`) + browser getDisplayMedia/getUserMedia (`useScreenShare.ts:61`, `useDeepgram.ts:82-86`); device picker exists in `useDeepgram` | high | Add device enumeration/picker test, capture status state test; runtime WAV capture CLI | unit tests with mocked MediaDevices; optional 10 s dual WAV on Windows | PARTIAL |
| G-014 | VAD + endpointing ~700 ms silence | competitor real-time loop | No VAD/silero; question detector consumes transcript text only | high | Implement energy/zero-crossing VAD + endpointing with fixture WAV; unit tests on exact boundaries; wire into demo pipeline | boundary tests ±1 frame; demo uses it | MISSING |
| G-015 | Streaming ASR adapter: partials/finals, reconnect backoff, dedupe | Speechmatics per target | Deepgram WS hook with reconnect (`useDeepgram.ts:248-264`); transcript stabilizer dedupes (`transcript-stabilizer.ts`); no provider interface/mock | high | Extract `AsrProvider` interface (Deepgram + mock + local whisper stub); tests for reconnect/backoff/out-of-order/dup | unit tests with fake WS | PARTIAL |
| G-016 | Question classifier precision ≥0.85 / recall ≥0.90 on 60+ labeled phrases, no firing on small talk | competitor auto-answer | Heuristic detector + semantic classifier exist; only 4 detector tests; no labeled set/metrics | high | Build labeled dataset (questions/follow-ups/small-talk/admin/coding), tune thresholds, precision/recall script + regression test | report in `docs/TEST_REPORT.md`; test asserts thresholds | MISSING (metrics) |
| G-017 | Streaming LLM router: multi-provider, failover, abort/regenerate, timeouts | OpenAI/Google/Anthropic/Cerebras per target | Single OpenRouter client with timeout/idle guard (`openrouter.ts`); abort/regenerate paths exist; no direct provider adapters/failover | high | Introduce `LlmProvider` interface + OpenRouter/OpenAI/Anthropic/Google(mock) adapters, ordered failover, per-provider timeout; tests | failover + timeout tests; mock streaming test | PARTIAL |
| G-018 | Per-session model selection | `SPEC.md` §5 | `ModelSelector.tsx`, plan-gated models, session row `aiModel` | med | Verify selection persists and drives prompt/router | integration test | PASS (code) |
| G-019 | Interview mode (resume/JD) vs Regular mode | `SPEC.md` §2.1 | Session modes + resume context + JD (`interviewPrompt.ts`, `resumeContext.ts`), integration tests | med | Verify UI mode wiring + prompt output | integration prompt test | PASS (code) |
| G-020 | Instructions field (~20,000 chars) | `SPEC.md` §5 | `Step4_LanguageAISettings.tsx:129-143`; limit not enforced? | med | Enforce 20k server+client, counter, prompt inclusion | unit test | PARTIAL |
| G-021 | 50+ languages, one active per session | `SPEC.md` §5 | Only 3/9 languages in pickers; `getLanguageCode` maps few; ASR/LLM language not threaded | med | Language registry (ISO code + name + Deepgram`language` + prompt directive), per-session persistence, picker | registry ≥50 + per-language ASR payload test | MISSING |
| G-022 | Mock interview mode: TTS interviewer asks, waits, follows up | `SPEC.md` §2.3 | UI promo only; no implementation (grep 0) | med | Implement interviewer agent + TTS adapter (mock/real) + turn loop + UI | unit test turn loop + demo transcript | MISSING |
| G-023 | Coding mode: detect coding question, read shared screen, approach+complexity+edge cases | `SPEC.md` §2, "Full Coding Support" | "Analyze Screen" uses screenshot + Gemini fast model (`useFloatingSession.ts:106,3030`); no coding-mode classifier/structured answer | med | Add coding-question detector, screen-region capture path, structured prompt; tests | classifier tests + demo answer shape | PARTIAL |
| G-024 | Session notes (summary/action items/decisions) + transcript export (MD/PDF) | `SPEC.md` §2.1 / target feature list | `sessionNotes` route + `htmlPdf` + export UI present; PDF renderer mocked in tests | med | Verify end-to-end export bytes; add tests | route test with mock PDF + MD content assert | PARTIAL |
| G-025 | Document upload for live reference | `SPEC.md` §2.1 (Pinecone docs) | Documents upload route + grounding; PDF only; DOCX magic check but no parsing | med | Add DOCX text extraction or restrict to PDF; test | upload+extract test | PARTIAL |
| G-026 | Meeting auto-detection + join prompt | target feature list | No detection code (grep 0) | low | Implement process/title detector (Zoom/Teams/Meet/Webex) + prompt; pure parser tests | parser fixtures | MISSING |
| G-027 | Stripe checkout + idempotent webhooks + append-only credit ledger | `SPEC.md` §5 (Stripe confirmed) | Razorpay only; ledger append-only with idempotency and tests (63 integration tests) | high | Add Stripe adapter (mock+real), webhook signature verification, idempotency table/keys, ledger debit; keep Razorpay | webhook replay/concurrency tests | MISSING |
| G-028 | Browser-only path works without desktop app | target offers browser app | getDisplayMedia audio + Deepgram + full web app; no-key path blocked by Clerk | med | Demo/mock path for browser; document limits | zero-key browser demo test | PARTIAL |
| G-029 | Mobile-optimized web | target "anywhere" claim | Responsive web only, no mobile app; secondary market pages | low | Responsive audit of session/launcher screens | viewport tests | DEFERRED (not core promise) |
| G-030 | Desktop packaging/updater signed + install test | target ships staged Electron builds | MSI/EXE built earlier (0.1.23) but unsigned updater; `createUpdaterArtifacts:false`; version drift | low | Configure signing in CI/secrets; document | signed artifact + update test | DEFERRED (no private key) |
| G-031 | Security: rotate leaked Supabase PAT, delete file; token in URL query | — | `db access token.txt` (live PAT) on disk; desktop refresh token in loopback query (`DesktopAuthHandoff.tsx:91`) | high | Delete file, add secret-scan test, rotate instruction in RUNBOOK; move to one-time code | secret-scan test; auth flow test | MISSING |
| G-032 | Repo hygiene: no TODOs in shipped code; no stubs | — | 103 ORPHANED / 23 STUB files classified (`docs/AUDIT_INVENTORY.md`); TODO sweep not done | med | Sweep TODOs; triage orphans; ensure no `pass` bodies | `rg TODO/FIXME` output triaged; test suite | PARTIAL |
| G-033 | Docs deliverables: AUDIT_INVENTORY, BASELINE_FAILURES, CURRENT_STATE, TARGET_VERIFIED, GAP_MATRIX, TEST_REPORT, RUNBOOK, DECISIONS, rea-evidence | mission DoD | AUDIT_INVENTORY/BASELINE_FAILURES/CURRENT_STATE/REPO_STATUS done; GAP_MATRIX this file; rest missing | high | Write remaining docs with real measurements | files exist + reviewed | PARTIAL |
| G-034 | `.env.example` fully populated at repo root + Makefile | mission DoD | package-local `.env.example` exist; no root `.env.example`, no Makefile | med | Add root `.env.example` (all services, fake values) + Makefile (demo/test/build/stealth-check) | `make help` lists targets; demo runs | MISSING |
| G-035 | Structured JSON logs with sessionId correlation across pipeline | mission constraint | pino logger + sessionId in API (many log sites), frontend console; no end-to-end correlation id on ASR→LLM path | med | Add correlation id propagation in demo/harness + API logs | log assertions in demo | PARTIAL |

## Execution order (top-down)

1. Q1 (unblocks everything): G-001/G-034/G-004/G-005 demo+mocks+latency+e2e harness.
2. Q2 (core promise): G-006 evidence (done) → G-009/G-010/G-011/G-012 stealth wiring; G-014/G-015/G-016/G-017 audio/classifier/router.
3. Q3 (parity): G-021 languages, G-022 mock interview, G-023 coding, G-026 meeting detection, G-020 instructions, G-024/G-025 notes/upload.
4. Q4 (money/security): G-027 Stripe, G-031 security, G-032 hygiene, G-002/G-003 test entrypoints.
5. Q5 (docs/release): G-033 docs, G-007 macOS deferral, G-030 packaging deferral.

Statuses in this table are updated as each row's proving test lands.

## Target verification update (Phase B complete, 19:15 IST)

`docs/TARGET_VERIFIED.md` now has 16 mechanism rows with byte-offset evidence from the shipped macOS Electron build 3.9.126 (14 OBSERVED, 2 PARTIAL). It supersedes the earlier "target facts" table above. Requirement mapping:

| Gap row | Target row(s) | What the target actually does (short) |
|---|---|---|
| G-006/G-009/G-010 | T-02, T-03, T-04, T-06 | Electron `setContentProtection` toggled by persisted private mode; single transparent panel window; `setAlwaysOnTop(true,"screen-saver",1)` re-asserted 1 s + background-throttling off + native-occlusion disabled; dynamic click-through via 40 ms mousemove hit-test with `{forward:true}` |
| G-008 | T-05, T-16 | skipTaskbar forced; macOS hides Dock and re-hides on a 2 s poll (no LSUIElement); tray is the honest affordance |
| G-009 | T-07 | Two shortcut sets registered only while visible: app nav (CmdOrCtrl+Shift+arrows) and live-call (CmdOrCtrl+Enter / Shift+Enter / H / Up/Down / Left/Right) |
| G-013 | T-08 | Windows WASAPI loopback via Rust napi addon (`sonora`, `push_resampler`); macOS Chromium Core Audio tap flags + `setDisplayMediaRequestHandler` audio:"loopback"; **no BlackHole/VB-Cable** |
| G-015 | T-09 | Speechmatics realtime WS, 16 kHz f32le, JWT in query, AddPartial/AddTranscript/EndOfUtterance, two sockets (mic + screen), liveness watchdog |
| G-017 | T-10, T-11 | Answers over SSE (`/api/chat`, AI SDK, `X-Accel-Buffering: no`); rest tRPC batch; session creation is reference-style (resumeId/documentIds + preference object + systemInstructions) |
| G-021 | T-14 | Language list is fetched from the backend per session and sent as `language[:domain]` (e.g. `en:medical`); total count unknown |
| G-026 | T-13 | 20-slug meeting table across macOS bundle ids / Windows process names / window-title patterns, browsers included |
| G-027 | T-12 | 0.5 credit / 30 min, 10-min trial, +20 min free extension, auto-extend headroom 15 s, ledger spent/refunded/drift, automated refund queue, INSUFFICIENT_CREDITS |
| G-030 | T-15 | electron-updater over GitHub Releases, signed assets, blockmaps, deep-link protocol, `safeStorage`; launch-at-login unconditional (we will make it opt-in) |

**Status changes from this evidence:** G-006 → **PASS (Windows)** with recordings/frames in `docs/evidence/stealth/README.md`; G-007 stays **DEFERRED**; G-009/G-010 remain **MISSING/PARTIAL** until the desktop engineer lands the target-matching implementation; target-known constants are now available to the harness/billing rows (no more inference).
