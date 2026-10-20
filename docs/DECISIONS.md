# HireShade Decision Log (ADR)

Format: one row per decision with context, options considered, decision, rationale, consequences, evidence.
ADR-001 (engineering workflow) lives at `docs/adr/ADR-001-engineering-workflow.md`. This file holds ADR-002 onward.

---

## ADR-002 — Snapshot the messy tree as a baseline before repairs

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The working tree carried 10 modified files, 23 untracked product files, an Electron shell, pre-existing docs, two stashes, and one live secret file. The mission requires a safe snapshot before changes.

**Options:** (a) commit everything with `git add .`; (b) create a branch and stage only reviewed product files, leaving secrets/scratch/tool checkouts untracked and ignored; (c) stash.

**Decision:** (b). Branch `complete-build` from `fix/windows-reopen-compile`; baseline commit `627eb98` stages product + docs only. `.gitignore` now excludes the Supabase PAT file, unrelated scratch, `/rea/`, and the 900 MB downloaded macOS bundle.

**Why:** `git-safe` forbids `git add .`; the PAT file is a live credential and must never enter history; the REA checkout is a third-party clone with its own git history.

**Consequences:** Everything is recoverable from `627eb98`; the secret and large binaries stay local only. `git diff --cached --check` reports trailing whitespace in the captured competitor HTML — accepted for raw evidence files.

**Evidence:** `git log --oneline`; commit `627eb98`; `docs/evidence/01-environment.txt`.

---

## ADR-003 — Keep Tauri as the primary desktop shell; keep/repair the Electron shell as the verifiable twin

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The target's shipped macOS client is **Electron** (observed: `docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Frameworks/Electron Framework.framework`, `asar-filelist.txt`). The existing HireShade product is Tauri v2 with native WASAPI/ScreenCaptureKit audio and working windows. A full Tauri→Electron rewrite would violate the "do not rewrite working code" rule and risk the audio/native layer.

**Options:** (a) rewrite desktop in Electron; (b) keep Tauri only, ignore Electron; (c) repair both: Tauri remains the shipped product, Electron becomes the parallel shell used for stealth/hotkey verification and as the target-matching surface.

**Decision:** (c).

**Why:** The Electron path was already present (`artifacts/desktop-electron/main.js`) and proved `WDA_EXCLUDEFROMCAPTURE` on this machine; Tauri holds the native audio code and thousands of tested lines.

**Consequences:** Two shells to keep in sync (window config is mirrored). The Electron shell is the runtime used for Windows stealth proof; Tauri remains the release artifact. Documented divergence is a maintenance cost, accepted for now.

**Evidence:** `docs/evidence/stealth/`; `artifacts/desktop-electron/README.md`; `docs/TARGET_VERIFIED.md`.

---

## ADR-004 — A fail-closed demo mode with mock adapters is the correctness backbone

**Date:** 2026-10-20 · **Status:** accepted

**Context:** No API keys are configured. Every core path hard-fails without Clerk/OpenRouter/Deepgram/Postgres, so nothing can be demonstrated or regression-tested end-to-end.

**Options:** (a) require keys; (b) put mocks only in tests; (c) ship provider interfaces + first-class mock adapters behind an explicit `DEMO_MODE`/test-only flag that refuses to activate when `NODE_ENV=production`.

**Decision:** (c). Real adapters stay untouched and are selected when their keys exist; mocks are selected only in demo/test. The demo path also threads a correlation id through every stage.

**Why:** Mission requirement "make demo must run a full mock session with ZERO API keys"; mock-only-in-tests cannot prove the integration.

**Consequences:** Extra interface layer; a misconfigured production deploy cannot silently serve mock answers because the flag is rejected in production.

**Evidence:** `Makefile`, harness code, `docs/evidence/demo/`.

---

## ADR-005 — Add Stripe alongside Razorpay rather than replacing billing

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The target uses Stripe (`SPEC.md` §5 observed price payload / FAQ). HireShade's implemented, tested billing is Razorpay with an append-only credit ledger and idempotency tests.

**Options:** (a) replace Razorpay with Stripe (rewrite + migration risk); (b) keep Razorpay only and mark Stripe deferred; (c) provider interface: Razorpay retained, Stripe added with the same ledger and idempotency invariants.

**Decision:** (c).

