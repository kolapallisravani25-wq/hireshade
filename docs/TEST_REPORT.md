# HireShade Test Report

**Date:** 2026-10-20 (Asia/Calcutta) · **Branch:** `complete-build` · **Baseline:** `627eb98` · **Integration state:** uncommitted working tree measured here (commit hashes follow in §10)
**Host:** Windows 11 (10.0.22631), 1366×768, Node 24.19.0, pnpm 11.17.0, Vitest 4.1.9, Rust stable, Electron 37.2.4, Postgres 16 container, FFmpeg 8.1.2, GNU make 4.4.1 (portable w64devkit).
**Every number below is copied from the cited log; nothing is estimated.**

## 1. Verdict

| Gate | Result |
|---|---|
| Workspace typecheck | **PASS** — exit 0 (`docs/evidence/12-workspace-typecheck.txt`) |
| Web/API build | **PASS** — exit 0; Vite 7.3.3, 5,427 modules, built in 1m57s; API esbuild 2.9 MB (`docs/evidence/13-build.txt`) |
| Frontend unit tests | **PASS — 53 files / 616 tests, 0 failed** (`docs/evidence/19-overlay-size-frontend.txt`) |
| API unit + integration tests | **PASS — 37 files / 399 tests, 0 failed** (`docs/evidence/16-ext-api-suite.txt`) |
| Rust check | **PASS** — `cargo check` exit 0, 0 warnings after stealth repair; `cargo test --lib` 14/14 (`docs/evidence/14-cargo-check.txt`) |
| Keyless end-to-end demo | **PASS** — `make demo` exit 0, 3 models × 3 runs, every latency budget met, zero provider keys, and all four extensions exercised (`docs/evidence/18-ext-make-demo.txt`) |
| Overlay e2e (Electron + CDP) | **PASS** — 9/9 DOM/timing assertions; answer visible 1,648 ms (`docs/evidence/demo/overlay-dom.json`) |
| Classifier precision/recall | **PASS** — 1.000 / 1.000 on the 120-utterance labeled set; untouched check 0.909 / 1.000 (`docs/evidence/classifier/report.md`) |
| Windows screen-capture exclusion | **PASS** — affinity `0x11`; A/B recordings show the UI captured when off, absent when on (`docs/evidence/stealth/README.md`) |
| macOS screen-capture exclusion | **DEFERRED** — no macOS host (G-007) |

Baseline for comparison (audit at `627eb98`): frontend 16 files / 158 tests; API 18 files / 100 tests + 1 suite failing on a missing `DATABASE_URL`. Net new automated coverage: **+16 frontend files / +218 tests**, **+17 API files / +215 tests**.

## 2. Test inventory and exact commands

| Suite | Command | Files | Tests | Duration | Exit |
|---|---|---|---:|---:|---:|
| Frontend (React/Vite/Tauri webview) | `pnpm --dir artifacts/craft-vita test` | 32 | 376 | 8.18 s (warm) | 0 |
| API (unit + DB integration) | `pnpm --dir artifacts/api-server test` | 35 | 315 | 70.58 s | 0 |
| API unit only (no DB) | `pnpm --dir artifacts/api-server test:unit` | 34 | 252 | — | 0 |
| Workspace typecheck | `pnpm run typecheck` | 4 projects + libs | — | ~105 s | 0 |
| Build (web + API + sandbox) | `pnpm -r --filter "./artifacts/**" --if-present run build` | 3 | — | ~2 min | 0 |
| Rust check/test | `cargo check` / `cargo test --lib` | — | 14 | 9.4 s / — | 0 |
| Keyless demo (full) | `make demo` | — | 18 latency samples + 9 e2e assertions | 54.6 s + e2e | 0 |
| Classifier CI gate | inside frontend suite (`classifierMetrics.test.ts`) | 1 | 7 | — | 0 |

