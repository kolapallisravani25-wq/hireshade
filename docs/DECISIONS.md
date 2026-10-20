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