**Why:** Protects the existing tested money path while meeting the observed target gateway. Ledger invariants (append-only, exactly-once) are shared, not duplicated.

**Consequences:** Two webhook surfaces and two config sets; both must be covered by tests. Documented in `docs/RUNBOOK.md`.

**Evidence:** `artifacts/api-server/src/routes/credits.ts` (Razorpay), Stripe module/tests, `docs/TEST_REPORT.md`.

---

## ADR-006 — Database-backed tests run serially against an explicit local container; Stripe gets its own database

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The integration suite uses fixed users (`user-a`/`user-b`) and truncates shared tables; concurrent runs collide (`credits_balance_user_id_unique` violations observed when two suites ran at once). A local container `hireshade-postgres` (Postgres 16, port 5433) exists and `.env` already points to it.

**Options:** (a) randomize users + per-test schema; (b) one serial suite against `hireshade_dev`; (c) (b) plus a dedicated `hireshade_stripe_test` database for parallel billing work.

**Decision:** (c); Vitest `fileParallelism: false` remains; a setup file loads `artifacts/api-server/.env`.

**Why:** Minimal change, matches the suite's documented contract ("run against a real Postgres"), avoids cross-agent interference.

**Consequences:** DB suites cannot run in parallel across agents; documented in the runbook. CI must provision Postgres.

**Evidence:** `docs/evidence/10-api-full-suite.txt`, `docs/evidence/09-api-integration-with-db.txt`, `artifacts/api-server/tests/setup/load-env.ts`.

---

## ADR-007 — Capture exclusion must use WDA_EXCLUDEFROMCAPTURE and be proven with an A/B capture

**Date:** 2026-10-20 · **Status:** accepted

**Context:** `WDA_MONITOR` (0x1) renders the window black in captures — itself a suspicious signal. The correct Windows primitive is `WDA_EXCLUDEFROMCAPTURE` (0x11, Windows 10 2004+). The existing `screen_protect.rs` used `WDA_MONITOR`, was not registered, and did not compile.

**Options:** (a) rely on Tauri/Electron framework config only; (b) use WDA_MONITOR; (c) explicit `WDA_EXCLUDEFROMCAPTURE` with runtime fallback and an A/B pixel-capture proof.

**Decision:** (c). Electron `setContentProtection(true)` already maps to 0x11; the proof is: same window region captured with stealth ON (absent) and OFF (visible), while CDP confirms the DOM is rendered in both.

**Why:** A screenshot that merely "looks empty" is not evidence; the A/B control makes the claim falsifiable. Affinity `0x11` is independently observable via `GetWindowDisplayAffinity`.

**Consequences:** Proof requires a real desktop session (not a headless container). Screenshots are stored under `docs/evidence/stealth/`.

**Evidence:** `docs/evidence/stealth/capture-proof.json`, `docs/evidence/stealth/window-region-*.png`, `scripts/capture-stealth-proof.ps1`.

---

## ADR-008 — Use the REA CLI (6.4.0 global, 6.7.0 checkout) instead of the absent MCP bindings

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The mission exposes REA as `mcp__rea__*`, but this session's tool surface has no such bindings. A local REA checkout (`rea/`, 6.7.0) is unbuilt; global `rea` 6.4.0 is installed and exposes capture/analysis commands.

**Options:** (a) stop and report the missing MCP; (b) build the 6.7.0 checkout (npm ci + build, heavy) ; (c) use the global CLI 6.4.0 for captures, document version/limitations, and fall back to curl/bundle analysis where a subcommand is unavailable.

**Decision:** (c) for this run; note the version gap in `docs/TARGET_VERIFIED.md`.

**Why:** The mission's own recovery order allows the CLI path; blocking on MCP would waste the install. Every finding still carries an evidence path/ID and a confidence label.

**Consequences:** No `--client dsh` integration; evidence lands as files under `docs/rea-evidence/` rather than an MCP registry. Version-specific gaps are marked UNKNOWN, not inferred.

**Evidence:** `rea --version` (6.4.0); `rea capture-browser-scenario --help`; `docs/TARGET_VERIFIED.md`.

---

## ADR-009 — macOS capture-exclusion verification is DEFERRED, not claimed

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Definition of Done asks for Windows **and** macOS recordings. The host is Windows 11; no Apple hardware or macOS VM/CI runner is available.