Breakdown highlights:
- **API**: sessions integration 63, Stripe integration 35, Stripe unit 35, provider/mock layer 60, auth/grounding/prompt/credits/upload etc. the rest.
- **Frontend**: demo pipeline 33, classifier gate 7, languages 30, instructions 8, meeting parser+poller 56, mock-interview loop 14, coding 29, hotkeys 23, overlay geometry 14, CSP 4, plus the original 158.

## 3. Latency measurements (the hard budgets)

Method: `make demo` replays ffmpeg-generated 16 kHz mono WAVs through the real pipeline — 10 ms-frame RMS VAD with 700 ms endpointing, mock ASR emitting timed partial/final events over the target's `pcm_f32le`/16 kHz/JWT WebSocket contract, the **real** `detectActiveQuestion` detector, the **real** `buildInterviewSystemPrompt` assembler, and a mock LLM streamed at the target's measured per-model first-token latency (T-11 table). Latency is timestamped on the event bus at each boundary. 9 runs × 2 questions = 18 samples across `gpt-5`, `gemini-3-1-flash-lite`, `gemini-3-6-flash`.

| Budget | Statistic | Threshold | Measured | Verdict |
|---|---|---|---:|---|
| capture → partial transcript | p95 | < 500 ms | **250.8 ms** | PASS |
| silence → question detected | p95 | < 800 ms | **715.3 ms** | PASS |
| question → first LLM token | p95 | < 1200 ms | **767.8 ms** | PASS |
| question → answer visible | p50 | < 3000 ms | **1648.4 ms** | PASS |
| question → answer visible | p95 | < 5000 ms | **1921.3 ms** | PASS |

Sources: `docs/evidence/make-demo.txt`, `docs/evidence/demo/demo-latency.json` (per-run and per-question rows), `docs/evidence/demo/demo-transcript.md`.

**Caveat (important):** ASR and LLM are mocked. The ASR mock replays ground-truth transcript events, and the LLM mock waits the *observed target first-token latency* before streaming a canned answer. These numbers prove the **orchestration/transport budget** — detector, segmenter, prompt assembly, event fan-out, overlay repaint — not real vendor latency. A real-key run against Deepgram/OpenRouter will be slower; the budget headroom (answer p95 1.92 s vs 5 s ceiling) is intentional for that reason. See GAP G-038 for the unmeasured ASR WER.

## 4. Classifier evaluation