**Options:** (a) claim macOS from configuration only; (b) omit macOS; (c) implement the macOS path, add static/manifest tests, and document the exact verification procedure + deferred status with a reason.

**Decision:** (c). Tauri uses `contentProtected: true` + `macOSPrivateApi`; Electron uses `setContentProtection` with the documented CoreGraphics mapping. Neither is marked PASS on macOS.

**Why:** Rules forbid presenting inference as observation. The code path is testable statically; the runtime claim needs hardware.

**Consequences:** One DoD row stays DEFERRED with a precise reason and a runbook procedure.

**Evidence:** `tauri.conf.json` window config; `docs/GAP_MATRIX.md` G-007; `docs/RUNBOOK.md`.

---

## ADR-010 — Keep the question classifier heuristic-first

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Latency budget question→first token is 1.2 s; an LLM call for classification would consume most of it and add a failure mode.

**Options:** (a) LLM-only classifier; (b) heuristic-only; (c) deterministic heuristic/scoring as the primary gate, with the existing semantic/LLM path reserved for genuinely ambiguous utterances.

**Decision:** (c), and prove quality with a shipped labeled set (precision/recall thresholds in tests).

**Why:** Deterministic sub-millisecond classification keeps the budget; labeled-set metrics make the heuristic accountable.

**Consequences:** Heuristics need maintenance as new question styles appear; the labeled set is the regression guard.

**Evidence:** `docs/evidence/classifier/report.md`, classifier test.

---

## ADR-011 — One language registry drives ASR, prompt, and UI

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Language handling is duplicated in three places (`useFloatingSession.ts`, `FloatingApp.tsx`, `ActiveSession/page.tsx`), each mapping a handful of display names to codes; the target claims 50+ languages.

**Options:** (a) extend each mapper; (b) single registry module exported to web + API.

**Decision:** (b): `{ code, englishName, nativeName, deepgramLanguage, promptDirective, tier }×50+`; per-session selection persists and is threaded into the ASR connect payload and system prompt.

**Why:** Removes drift and makes the 50+ claim testable (registry size + uniqueness + per-tier smoke tests).

**Consequences:** Migrating old sessions must map legacy display names to codes.

**Evidence:** `artifacts/craft-vita/src/lib/languages.ts`, its test.

---

## ADR-012 — API tests get a real entrypoint and an explicit env loader

**Date:** 2026-10-20 · **Status:** accepted

**Context:** `pnpm --dir artifacts/api-server test` exited 0 with no output because no `test` script exists — a false-green trap. Vitest also does not inherit `node --env-file`.

**Options:** (a) leave it; (b) add `test` scripts and document `DATABASE_URL`; (c) scripts + a setup file that loads `artifacts/api-server/.env` when present.

**Decision:** (c). `test:unit` excludes the integration file; `test` runs everything.

**Why:** Removes the trap and makes the local suite one command.

**Consequences:** A missing DB now fails loudly instead of silently skipping; CI must provision Postgres or run `test:unit`.

**Evidence:** `artifacts/api-server/package.json`, `tests/setup/load-env.ts`, `docs/evidence/10-api-full-suite.txt`.

---

## ADR-013 — Treat the on-disk Supabase PAT as an incident

**Date:** 2026-10-20 · **Status:** accepted

**Context:** `artifacts/craft-vita/src-tauri/src/db access token.txt` contains what appears to be a live Supabase personal access token (69 bytes). It was never committed but sat in the source tree, and untracked files can leak via archives/screenshares.

**Options:** (a) delete it silently; (b) gitignore it and keep; (c) gitignore + delete from disk + add a secret-scan test + require rotation in the runbook.