- Corpus: 120-utterance main labeled set (61 positive / 59 negative, 7 categories), 39-utterance holdout, 22-utterance untouched post-freeze check.
- Decision rule: fired ⇔ `source !== none` ∧ `ignoredNoise === false` ∧ non-empty question text ∧ `confidenceScore > 0.75` (documented in the report; the 0.75 band separates the detector's 0.70 statement score from its 1.00 question score).
- Main set: **precision 1.000, recall 1.000** (TP 61 / FP 0 / FN 0 / TN 59). Holdout: 1.000 / 1.000. Untouched check: **0.909 / 1.000** with one residual FP ("Is my audio coming through?") left unfixed so the check stays honest.
- Hard-negative false-positive rate is 0% for small talk (12), interviewer admin (17), candidate statements (17) and coding discussion (13).
- Pre-tuning baseline on the earlier 115-utterance corpus was 0.8197 / 0.8929, showing the fixes mattered.
- Full report, per-category table, per-utterance decisions: `docs/evidence/classifier/report.md` + `metrics.json`. CI gate: `classifierMetrics.test.ts` (7 tests) fails the build if precision < 0.85, recall < 0.90, or any negative category fires.

## 5. Overlay e2e proof

`scripts/demo/overlay-e2e.mjs` launches a real frameless/transparent/always-on-top Electron window, injects the measured 85-frame event stream into a generated overlay page, and asserts the DOM via CDP:

- status reaches `Complete`, question text rendered, answer 784 chars containing "rate limiter" and "Redis";
- answer visible at **1,648.3 ms** (budget 5,000 ms), 85/85 frames applied, window visible;
- screenshot: `docs/evidence/demo/overlay-answer.png`; assertions: `docs/evidence/demo/overlay-dom.json`.

Host quirk recorded in the runbook/harness: the agent host exports `ELECTRON_RUN_AS_NODE=1`; the demo launcher strips it, otherwise Electron runs as plain Node and `app` is undefined.

## 6. Stealth verification

Windows, real desktop session (not a container):

| Check | Result | Evidence |
|---|---|---|
| `GetWindowDisplayAffinity` while protected | **0x11 = WDA_EXCLUDEFROMCAPTURE** | `docs/evidence/stealth/capture-proof.json` |
| 5 s screen recording, stealth ON | **No HireShade pixels** in either window rectangle; underlying app only | `docs/evidence/stealth/recording-stealth-on.mp4` |
| 5 s screen recording, stealth OFF (control) | Launcher + floating overlay clearly captured | `docs/evidence/stealth/recording-stealth-off.mp4` |
| CDP DOM (both runs) | UI renders in both; exclusion is not a rendering failure | `docs/evidence/stealth/cdp-*.png`, CDP text in README |
| Panic-hide via real OS key injection (Ctrl+Shift+X) | Both windows `visible=false` via CDP **and** Win32 enumeration; restore (Ctrl+Shift+H) and model cycle (Ctrl+Shift+M) proven | `docs/evidence/stealth-wiring/electron-state-after-panic.json` |
| Overlay controls | 16/16 checks pass (preload isolation, opacity 0.55 persisted, click-through toggle, top-right preset, private mode, relaunch persistence) | `docs/evidence/stealth-wiring/electron-overlay-controls.json` |
| Linux / macOS | **NOT VERIFIED** — no hosts; macOS procedure in RUNBOOK §6 | GAP G-007 |

The evidence deliberately distinguishes OBSERVED (affinity, pixels, DOM) from INFERRED (other capture engines honoring WDA) — see `docs/evidence/stealth/README.md` §Scope.

## 7. Billing / ledger

- Stripe: 35 unit tests + 35 DB-backed tests, **70/70 pass** against the dedicated `hireshade_stripe_test` database (`artifacts/api-server/tests/stripe.*.test.ts`).
- Invariants exercised: raw-body HMAC signature + 300 s tolerance + v1 rotation; event-id idempotency; 6× concurrent duplicate delivery settles once; concurrent different events exactly-once; replay of `checkout.session.completed` does not double-credit; refund reversal once (including `refund.created` + `charge.refunded` for the same refund); refund-before-settlement durably blocks a later credit; partial refunds ignored; balance projection clamped at zero; append-only ledger rows with non-zero deltas.
- Razorpay remains on the pre-existing tested path; the shared credit ledger is append-only with a UNIQUE idempotency key.
- Known divergence: target pricing is 0.5 credit per 30 min (T-12) while this repo meters 0.5 credit/minute by default — a product/pricing decision, documented in GAP G-027 and DECISIONS ADR-005, not silently changed.

## 8. Not measured / honestly deferred

| Item | Why | Where |
|---|---|---|
| ASR word error rate | Demo ASR is a scripted mock; no Deepgram key. WER requires a real provider | GAP G-038 |
| Real Deepgram/OpenRouter latency and failover | no keys; adapters are unit-tested with stubbed transport | GAP G-015/G-017 |
| macOS capture exclusion, Dock behaviour, TCC preflight | no macOS host | GAP G-007/G-036 |
| Signed Tauri installer + updater install test | no signing key; packaging steps documented | GAP G-030 |
| Selected-screen OCR/coding vision | Analyze Screen plumbing + prompt contract tested; live screenshot path needs a desktop session with a real model key | GAP G-023 |
| Mobile-optimized web | out of core desktop promise | GAP G-029 |
| Real PDF export bytes | Chrome path unset; route tested with mocked renderer | GAP G-024 |

## 9. Flakes and environment notes (transparency)

- **DB suites are not parallel-safe.** Two concurrent runs of the sessions integration suite collided on `credits_balance_user_id_unique` because the suite truncates shared tables and uses fixed users. All reported green runs were serial; Vitest already uses `fileParallelism: false`. Stripe’s DB suite is hard-guarded to its own database.
- **CPU saturation** during parallel agent work caused one 20 s hook timeout in `sessionCredits.test.ts`; the file passes alone (6/6, 4.8 s) and in the clean full run.
- **Electron host env**: `ELECTRON_RUN_AS_NODE=1` crashes `main.js` (`app` undefined). Scrubbed by demo/harness scripts and documented.
- Build warnings are non-fatal: the 4.08 MB `page-*` chunk (pre-existing bundle-splitting debt), mixed static/dynamic import warnings, and 2.9 MB API bundle. No test depends on them.

## 10. Requirement coverage

`docs/GAP_MATRIX.md` has **38 unique requirement rows** after this run: **21 PASS, 12 PARTIAL, 5 DEFERRED, 0 MISSING**. Each row names its proving test or the concrete reason it is PARTIAL/DEFERRED. PARTIAL rows are not failures — they are features whose implementation landed but whose live/OEM verification (macOS, real provider keys, camera/OCR, PDF renderer) is not possible on this host.

## 11. Reproduction

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --dir artifacts/craft-vita test
pnpm --dir artifacts/api-server test        # needs Postgres; run alone
node scripts/demo/run-demo.mjs demo         # keyless; no make required
make demo                                   # same, if GNU make is installed
(cd artifacts/craft-vita/src-tauri; cargo check; cargo test --lib)
```

Evidence files: `docs/evidence/{10-api-full-suite,11-frontend-full-suite,12-workspace-typecheck,13-build,make-demo}.txt`, `docs/evidence/classifier/`, `docs/evidence/demo/`, `docs/evidence/stealth/`, `docs/evidence/stealth-wiring/`.

## 12. Extensions (EXT G-039 … G-043)

Four capabilities beyond the target were added on branch `feat-4`; they are tagged **EXT** and are not counted in the parity tally above.

| ID | Capability | Result | Evidence |
|---|---|---|---|
| G-039 | Pronunciation-robust understanding | **PASS** — 192 degraded utterances × 4 accent profiles: intent accuracy **53.65% → 96.88%** (target ≥92%), false-answer rate **46.35% → 0.00%** (target <3%); 0/192 high-confidence mutations; repair budget 18 ms p100 (<150 ms) | `docs/PRONUNCIATION.md`, `docs/evidence/pronunciation/` |
| G-040 | Overlay auto-scroll UX | **PASS** — 31/31 Electron/CDP assertions: 200-token stream pinned 0.00 px, unlock in one frame, pill re-lock, reopen restore, reduced motion, keyboard, ARIA polite; recording 4.5 s / 30 fps | `docs/OVERLAY_SCROLL.md`, `docs/evidence/overlay-scroll/` |
| G-041 | Razorpay billing parity | **PASS** — 84/84 Razorpay tests (45 unit + 39 dedicated-DB), 70/70 Stripe regression; two distinct signature schemes; X-Razorpay-Event-Id replay/concurrency; halt→pause→resume; refunds as compensating ledger rows; cross-gateway plan entitlements; GST rows | `docs/RAZORPAY.md`, `docs/evidence/razorpay/` |
| G-042 | Local gaze correction MVP | **PASS** — synthetic displacement reduction **81.3%/81.6%** (≥70%), jitter **0.366 px** (<1), extra latency **p50 3.54 / p95 6.30 ms** at 720p30 (<25), byte-identical pass-through, 57 tests | `docs/GAZE.md`, `docs/evidence/gaze/` |
| G-043 | Virtual-camera output device | **DEFERRED** — DirectShow filter needs an MSVC-built COM DLL + elevated `regsvr32`; macOS CMIO DAL / Linux v4l2loopback need hosts. Preview-only sink ships with exact registration steps | `docs/GAZE.md` §6 |

Extension test totals: frontend **511 tests (47 files)**, API **399 tests (37 files)**, workspace typecheck exit 0 (`docs/evidence/17-ext-typecheck.txt`), `make demo` exit 0 with a new `extensions` stage running W1/W2/W3/W4 checks (`docs/evidence/18-ext-make-demo.txt`).

Notes / honest limits: accent degradation is deterministic modelling rather than audio; Razorpay's live API was not contacted (no keys — injected-fetch adapter tests + real HMACs); gaze runs on synthetic faces only (no camera/model bundled); virtual-camera registration is deferred. None of these change the parity score.

## 13. Overlay size / readability / invisibility-at-size (EXT G-044 … G-050)

| ID | Capability | Result | Evidence |
|---|---|---|---|
| G-044 | Five presets, BANNER default, persisted/resizable | **PASS** — 60-cell pure-model matrix + 20/20 Electron/CDP assertions; BANNER 936x240, re-layout 2.3-4.1 ms | `docs/OVERLAY_SIZE.md`, `docs/evidence/overlay-size/o1/` |
| G-045 | Readability + speakability | **PASS** — min font 16 css px (16→32 device px at 200%), min contrast 8.14:1, longest line 74.9ch, LHR 1.52-1.60; 400-word no-overflow in all 20 preset×DPI cells; max hook 12 words / max first screenful 26 words | `docs/evidence/overlay-size/o3/o3-size-results.json` |
| G-046 | Exclusion invariance at size | **PASS** — 11/11 transitions at 0x11 (startup, card/banner/reading cycle, display-metrics, private ON/OFF, compat ON/OFF, simulated DPI) | `docs/CAPTURE_MATRIX.md` §2, `affinity-*.json` |
| G-047 | Capture-path matrix | **PASS (honest)** — GDI, Chromium desktopCapturer screen/window honor exclusion; PrintWindow no leak (caveat); **DXGI Desktop Duplication OBSERVED to ignore WDA** (49.8% vs 42.9%); tab/fullscreen share, macOS, elevated, real unplug = UNTESTED | `docs/CAPTURE_MATRIX.md` §1 |
| G-048 | Compatibility mode + fallback ladder + self-check | **PASS (caveat)** — runtime scrim-only compat (true opaque surface next launch; live recreation crashed Electron, documented), 4-step ladder, self-check UI with honest copy | `docs/CAPTURE_MATRIX.md` §3 |
| G-049 | Acceptance harness + make demo | **PASS** — 14/14 required assertions, 1 UNTESTED (synthetic click-through occluded); `make demo` ends with size step | `docs/evidence/overlay-size/o3/`, `docs/evidence/21-overlay-size-make-demo.txt` |
| G-050 | macOS size invariance | **DEFERRED** — no macOS host | GAP_MATRIX |

**Important honest finding:** the earlier Windows invisibility PASS (G-006) was measured with GDI/desktopCapturer-class paths. The new matrix shows **DXGI Desktop Duplication ignores WDA_EXCLUDEFROMCAPTURE** on this host. That is recorded as OBSERVED, not softened; it means some capture apps (those using DXGI) can still see the overlay. The compatibility-mode/fallback ladder exists precisely for that case, and macOS remains UNTESTED.

Regression status: frontend 53 files / 616 tests pass; workspace typecheck exit 0; API suite unchanged at 399; `make demo` exit 0 with the new size step; gaze CI latency gate now measures per-frame CPU (<25 ms) because wall clock inside the 616-test suite is dominated by scheduler preemption (ADR-023).

## 14. Capture-path productisation (EXT G-051 … G-056), sprint-capture

| ID | Capability | Result | Evidence |
|---|---|---|---|
| G-051 | Affinity-mode experiment 0x00/0x01/0x11 across paths | **PASS (honest)** — 0x00 OBSERVED visible, 0x01 **UNTESTED-BLOCKED** (out-of-process SetWindowDisplayAffinity = ERROR_ACCESS_DENIED; no in-process 0x01), 0x11 OBSERVED; **DXGI ignores every reachable mode**; residual = 0 changed edge pixels, interior noise only | `docs/CAPTURE_MATRIX.md` §1b, `docs/evidence/capture-sprint/` |
| G-052 | Recreation crash root cause + opaque path verification | **PARTIAL** — crash class fixed in code (clear protection before teardown, deferred recreate after `closed`, map identity guard, force-show fallback) and ladder now names DXGI vs black-bar; opaque-capture **measurement BLOCKED** (repro harness hangs), so not claimed fixed | `main.js` diff, `docs/CAPTURE_MATRIX.md` §3 |
| G-053 | Runtime pre-flight GREEN/AMBER/RED + routing | **PASS** — pure state machine (24 tests), 11-scenario matrix + 25 assertions, versioned app data list (2026.10.20.1), 4 actions, honest copy, black-bar self-check; IPC wired in main/preload and card mounted in ConnectDialog | `docs/evidence/capture-sprint/preflight/`, `src/overlay/preflight/` |
| G-054 | Close untested list | **PASS/PARTIAL** — click-through OBSERVED PASS; Chrome 155 + Edge full-screen share OBSERVED excluded with magenta positive control; tab share structurally safe (exact app-tab selection UNTESTED-BLOCKED); real 150% scaling, second monitor, elevated = UNTESTED-BLOCKED with commands | `docs/CAPTURE_MATRIX.md` §7, `docs/evidence/capture-sprint/s4/` |
| G-055 | macOS verification | **DEFERRED** — `docs/MACOS_PLAN.md` names files/APIs/TCC entitlements/signing and acceptance rig | MACOS_PLAN.md |
| G-056 | Honest claim | **PASS** — dated `docs/UNDETECTABILITY_CLAIM.md` with proven/failed/blocked rows and one defensible sentence | claim doc |

Verification: frontend **57 files / 657 tests pass** (`docs/evidence/23-capture-sprint-frontend.txt`), workspace typecheck exit 0 (`24-capture-sprint-typecheck.txt`), capture/preflight unit tests 58/58, keyless capture-sprint quick check PASS (`25-capture-sprint-demo.txt`). No prior test regressed; latency pipeline unchanged.

Honest headline: on this Windows host the overlay is excluded from GDI, Chromium screen/window capture, Chrome/Edge full-screen sharing and PrintWindow content, but **DXGI Desktop Duplication still sees it**; 0x01 could not be established; macOS/elevated/real-DPI/second-monitor remain blocked or deferred. The app now tells the user that in plain language before the session.

## 15. Sprint-unblock — U1 WDA_MONITOR resolved (EXT G-051/G-057)

**Question:** does DXGI Desktop Duplication honour WDA_MONITOR (0x01) where it ignores WDA_EXCLUDEFROMCAPTURE (0x11)? **Answer: OBSERVED YES.**

Method: Electron main calls `user32!SetWindowDisplayAffinity` in-process through koffi on its own HWND (`win.getNativeWindowHandle()`); readback via `GetWindowDisplayAffinity` is 0x1. Three modes were launched with `HIRESHADE_AFFINITY_MODE`, and DXGI was captured with ffmpeg `ddagrab`; the overlay rect was cropped from the frame and sampled (mean luma / black fraction).

| Mode | Affinity readback | DXGI crop (mean luma / black %) | GDI crop | PrintWindow |
|---|---|---|---|---|
| 0x00 WDA_NONE | 0x0 | 93.82 / 0.2% (content visible) | — (control) | — (control) |
| **0x01 WDA_MONITOR** | **0x1** | **0.01 / 100% black** | **0.00 / 100% black** | **0.00 / 100% black** |
| 0x11 WDA_EXCLUDEFROMCAPTURE | 0x11 | 27.39 / 0.34% (content visible) | excluded (existing rows) | black (existing rows) |

Sources: `docs/evidence/capture-sprint/native-affinity-dxgi.json`, `affinity-native-0x01.json`, `gdi-native-0x01-gdi.json`, `printwindow-native-0x01.json`, `native-0x01-crop.png`, `native-0x11-crop.png`; script `scripts/capture-matrix/native-affinity-capture.ps1`.

**Productised:** black box mode is a persisted toggle (`captureState.affinityMode: exclude|monitor`), IPC `desktop:capture:set-affinity-mode`, preload `hireshadeCapture.setAffinityMode`, one native code path in `applyStealth`, re-asserted on the same triggers (verified runtime toggle → affinity 0x1). The pre-flight offers it as the first action for DXGI-risk/high-risk single-display setups (copy: black rectangle is discoverable, answer text does not leak).

Tests: frontend **57 files / 658 tests pass** (`docs/evidence/26-unblock-u1-frontend.txt`), workspace typecheck exit 0 (`27-unblock-u1-typecheck.txt`), new preflight test for the black-box action. Residual analysis unchanged: 0 changed edge pixels.

### U2 — opaque-capture measurement (G-052)

CDP harness fixed: on detach it re-queries `/json`, re-attaches to `floating.html` by URL with a 20 s bound and 5 s per-call bounds, and fails loudly instead of awaiting a dead socket (`measure-opaque-recreate.mjs`). Re-attach found 6 targets and the new floating page.

Measured: startup-opaque (`capture-state.json` compatMode=true so `createWindow` builds `transparent:false`) reports `transparent:false`, affinity **0x11 PASS**, DOM scrim `rgb(11,13,18)`; **PrintWindow remains all-black (mean 0, 100 % black)** and GDI vs hidden baseline is 3.74 %. Runtime recreation survives and logs `compat=true transparent=false` + native affinity 0x11, but the recreated window probes `visible=false` and its renderer/CDP target disappears, so only hidden-baseline captures are available (GDI 0.00 %, DXGI 0.95 %). `WS_EX_LAYERED` stays set in both modes, so it is not a valid opacity discriminator. **Result: G-052 PARTIAL** — harness fixed, opaque PrintWindow expectation not confirmed; no claim that the black bar is fixed.

Evidence: `docs/evidence/capture-sprint/{opaque-recreate-runtime.json,opaque-recreate-measurement.json,u2-opaque-summary.json,main-u2.log,u2-window-style-*.json,u2-diff-*.json}`.

### U3 — real OS scaling (G-054)

150 % is not offered on this 1366×768 source: the Settings UI lists only **100 %** (UIAutomation returns `scale-item-not-found`), and the CCD API reports `maxRelativeScale=1`. Setting relative +2 returned success but Windows clamped it; the **live Electron scale factor changed 1.05 → 1.3125 (125 %, ratio 1.25)** and was restored to 1.05. Registry `LogPixels` + broadcast did not change the live scale (applies at sign-in). **Result: PARTIAL** — real live-scaling channel exercised at the host's maximum (125 %), 150 % impossible without different display hardware; commands/output in `u3-live-scaling-results.json`.

### U4 — tab-share picker artifact (G-054)

Fixed by capturing a dedicated app tab in a separate window over CDP with `getDisplayMedia({ video: { displaySurface: 'browser' }, selfBrowserSurface: 'exclude', preferCurrentTab: false, surfaceSwitching: 'exclude' })` and no fake-UI flag. Chrome 155 + Edge: `displaySurface=browser`, app-tab DOM pixel **rgb 30,78,217**, control **59,7,100**, overlay sample equals app-tab pixels, **0 magenta pixels** — the overlay never appears in a tab capture. **Result: OBSERVED PASS**, tab share is the recommended share mode. Evidence: `u4-tab-share-results.json`, `u4-tab-{chrome,edge}-{captured,app-tab}.png`.

All three were attempted; only U4 fully closed. U2 and U3 remain PARTIAL with the exact technical impediment recorded, not an unexplained blocker.

## 16. Sprint-resolve — V1 compat verdict, V2 routing, V3 macOS attempt, V4 click-through rate

### V1 — compatibility mode demoted (premise corrected)

Definitive 2x5 under 0x11, both launches with affinity readback 0x11 and window visible/topmost asserted before and after every capture; marker-only detection (rgb(1,254,1)); 0x00 positive control:

| Path | transparent 0x11 | opaque 0x11 |
|---|---|---|
| GDI | 0.00000 HIDDEN | 0.00000 HIDDEN |
| desktopCapturer screen | 0.00000 HIDDEN | 0.00000 HIDDEN |
| desktopCapturer window | 0x0 NO_PIXELS | 0x0 NO_PIXELS |
| PrintWindow | 0.00000 / black 1.0 | 0.00000 / black 1.0 |
| DXGI ddagrab | 0.00000 HIDDEN | 0.00000 HIDDEN |

Positive control (0x00): GDI 0.85248, desktopCapturer screen 0.85248, DXGI 0.85332 (variant B); A DXGI 0.85808. A GDI/DC controls were occluded by concurrent S4 windows and are not control-validated; B validates GDI/DC/DXGI. `WS_EX_LAYERED` was true in both variants (0x80028 vs 0x80128), so it does not track opacity and is not used as the discriminator. **Verdict: identical on all five paths; compatibility mode has no measured capture effect and is demoted to cosmetic.** G-052 is reclassified as retired-as-mitigation with the corrected premise, not closed as a success. Evidence: `v1/v1-compat-ab.json`, `v1-verdict.json`, `v1-control-A.json`, scripts `v1-compat-ab.mjs`, `marker-stats.ps1`.

### V2 — routing hardening (preflight)

0x11 remains default; 0x01 is never default and is offered only for known-DXGI/high-risk single-display RED setups, with explicit cost copy (invisible -> black band on paths that already worked). Black box recommends COMPACT (`switch-to-compact`) and offers `switch-back-to-invisible` when no known-bad setup is detected; `affinityMode` is part of PreflightInput. Evidence `preflight-v2/v2-affinity-preflight.json` (11 setups + 17 assertions); preflight suite 55 tests; full frontend 671 tests at V2 handoff.

### V3 — macOS ScreenCaptureKit probe attempted

Workflow + Swift SCK probe authored. `gh workflow run` -> HTTP 404 (workflow not on default branch), runner API -> HTTP 403, no push performed. Hosted runners cannot grant TCC ScreenCapture (SIP), so even a dispatch could not run the probe. Exact output in `docs/evidence/macos-probe-attempt.txt`; G-055 stays DEFERRED with the self-hosted-Mac requirement.

### V4 — click-through 20x (gated, no false passes)

Harness now checks Electron tracked ignore-mouse, `WS_EX_TRANSPARENT` (0x20), `GetForegroundWindow`, and `WindowFromPoint` hit-test in one bounded Win32 gate, and injects physical SendInput only if all match. Fixed `setIgnoreMouseEvents(false,{forward:true})` -> plain false, reset counters per phase, isolated per-run ports, and targeted S4-only cleanup. **20/20 valid iterations, 20/20 launches first attempt, 0 gate failures (100 %).** ON: target 0->1 / overlay 0; OFF: overlay control 0->1 / target 0. Gate medians 365 ms (ON) / 362 ms (OFF), per-iteration median 9.06 s. Evidence: `s4/u4v-clickthrough-20x.json`.

### Gates

Gates (all on sprint-resolve): frontend **57 files / 671 tests pass** (`docs/evidence/29-resolve-frontend.txt`); workspace typecheck exit 0 (`30-resolve-typecheck.txt`); **full keyless `make demo` exit 0** with the quick capture-sprint step PASS (`31-resolve-make-demo.txt`).