**Decision:** (c) (deletion performed by Lead; rotation is the owner's action).

**Why:** If the token was ever valid and exposed outside the repo, deletion alone is insufficient. Secret scanning prevents recurrence.

**Consequences:** Rotation must happen externally; the scan test covers common token prefixes without embedding the value.

**Evidence:** `.gitignore`, `docs/RUNBOOK.md`, secret-scan test.

---

## ADR-014 — GAP_MATRIX is the single work queue; no parallel parity document

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Two missions arrived with overlapping documents (PARITY_MATRIX vs GAP_MATRIX vs REPO_STATUS). Duplicated tables drift.

**Options:** (a) keep three matrices; (b) one matrix keyed by requirement with target evidence + status + proving test; other docs link to it.

**Decision:** (b). `docs/GAP_MATRIX.md` is authoritative; `docs/REPO_STATUS.md` and `docs/CURRENT_STATE.md` are evidence snapshots; `docs/TARGET_VERIFIED.md` is the target-evidence ledger.

**Why:** One row per requirement, one proving test per row, one status.

**Consequences:** Other docs must reference rather than restate.

**Evidence:** `docs/GAP_MATRIX.md`.

---

## ADR-015 — Electron must be launched with ELECTRON_RUN_AS_NODE unset

**Date:** 2026-10-20 · **Status:** accepted

**Context:** First Electron launch crashed with `app.requestSingleInstanceLock is not a function` because the harness sets `ELECTRON_RUN_AS_NODE=1`, making electron.exe execute as plain Node.

**Options:** (a) patch main.js to detect and re-exec; (b) unset the env var in launch scripts and document it.

**Decision:** (b), encoded in the Electron dev/start scripts and the stealth verification scripts; `main.js` keeps a clear error if `app` is missing.

**Why:** The env var is agent-host configuration, not an app defect; re-exec would add fragility.

**Consequences:** Any automation that launches Electron must scrub the variable first.

**Evidence:** Electron launch logs; `artifacts/desktop-electron/scripts/`; runbook.

---

## ADR-016 — Pronunciation robustness: vocabulary-first, phonetic rescue, repair only when confidence is low, hedge over guess (W1 / EXT G-039)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Real interview failures concentrate on proper nouns and tech terms (Kubernetes, PostgreSQL, Nguyen, cache vs cash, SQL vs sequel) spoken with accents or dropped syllables. A confidently wrong answer is worse than a hedge.

**Options:** (a) always run an LLM repair on every segment; (b) vocabulary boosting + phonetic matching only; (c) layered: ASR keyword/n-best contract -> phonetic rescue against a domain vocabulary -> LLM repair ONLY for low-confidence segments (<150 ms budget) -> confidence gate that hedges or asks.

**Decision:** (c). High-confidence tokens are immutable; the repair pass is test-enforced to never mutate them. Unresolved material ambiguity produces a two-reading hedge or a 'heard X — did you mean Y?' overlay prompt, never a confident guess.

**Why:** Deterministic layers handle the bulk; the LLM is reserved for cases that need resume/JD context and is bounded, preserving the first-token budget.

**Consequences:** A 150+ utterance corpus and CI gate are required; residual wrong rescues are measured as the false-answer rate (<0.03) rather than assumed away.

**Evidence:** docs/PRONUNCIATION.md, corpus tests, repair-latency measurement.

---

## ADR-017 — Overlay auto-scroll is a framework-free state machine with a DOM adapter (W2 / EXT G-040)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Scroll logic mixed with rendering is where 'fighting the user' bugs live, and the old behavior was manual-only and untestable headlessly.

**Options:** (a) a React hook with effects; (b) a DOM-library scroll component; (c) a pure state machine (lock/unlock/pill/new-question/reset/persist) plus a thin DOM adapter driven by ResizeObserver and transform.

**Decision:** (c). Unlock is instant and total above a 24 px threshold; re-lock happens on pill click or manual return to bottom; layout is measured with ResizeObserver, never a polling timer; animation is transform-based and respects prefers-reduced-motion; the answer pane is ARIA live polite.

**Why:** Deterministic unit tests for every transition, one integration seam, no dependency.

**Consequences:** The demo overlay and the floating session pane share the same core; future UI must wire the adapter instead of reimplementing scroll math.

**Evidence:** docs/OVERLAY_SCROLL.md, headless 200-token test, recording under docs/evidence/.

---

## ADR-018 — Razorpay and Stripe share one entitlement ledger; gateway is data, not a code path (W3 / EXT G-041)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Stripe is the parity gateway from the target; Razorpay was already implemented and tested. Users must never double-spend across gateways and equivalent plans must grant identical entitlements.

**Options:** (a) separate balances per gateway; (b) replace Razorpay with Stripe; (c) one append-only ledger, exactly-once settlement keyed by provider event id, a plan-mapping table, and a gateway field on subscriptions so management/cancel routes to the issuer.

**Decision:** (c). Two distinct signature verifications are separate functions with separate secrets: checkout (order_id|payment_id HMAC) and webhook (raw-body HMAC from X-Razorpay-Signature). GST is computed in one module. Test-mode webhooks are documented with a localhost tunnel step.

**Why:** A shared ledger makes cross-gateway double-spend impossible by construction; keeping signature semantics separate avoids the common conflation.

**Consequences:** Schema gains gateway-scoped event tables; refunds become compensating ledger entries; existing Razorpay routes stay compatible.

**Evidence:** docs/RAZORPAY.md, dedicated-DB tests, cross-gateway entitlements test.

---

## ADR-019 — Gaze correction ships as a local MVP with a preview fallback; virtual-camera registration may be DEFERRED (W4 / EXT G-042)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The target build contains NO gaze or virtual-camera code (T-17, observed absence), so this is new IP. GAN redirection, head-pose, teeth/hair, multi-face, 4K and >30 fps are explicitly out of scope. DirectShow registration needs elevation and an MSVC build; macOS CMIO DAL needs a host we do not have.

**Options:** (a) attempt a full virtual-camera driver (high risk of blocking the release); (b) build nothing; (c) local warp+EMA pipeline with deterministic synthetic tests, a virtual-camera sink interface plus preview-only fallback, and platform registration documented or DEFERRED with exact reasons.

**Decision:** (c). Frames never leave the device; detector failure passes the frame through byte-identically; output resolution/fps is fixed; the effect is toggleable and strength-adjustable; reading mode boosts strength while tokens stream.

**Why:** The risky platform integration must not block W1-W3. A preview-only fallback with a working pipeline is honest; a half-registered COM filter is not.

**Consequences:** W4 is PARTIAL/DEFERRED where the OS device is not registered; the pipeline and tests still ship.

**Evidence:** docs/GAZE.md, synthetic displacement/jitter/latency tests, docs/raw/desktop/gaze-scan.json (target absence).

---

## ADR-020 — Extensions are tagged EXT and excluded from the parity score

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The mission adds four capabilities beyond the target. Mixing them into the parity PASS count would inflate the score dishonestly.

**Options:** (a) add them as ordinary rows; (b) separate document; (c) same GAP_MATRIX with new IDs (G-039+) and an EXT tag, counted separately.

**Decision:** (c). Parity remains 21 PASS / 12 PARTIAL / 5 DEFERRED for G-001..G-038; extension status is reported separately for G-039..G-042.

**Why:** One work queue, honest scoring.

**Consequences:** docs/TEST_REPORT.md shows both tallies.

**Evidence:** docs/GAP_MATRIX.md, docs/TEST_REPORT.md.

---

## ADR-021 — Overlay size and capture invisibility are treated as two independent claims (EXT G-044..G-050)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** A larger overlay increases the captured surface area, and transparency is the property most likely to break capture exclusion in some stacks. The two requirements fight each other; assuming either survives scaling would be dishonest.
**Options:** (a) scale first and spot-check screenshots; (b) verify OS affinity once; (c) assert the OS-level exclusion state after EVERY resize/preset/move/display transition, run A/B recordings at the largest presets, and build an honest capture-path matrix that labels untested paths UNTESTED.

**Decision:** (c). Electron re-asserts setContentProtection on every transition and a Win32 probe asserts 0x11 after each one. Compatibility mode (opaque surface, solid scrim, no blur/rounded compositing) and a fallback ladder are the user-facing escape hatch. Any capture path that cannot be exercised on this host is documented as UNTESTED, never as passing.

**Why:** The product promise is invisibility; a single unverified capture path is a product-level risk. Empirical, per-transition evidence is the only defensible claim.

**Consequences:** Compatibility mode is a second rendering path to test; the capture matrix contains explicit gaps (DXGI, macOS, elevated apps) rather than false greens.

**Evidence:** docs/CAPTURE_MATRIX.md, docs/OVERLAY_SIZE.md, docs/evidence/overlay-size/ (affinity JSON + A/B recordings).

---

## ADR-022 — Presets are a pure model with layout tokens; BANNER is the default (EXT G-044/G-045)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The user reads the overlay while speaking. Density is not the goal; glanceability is. The overlay must also remain non-obstructive and persist across restarts.

**Options:** (a) one resizable window with user-set font size; (b) five hard-coded React layouts; (c) a pure preset model (geometry, typography tokens, scrim, opacity) + one DOM adapter, persisted per preset, with BANNER as default for the big-and-readable case.

**Decision:** (c). Typography is expressed in tokens and scales with DPI; auto-fit prevents clipping for long answers; the speakable formatter enforces hook/bullets/pushback shape. TELEPROMPTER places the band near the webcam; SIDE COLUMN and READING cover coding and long technical cases.

**Why:** One model is testable headlessly and reusable by the demo page and the Electron/Tauri shells; hard-coded layouts drift.

**Consequences:** Preset geometry is data, not markup; tests assert computed styles at 100/125/150/200% DPI.

**Evidence:** docs/OVERLAY_SIZE.md, preset/readability tests, Electron computed-style evidence.

---

## ADR-023 — CI latency gate for gaze measures per-frame CPU time, not wall clock, under the parallel suite

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The gaze latency test runs inside the full 616-test frontend suite on a shared CPU. Wall-clock deltas were observed at 36 ms p95 while the isolated collector measured p95 6.30 ms and per-frame CPU cost ~4 ms; the excess is scheduler preemption, not the pipeline.
**Options:** (a) raise the wall-clock budget (dishonest); (b) skip the test in CI (no guard); (c) gate on per-frame process CPU time (<25 ms) and keep a loose wall-clock backstop, with the authoritative wall-clock numbers produced by the isolated collector.

**Decision:** (c). The test asserts CPU p95/mean <25 ms plus wall p95 <100 ms; docs/evidence/gaze/latency.json remains the authoritative wall-clock measurement (p50 3.54 / p95 6.30 ms).

**Why:** CPU time is what the product controls per frame; wall-clock under a saturated CI host is not a signal about the code.

**Consequences:** The CI gate can no longer catch a pure scheduler-induced latency regression, which is acceptable because the isolated collector does.

**Evidence:** artifacts/craft-vita/src/gaze/latency.test.ts, docs/evidence/gaze/latency.json.

---

## ADR-024 — Affinity mode stays 0x11; 0x01 is unreachable for the product surface and is not shipped as a per-app switch (EXT G-051)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** WDA_EXCLUDEFROMCAPTURE (0x11) is the shipped mode, but DXGI Desktop Duplication ignores it. The sprint asked whether WDA_MONITOR (0x01) — which renders a black box — would be honoured where 0x11 is ignored.

**Options:** (a) expose a per-app affinity picker; (b) test 0x01 in-process and switch globally if it wins; (c) keep 0x11, record 0x01 as unreachable/untested for the Electron surface, and solve DXGI with routing rather than a second affinity mode.

**Decision:** (c). Electron exposes only setContentProtection(bool) (=0x00/0x11); an out-of-process SetWindowDisplayAffinity(0x01) is rejected with ERROR_ACCESS_DENIED because the window belongs to another process. Until an in-process native path is shipped and verified, 0x01 remains UNTESTED-BLOCKED. DXGI is documented as unfixable by affinity/opacity; routing (second monitor or window/tab share) is the mitigation.

**Why:** Shipping an unverified mode picker would imply a protection we have not proven. The honest routing path is stronger than a black-box that cannot be reached.

**Consequences:** No per-app affinity switch in this release; CAPTURE_MATRIX records the 0x01 blocker precisely; a native in-process experiment is a future task.

**Evidence:** docs/CAPTURE_MATRIX.md 3x4 grid + UNTESTED notes, docs/evidence/capture-sprint/.

---

## ADR-025 — Runtime pre-flight returns exactly GREEN/AMBER/RED and never claims automatic capture detection (EXT G-053)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The capture matrix showed different failure modes (DXGI ignores exclusion; black-bar on PrintWindow; excluded transparent surfaces can render black). A user about to sit an interview cannot read a markdown file, and the app cannot observe which capture API another process uses.

**Options:** (a) claim automatic detection; (b) a generic warning banner; (c) a pre-flight evaluator with three plain-language verdicts driven by displays + a versioned tested-app list + user report, with one-click actions, honest 'cannot detect the path' copy, and a black-bar self-check pattern.

**Decision:** (c). A second display is the default recommendation whenever present (structurally unbeatable). AMBER carries exactly one action; RED carries one or two. The tested-app list is data (versioned, tested-on date), not code. Compatibility mode is suggested for black-bar risk, window-share for DXGI risk.

**Why:** It turns a documented limitation into an actionable setup decision without lying about detection.

**Consequences:** The list needs periodic re-testing and a date stamp; self-check remains the human ground truth.

**Evidence:** docs/evidence/capture-sprint/preflight/, src/overlay/preflight/.

---

## ADR-026 — Honest undetectability claim is a dated evidence statement, not a marketing number (EXT G-056)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** The target claims "100% undetectable". Our matrix shows a real DXGI failure and multiple untested paths.

**Decision:** Publish docs/UNDETECTABILITY_CLAIM.md: proven rows with numbers, known failures, UNTESTED/BLOCKED list, and one defensible sentence. Never state a platform/path as protected unless a row with method exists.

**Why:** A false invisibility claim is worse than a narrow true one for a product used in live interviews.

**Consequences:** Every new capture path or platform must add a row + date before the claim can be widened.

**Evidence:** docs/UNDETECTABILITY_CLAIM.md, docs/CAPTURE_MATRIX.md.

---

## ADR-027 — Recreation crash fixed structurally; opaque-capture claim withheld until measured (EXT G-052)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** Runtime recreation of the floating surface for compatibility mode crashed Electron, so the opaque path could only be reached on next launch. The crash was the blocker for verifying whether an opaque surface removes the PrintWindow black rectangle.

**Root cause class:** destroying a protected surface synchronously inside the IPC handler the renderer awaited; the old window's late `closed` handler deleting the replacement's map entries; protected-surface/GPU swap race; recreated opaque window missing `ready-to-show`.

**Decision/fix:** clear `setContentProtection(false)` before teardown; recreate only after `closed` + 30 ms (60 ms IPC defer, 750 ms fallback); identity-guard map deletions in `closed`; force-show on `did-finish-load`; keep recreation opt-in (`HIRESHADE_COMPAT_RECREATE=1`) until measured.

**Claim status:** the root-cause fix is code-complete, but the opaque-capture measurement is BLOCKED (repro harness hangs waiting for the recreated page target). G-052 is PARTIAL; the PrintWindow black-bar limitation stays in CAPTURE_MATRIX and the claim doc.

**Evidence:** `artifacts/desktop-electron/main.js` diff, `docs/CAPTURE_MATRIX.md` §3, `scripts/capture-matrix/repro-recreate.mjs`.

---

## ADR-028 — Ship black box mode (WDA_MONITOR 0x01) as the DXGI fallback (EXT G-057)

**Date:** 2026-10-20 · **Status:** accepted

**Context:** DXGI Desktop Duplication ignores WDA_EXCLUDEFROMCAPTURE (0x11). U1 asked whether WDA_MONITOR (0x01) is honoured where 0x11 is not. In-process koffi on the app's own HWND (readback 0x1) measured: DXGI overlay region mean luma 0.01, 100 percent black, versus 0x11 27.39 luma with content visible; GDI and PrintWindow also all-black under 0x01.

**Options:** (a) leave DXGI as an unavoidable leak and rely only on monitor/window-share routing; (b) ship a hidden debug-only mode; (c) ship a user-selectable, persisted black box mode offered by the pre-flight for DXGI-risk setups.

**Decision:** (c). One native code path (applyStealth -> koffi SetWindowDisplayAffinity) supports 0x00/0x01/0x11; the mode is persisted in captureState.affinityMode and re-asserted on the same triggers. The pre-flight offers Turn on black box mode for known-ignoring/high-risk single-display setups. Copy states the trade-off plainly: a black rectangle is discoverable, but answer text does not leak.

**Why:** For DXGI capture, visible answers are worse than a black rectangle. The alternative routing (monitor 2/window share) remains the default recommendation where available.

**Consequences:** Black box mode depends on koffi/user32 (fallback to setContentProtection with 0x11 if unavailable); it is not claimed to defeat kernel proctoring; macOS unaffected (no 0x01 path shipped there).

**Evidence:** docs/CAPTURE_MATRIX.md section 1b, docs/evidence/capture-sprint/native-affinity-dxgi.json, UNDETECTABILITY_CLAIM.md.