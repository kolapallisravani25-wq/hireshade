# HireShade Final Security and Validation Audit

Audit date: 2026-08-04 (Asia/Calcutta)  
Repository: `C:\Users\user\Desktop\hireshade`  
Scope: security review, targeted repairs, local validation, Windows/Tauri packaging, and preservation of pre-existing work.  
Conclusion: **not release-ready**. Incremental repair is recommended; a rewrite is not justified.

No secret values are included in this report.

## 1. Initial branch, HEAD, and working tree

- Initial branch: `fix/windows-reopen-compile`
- Initial HEAD: `a0e84683dc5c76901905b9e896c7c517d0936665` (`fix(desktop): restore auth and AI streaming flow on Windows`)
- A second worktree was present at `C:\Users\user\Desktop\hireshade-emitto-fix`, branch `fix/craft-vita-emitto-stub`, HEAD `4444913`. It was not modified.
- Initial dirty files:
  - `artifacts/craft-vita/src-tauri/entitlements.plist`
  - `artifacts/craft-vita/src-tauri/src/lib.rs`
  - `artifacts/craft-vita/src-tauri/tauri.conf.json`
  - `artifacts/craft-vita/src/components/auth/DesktopAuthHydrator.tsx`
  - `artifacts/craft-vita/src/features/session/audio/audioSessionController.ts`
  - `artifacts/craft-vita/src/features/session/hooks/useFloatingSession.ts`
  - `artifacts/craft-vita/src/features/session/slices/floatingSessionSlice.ts`
  - `artifacts/craft-vita/src/pages/DesktopAuth/DesktopAuthHandoff.tsx`
  - `artifacts/craft-vita/vite.config.ts`
  - untracked `artifacts/craft-vita/src/features/session/audio/audioSessionController.test.ts`
- Initial `git diff --check`: passed; Git emitted only LF-to-CRLF working-copy warnings.

## 2. Previous Codex changes found

The pre-existing dirty work restores/fixes Windows-compatible Tauri development, native session persistence locking, macOS reopen compilation guards, audio stop behavior, overlay auto-scroll, and Vite target-directory watching. Two auth files are status-only/line-ending changes with no semantic diff. The untracked audio controller test verifies the replacement for a missing native `stop_all_audio_transcription` command.

The branch name and previous HEAD also show an earlier Windows auth/AI streaming repair. None of this work was discarded. The audit staged overlapping files hunk-by-hunk so that only audit-owned security changes entered the new commits.

## 3. Previous work preserved, changed, or removed

- Preserved: all ten initial dirty entries and the second worktree.
- Changed temporarily, then restored: the old local Tauri wrapper auto-bumped source version `0.1.22` to `0.1.23` during validation. The source files and lockfile were restored to `0.1.22` before commits.
- Removed by the audit because they were defective repository implementations, not user work:
  - `artifacts/craft-vita/scripts/tauri-wrapper.cjs` — mutated version-controlled files as a side effect of build validation.
  - `scripts/ci-patch-tauri-build.sh` — stale CI source-rewriting compatibility patch that could silently diverge source and packaged code.
- No previous dirty hunk was committed by the audit.

## 4. Feature implementation matrix

Every row has exactly one classification.

| Feature/security boundary | Classification | Evidence/status |
|---|---|---|
| Project PATCH mass assignment | complete and verified | Explicit writable-field mapper; malicious `userId`/`version` dropped; unit and integration coverage pass. |
| Cross-tenant ownership for audited project/resume/session/answer mutations | complete and verified | Ownership-scoped queries and IDOR integration tests pass. |
| Deepgram master key embedded in frontend/native builds | complete and verified | Build-time key path and CI secret exposure removed; native commands accept request-scoped minted credentials; four artifact-secret scans returned zero matches. |
| Desktop refresh token storage | implementation exists but is broken | A 60-day bearer refresh token is stored in `localStorage`; OS secure storage is not implemented. |
| Loopback desktop auth callback | implementation exists but is broken | Bearer refresh token is placed in `desktop_refresh` query text on `http://localhost:<port>/`, exposing it to history/logging surfaces. |
| Content Security Policy | implementation is missing | Tauri config remains `"csp": null`. |
| Tauri capability scoping | implementation is incomplete | Wildcard window scope was removed, but every real window still shares broad opener, window/webview creation, updater-install, dialog, and restart rights. |
| Production CORS policy | configuration-only blocker | Code now fails closed without an allowlist; local environment has no `CORS_ORIGINS`, so production origins must be configured. |
| Expensive AI endpoint metering | complete and verified | Model calls moved behind charge/refund wrapper; structural and database-backed tests pass. |
| AI rate limiting | implementation is incomplete | Per-user/per-operation fixed-window limiter exists, but it is process-local and no global/public API or shared-store limiter exists. |
| Upload validation | implementation is incomplete | Size/MIME/magic validation exists; DOCX ZIP internals are not validated and DOC/DOCX resume parsing remains mismatched with PDF-only context extraction. |
| Payment idempotency | complete and verified | HMAC, ownership, conditional settlement, row locking, replay handling, and unique order/payment indexes pass disposable-Postgres tests. Production must apply the schema change after checking for duplicates. |
| Updater signature chain | configuration-only blocker | Manifest now advertises only signed updater archives and workflow collects correct files; local build lacked `TAURI_SIGNING_PRIVATE_KEY`, so no signed archive was produced. |
| Sensitive interview/provider/payment logging | implementation is incomplete | Question/transcript bodies, provider response bodies, order/payment IDs, and key fingerprints were redacted; 496 log sites remain, including user/session identifiers and raw error objects. |
| Current build artifacts containing configured secrets | complete and verified | Frontend dist, API dist, release EXE, and MSI had zero matches for the four configured server secrets. |
| Orval generated client consistency | suspicious duplicate or generated code | Installed Orval is `8.9.1`; checked generated markers report `8.5.3`. Regenerate rather than hand-edit. |
| Windows package version consistency | implementation exists but is broken | The validation MSI is `0.1.23`, while restored source is `0.1.22`; the artifact is evidence only and must not be released. |
| Browser-authenticated/streaming UI flows | blocked from runtime verification | Installed Browser workflow had no connected backend; authenticated credentials were intentionally not entered. |

## 5. Audit finding status before and after repair

| Finding | Before | After |
|---|---|---|
| Project update trusted arbitrary body fields | High: exploitable mass assignment | Fixed and tested through a shared whitelist mapper. |
| Expensive AI work ran before credit enforcement on several routes | High: repeatable unpaid compute | Fixed with charge-first/refund-on-failure boundary; tests pass. |
| Deepgram master key compiled into native binary/CI bundle | Critical credential disclosure design | Removed; request-scoped minted credential is passed through Tauri IPC. Rotation is still recommended for any key used by vulnerable builds. |
| Updater manifest pointed at unsigned installers | Critical update-chain mismatch | Fixed to signed Tauri updater archives only; actual signing remains blocked by missing private key. |
| Payment identifiers lacked database uniqueness | High integrity risk | Fixed with native unique indexes and disposable-Postgres tests. |
| Uploads trusted MIME/name alone | High parser/content spoofing risk | Magic-byte checks added; archive-structure and parser parity remain. |
| Production CORS defaulted permissive | High browser-origin exposure | Fails closed in production; allowlist configuration remains. |
| Question/transcript/provider response bodies logged | High privacy/credential-adjacent risk | Targeted content removed and guarded by tests; broader logging policy remains. |
| Tauri build mutated source and stale CI patch rewrote Rust | High release reproducibility risk | Wrapper and patch deleted; direct CLI and manifest regression test used. |
| Tauri capability wildcard | High blast-radius risk | Window wildcard removed; permission partitioning remains. |

## 6. Root cause and fix for every repaired defect

1. **Mass assignment** — Root cause: `PATCH /projects/:id` spread `req.body` into the Drizzle update. Fix: `buildProjectUpdates` admits only `title`/frontend `position`, `description`, and `content`.
2. **Economic AI bypass** — Root cause: several routes called OpenRouter before charging. Fix: route all such work through `withCharge`, which charges first and refunds when work throws.
3. **AI request flooding** — Root cause: authenticated expensive routes lacked request budgets. Fix: a minimal fixed-window limiter covers credited operations, session AI/screen/analytics/preview, and Deepgram credential minting. Its process-local ceiling is documented.
4. **Embedded Deepgram key** — Root cause: `option_env!`/dotenv and workflow environment compiled a master key into distributable code. Fix: remove build/runtime master-key loading and pass a server-minted request credential to native commands.
5. **Updater artifact mismatch** — Root cause: release manifest treated MSI/EXE installers as updater payloads. Fix: only signed `.app.tar.gz`, `.msi.zip`/`.nsis.zip`, and `.AppImage.tar.gz` artifacts can enter the updater platform map.
6. **Release source mutation** — Root cause: local wrapper auto-bumped three files before knowing build success, and CI patched Rust source dynamically. Fix: invoke installed Tauri CLI directly and delete both mutation mechanisms.
7. **CORS permissive default** — Root cause: missing `CORS_ORIGINS` meant allow-all in every environment. Fix: production now returns `origin: false`; development remains permissive.
8. **Upload content spoofing/orphan objects** — Root cause: validation trusted MIME and persisted remote objects before all durable writes completed. Fix: check magic bytes before storage/AI work and remove a resume object when DB insertion fails.
9. **Payment duplicate identifiers** — Root cause: application settlement was conditional, but provider IDs had no native uniqueness. Fix: unique indexes for nullable `order_id` and `payment_id`, verified in disposable PostgreSQL.
10. **Sensitive logs** — Root cause: debugging emitted complete payloads, transcripts, questions, provider bodies, order IDs, and key fingerprints. Fix: retain only status, counts, lengths, source labels, and non-content metadata; add structural regression tests.
11. **Tauri wildcard capability** — Root cause: one capability applied to `*`. Fix: limit it to `main`, `mini`, `launcher`, and `floating`.

## 7. Confirmed missing implementations

- CSP policy for the Tauri webviews.
- OS-backed secure storage for desktop refresh credentials.
- One-time loopback authorization code and server-side exchange/rotation flow.
- Shared/distributed rate limiter and general unauthenticated API/edge limiter.
- Migration history/rollout mechanism; the repository currently uses Drizzle push.
- Full DOCX container validation and DOC/DOCX resume text extraction.
- Per-window Tauri capability manifests.

## 8. Existing but broken or incomplete implementations

- Desktop auth handoff exposes a long-lived bearer token through localStorage and loopback query text.
- Tauri capabilities remain broad despite correct window scoping.
- AI limiter resets per API process and is per operation, so horizontal replicas multiply the budget.
- Sensitive logging still includes pseudonymous user/session IDs and raw error objects at some sites.
- Build workflow installs with `--no-frozen-lockfile`, allowing dependency drift in release jobs.
- The generated validation MSI has version `0.1.23`, but source is `0.1.22`.
- Resume upload accepts DOC/DOCX although downstream resume-context extraction is PDF-oriented.

## 9. Configuration-only blockers

- Set an explicit production `CORS_ORIGINS` list containing only the deployed web and confirmed Tauri origins.
- Supply `TAURI_SIGNING_PRIVATE_KEY` and its password through secure CI/local secret handling; never commit them.
- Confirm the updater public key corresponds to the supplied private key and execute a signed update test.
- Configure production `PUBLIC_BACKEND_URL` as HTTPS and confirm the private release repository token.
- Apply the new payment unique indexes after checking production for duplicate non-null provider IDs.

## 10. Duplicate or suspicious AI/generated code

- Deleted stale `scripts/ci-patch-tauri-build.sh`; it rewrote source during CI and could hide source/package divergence.
- Deleted `tauri-wrapper.cjs`; it was a side-effectful compatibility wrapper rather than a build tool.
- Orval generator version drift (`8.5.3` markers vs installed `8.9.1`) makes generated clients suspicious until regenerated with the installed version.
- No duplicate page was committed. The pre-existing untracked audio test is purposeful and was preserved.

## 11. Frontend/backend/native/database contract mismatches

- Fixed: frontend project `position` now maps to backend project `title` without accepting arbitrary fields.
- Fixed: frontend already passed `apiKey`; native transcription commands now accept and validate it.
- Fixed: updater API/workflow now agree on signed `.msi.zip` rather than raw MSI/EXE.
- Fixed: payment application idempotency now has matching database uniqueness constraints.
- Remaining: DOC/DOCX accepted by upload boundary but not proven extractable by resume context.
- Remaining: Orval generated-client version mismatch.
- Remaining: repository has no migration history, so schema source and a deployed database can diverge.

## 12. Security risks still requiring production configuration or implementation

### High

- Long-lived desktop refresh bearer in localStorage.
- Bearer token in loopback callback query.
- CSP disabled.
- Broad shared Tauri permissions.
- No signed updater artifact was produced or installed during this audit.

### Medium

- Process-local AI limiter and absent global/edge rate limiting.
- Remaining identifiers/raw errors in logs.
- DOCX signature check proves ZIP, not a valid DOCX package.
- Release dependency install is not lockfile-frozen.
- Existing production data must be checked before applying unique payment indexes.

## 13. Windows-specific risks

- `cargo fmt --check` fails with 1,800 lines of formatting output, mainly in `src/deepgram.rs` and `src/lib.rs`. Running `cargo fmt` would create a large formatting-only change and was intentionally not done.
- Tauri warns that identifier `org.hireshade.app` ends in `.app`, which conflicts with the macOS bundle extension convention.
- The Windows MSI was built, but updater archive signing failed because the private key was absent.
- The produced MSI is version-mismatched and must not be released.
- The pre-existing Windows `beforeDevCommand`, cfg-gated reopen fix, and audio-stop repair remain unstaged.
- Only unauthenticated launcher startup was rendered; install/uninstall, upgrade, microphone/system-audio permissions, callback auth, and signed update were not exercised.

## 14. Test coverage gaps and features that compile but are not proven functional

- Clerk sign-in/sign-out/token renewal in an installed Tauri app.
- One-time desktop callback and token revocation (not implemented).
- Live Deepgram microphone/system-audio streaming.
- Live OpenRouter generation, timeouts, refunds, and provider rate errors.
- Live Razorpay order, browser checkout, webhook delivery, and concurrent browser/webhook settlement.
- GitHub private-release download proxy and end-to-end signed updater installation.
- Production CORS origin list.
- CSP compatibility with Clerk, Razorpay, Tauri schemes, and API endpoints.
- Per-window capability denial tests.
- Malicious DOCX archive structure, decompression bombs, and parser fuzzing.
- Installer install/upgrade/uninstall and Windows permission prompts.
- Browser/component tests for auth, streaming, loading states, error states, and auto-scroll. The preserved audio-stop unit test passed, but auto-scroll remains pre-existing unstaged work.

## 15. Analysis of every current unstaged file

| File | Purpose of current change | Risk/recommendation |
|---|---|---|
| `src-tauri/entitlements.plist` | Branding comment changes ScribeShade to HireShade. | Low; comment-only, but preserve/review with macOS signing batch. |
| `src-tauri/src/lib.rs` | Adds native auth file lock/path validation and cfg-gates macOS reopen so Windows compiles. | Medium/high; useful, but session ID is still plaintext and this unstaged hunk is needed for clean Windows native compilation. Review and commit separately. |
| `src-tauri/tauri.conf.json` | Replaces Unix `env ...` development command with a Windows-compatible Vite command. | Low/medium; correct for Windows, but separate from the committed production command. |
| `src/components/auth/DesktopAuthHydrator.tsx` | Status-only/line-ending change; no semantic diff. | Do not commit as line-ending-only. |
| `src/features/session/audio/audioSessionController.ts` | Replaces missing native `stop_all_audio_transcription` with two supported stop commands and warning aggregation. | Medium; fixes an actual missing command, has a preserved unit test, should be a separate audio lifecycle commit. |
| `src/features/session/audio/audioSessionController.test.ts` | Tests both native stop calls and partial failure. | Low; purposeful test, currently untracked, passed 2/2. |
| `src/features/session/hooks/useFloatingSession.ts` | Makes auto-scroll follow newly appended answers and jumps to latest when re-enabled. | Medium UX/state risk; needs rendered/component coverage before commit. |
| `src/features/session/slices/floatingSessionSlice.ts` | Uses the new two-command audio-stop helper when ending/recovering a session. | Medium; logically paired with audio controller/test. |
| `src/pages/DesktopAuth/DesktopAuthHandoff.tsx` | Status-only/line-ending change; no semantic diff. | Do not commit as line-ending-only. The existing file also contains the unresolved loopback token leak. |
| `vite.config.ts` | Excludes Rust `target` from Vite watching. | Low; reduces rebuild/watch churn, separate tooling commit. |

## 16. Exact files modified/created by the audit

### Commit `2eec14de3b316b6e4680c1c8684d8bc91de053f6` — API trust and billing

- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/lib/aiRateLimit.ts` (created)
- `artifacts/api-server/src/lib/corsPolicy.ts` (created)
- `artifacts/api-server/src/lib/featureCredits.ts`
- `artifacts/api-server/src/lib/groundingGuard.ts`
- `artifacts/api-server/src/lib/projectUpdates.ts` (created)
- `artifacts/api-server/src/lib/purchaseCredit.ts`
- `artifacts/api-server/src/lib/uploadValidation.ts` (created)
- `artifacts/api-server/src/routes/ai.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/credits.ts`
- `artifacts/api-server/src/routes/documents.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/resumes.ts`
- `artifacts/api-server/src/routes/sessions.ts`
- `artifacts/api-server/tests/aiRateLimit.test.ts` (created)
- `artifacts/api-server/tests/corsPolicy.test.ts` (created)
- `artifacts/api-server/tests/economicAiBoundaries.test.ts` (created)
- `artifacts/api-server/tests/groundingGuard.structural.test.ts`
- `artifacts/api-server/tests/projectUpdates.test.ts` (created)
- `artifacts/api-server/tests/sensitiveLogging.test.ts` (created)
- `artifacts/api-server/tests/sessions.integration.test.ts`
- `artifacts/api-server/tests/uploadValidation.test.ts` (created)
- `lib/db/src/schema/index.ts`

### Commit `b51353677687d27a657b181cbf8645815bff0cbb` — desktop credentials/updater

- `.github/workflows/desktop-build.yml`
- `artifacts/api-server/src/lib/desktopManifest.ts` (created)
- `artifacts/api-server/src/routes/desktop.ts`
- `artifacts/api-server/tests/desktopManifest.test.ts` (created)
- `artifacts/craft-vita/package.json`
- `artifacts/craft-vita/scripts/tauri-wrapper.cjs` (deleted)
- `artifacts/craft-vita/src-tauri/Cargo.lock`
- `artifacts/craft-vita/src-tauri/Cargo.toml`
- `artifacts/craft-vita/src-tauri/capabilities/default.json`
- `artifacts/craft-vita/src-tauri/src/lib.rs` (security hunks only)
- `artifacts/craft-vita/src-tauri/tauri.conf.json` (production-build hunk only)
- `artifacts/craft-vita/src/features/session/hooks/useFloatingSession.ts` (key-fingerprint hunks only)
- `artifacts/craft-vita/src/lib/deepgramAuth.ts`
- `artifacts/craft-vita/src/tauriSecurityManifest.test.ts` (created)
- `scripts/ci-patch-tauri-build.sh` (deleted)

### Commit `7fc980e5547f8251e274e44f1516504da4992985` — frontend log redaction

- `artifacts/craft-vita/src/features/session/hooks/useFloatingSession.ts` (log-redaction hunks only)
- `artifacts/craft-vita/src/hooks/useAIChat.ts`
- `artifacts/craft-vita/src/pages/Sessions/ActiveSession/page.tsx`
- `artifacts/craft-vita/src/sensitiveLogging.test.ts` (created)

## 17. Tests added

- `artifacts/api-server/tests/aiRateLimit.test.ts`
- `artifacts/api-server/tests/corsPolicy.test.ts`
- `artifacts/api-server/tests/desktopManifest.test.ts`
- `artifacts/api-server/tests/economicAiBoundaries.test.ts`
- `artifacts/api-server/tests/projectUpdates.test.ts`
- `artifacts/api-server/tests/sensitiveLogging.test.ts`
- `artifacts/api-server/tests/uploadValidation.test.ts`
- payment provider-ID uniqueness case in `sessions.integration.test.ts`
- sensitive-value redaction assertions in `groundingGuard.structural.test.ts`
- `artifacts/craft-vita/src/sensitiveLogging.test.ts`
- `artifacts/craft-vita/src/tauriSecurityManifest.test.ts`
- Rust `transcription_requires_a_request_scoped_key` test in `src-tauri/src/lib.rs`

The pre-existing untracked `audioSessionController.test.ts` was not created or committed by this audit, but it was run and passed.

## 18. Exact validation commands and results

| Command | Result |
|---|---|
| `git status --short` | Run initially, before every commit, and finally. Final output is recorded below. |
| `git diff --stat` | Run before each commit and finally. |
| `git diff --check` | Pass; only LF-to-CRLF warnings. |
| `git diff` | Fully reviewed before each commit; cached diffs were also reviewed. |
| `pnpm run typecheck` (repo root) | Pass; 4 artifact/script packages plus TS project references. Final rerun: 36.4 s. |
| `pnpm test` (frontend package) | Pass: 7 test files, 44 passed, 0 failed, 0 skipped. |
| `pnpm exec vitest run` (API package, disposable PostgreSQL) | Pass: 17 test files, 151 passed, 0 failed, 0 skipped. Final run: 16.91 s. |
| `pnpm build` (frontend) | Pass: Vite 7.3.3, 5,427 modules, final 82 s. |
| `pnpm build` (API) | Pass: `dist/index.mjs` 2.8 MB warning, final 14 s. |
| `pnpm --filter @workspace/db run push-force` | Pass against disposable PostgreSQL 16; schema changes applied. |
| `cargo fmt --check` | **Fail**: exit 1, 1,800 output lines of pre-existing formatting drift. |
| `cargo check` | Pass: exit 0; final incremental run 1m34s. |
| `cargo test` | Pass: 7 passed, 0 failed, 0 ignored; main/doc targets had 0 tests. Final incremental run 1m42s. |
| `pnpm tauri build` | **Partial/fail** after 934.7 s: release EXE and MSI built; updater signing then failed because the private key was absent. |
| Secret-safe current artifact scan | Pass: 0 matches each for `CLERK_SECRET_KEY`, `OPENROUTER_API_KEY`, `DEEPGRAM_API_KEY`, `DESKTOP_TOKEN_SECRET`. |

### Frontend test files

- `src/sensitiveLogging.test.ts`
- `src/tauriSecurityManifest.test.ts`
- `src/features/session/audio/systemHealth.test.ts`
- `src/features/session/audio/captureStatus.test.ts`
- `src/types/ai-answer.test.ts`
- `src/features/session/audio/audioSessionController.test.ts` (pre-existing/untracked)
- `src/lib/transcript-stabilizer.test.ts`

Total: 44 passed, 0 failed, 0 skipped.

### API test files

- `tests/sessions.integration.test.ts`
- `tests/sessionCredits.test.ts`
- `tests/clerkAuth.test.ts`
- `tests/groundingGuard.structural.test.ts`
- `tests/uploadValidation.test.ts`
- `tests/sensitiveLogging.test.ts`
- `tests/economicAiBoundaries.test.ts`
- `tests/groundingGuard.extended.test.ts`
- `tests/aiRateLimit.test.ts`
- `tests/projectUpdates.test.ts`
- `tests/groundingGuard.test.ts`
- `tests/corsPolicy.test.ts`
- `tests/desktopManifest.test.ts`
- `tests/answeredQuestionMemory.test.ts`
- `tests/questionReadiness.test.ts`
- `tests/openrouterModelSlug.test.ts`
- `tests/interviewPrompt.test.ts`

Total: 151 passed, 0 failed, 0 skipped.

### Build warnings

- Frontend mixed static/dynamic import warnings:
  - Tauri event stub/API module.
  - `pages/Auth/SignIn/page.tsx`.
- Frontend chunks larger than 500 kB, including:
  - `page-0VUs8Zj_.js`: 4,067.89 kB (gzip 1,106.35 kB).
  - `data-table-_DIdySqy.js`: 1,161.82 kB.
  - `index-CaKZxCkp.js`: 780.42 kB.
  - `prism-DFHUxksn.js`: 777.89 kB.
- API `dist/index.mjs`: 2.8 MB.
- Tauri identifier ends in `.app` warning.

### Windows package outputs

- Executable: `C:\Users\user\Desktop\hireshade\artifacts\craft-vita\src-tauri\target\release\hireshade.exe` — 20,047,872 bytes.
- MSI: `C:\Users\user\Desktop\hireshade\artifacts\craft-vita\src-tauri\target\release\bundle\msi\HireShade_0.1.23_x64_en-US.msi` — 8,269,824 bytes.
- No `.msi.zip` or `.sig` was produced because signing failed.
- These artifacts are validation evidence only. The MSI version does not match source and must not be published.

## 19. Browser and Windows runtime flows tested

- Browser workflow: blocked. Browser runtime initialized, but the selected extension disappeared and `agent.browsers.list()` returned `[]`. No credentials, cookies, local storage, callback values, or profiles were inspected.
- Windows executable: the exact release EXE was launched as a distinct process and remained running.
- Windows UI observation: Computer Use uniquely selected the release-path window and observed the unauthenticated launcher with `HireShade`, `Login to your HireShade account to start your interview`, and a `Login` button.
- No login button was clicked and no credential was entered.
- Both validation-launched HireShade processes and the local Vite preview were stopped.
- Not tested: authenticated dashboard, Clerk callback, streaming, auto-scroll, payment, installer install/upgrade/uninstall, permission prompts, or updater installation.

## 20. Remaining unverified external integrations

- Clerk authentication/session refresh/revocation.
- Deepgram temporary-key mint and live STT.
- OpenRouter AI completion and refund-on-provider-failure.
- Razorpay browser checkout and live webhook.
- GitHub private release API/download proxy.
- Tauri signed update download/install/restart.
- Production database schema application.

No AI credit was intentionally consumed during runtime validation.

## 21. Credentials requiring manual rotation

- **Deepgram master API key**: rotate if any binary was built or distributed using the previous compile-time-key workflow. The current local secret value was not found in tracked current source, searched history, or inspected build artifacts, but the old design made compiled disclosure possible.
- No evidence in the inspected current source/artifacts required rotation of Clerk, OpenRouter, desktop-token-signing, Razorpay, or updater keys. Follow normal incident policy if logs or prior artifacts outside this workspace were exposed.

## 22. Skills, plugins, analyzers, and documentation evidence

| Skill/plugin | SKILL.md path or plugin | Applied to | Concrete contribution |
|---|---|---|---|
| systematic-debugging | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\superpowers\6.2.0\skills\systematic-debugging\SKILL.md` | Failure reproduction/root cause | Traced model-before-charge, source-mutating build, unsigned updater mapping, and embedded-key paths before edits. |
| coderabbit:code-review | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\coderabbit\1.1.4\skills\coderabbit-review\SKILL.md` | Correctness/security review | Manual review found mass assignment, generated-code drift, broad capability scope, and remaining log/contract risks. CodeRabbit CLI was unavailable. |
| SonarQube analysis | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\sonarqube\2.3.0\skills\sonar-analyze\SKILL.md` | Analyzer discovery | Confirmed Sonar scanner/MCP was unavailable; no dependency was installed. |
| frontend-testing-debugging | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\build-web-apps\0.1.2\skills\frontend-testing-debugging\SKILL.md` | React/Vite/Tauri flow validation | Guided full frontend tests, production build warning review, and explicit runtime blockers. |
| react-best-practices | same plugin, `react-best-practices\SKILL.md` | Hooks/effects/state review | Preserved existing cleanup/state ownership and identified auto-scroll as needing rendered coverage rather than claiming it verified. |
| verification-before-completion | superpowers 6.2.0, `verification-before-completion\SKILL.md` | All final classifications | Prevented treating typecheck/build as runtime verification and kept signing/browser/external checks blocked. |
| test-driven-development | superpowers 6.2.0, `test-driven-development\SKILL.md` | Security repair tests | Added focused regression checks for every nontrivial security boundary. |
| writing-plans | superpowers 6.2.0, `writing-plans\SKILL.md` | Repair batches only | Structured the priority repair batches below; no further repair was executed from the plan. |
| Context7 | `C:\Users\user\.codex\plugins\cache\context7-marketplace\context7\1.0.1\skills\context7-mcp\SKILL.md` | Installed-version documentation | Confirmed Tauri updater artifacts/capabilities, React effect cleanup, Clerk storage risk, Deepgram temporary JWT, Express raw body order, Vite `VITE_` exposure, Drizzle unique indexes, and Orval regeneration rules. |
| code-work/code-verification | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\codex-engineering-guardrails\1.1.1\skills\...` | Minimal edits and gates | Enforced scoped changes, tests, and evidence-based completion. |
| Keystone implementation/change-review | `C:\Users\user\.codex\plugins\cache\openai-curated-remote\keystone\2.0.4\skills\...` | Architecture/diff review | Used for route/database/native contract review and pre-commit change inspection. |
| Ponytail core/audit/review | `C:\Users\user\.codex\plugins\cache\ponytail\ponytail\4.8.4\skills\ponytail\SKILL.md`, `ponytail-audit\SKILL.md`, `ponytail-review\SKILL.md` | Minimal repair design | Preferred database constraints, existing charge wrapper, deletion of mutation scripts, and a documented process-local limiter over new dependencies. |
| Browser | `C:\Users\user\.codex\plugins\cache\openai-bundled\browser\26.727.51351\skills\control-in-app-browser\SKILL.md` | Public browser validation | Safely established that no browser backend was connected without inspecting auth state. |
| Computer Use | `C:\Users\user\.codex\plugins\cache\openai-bundled\computer-use\26.727.51351\skills\computer-use\SKILL.md` | Windows packaged runtime | Verified the exact release executable showed the unauthenticated launcher without entering credentials. |

Dedicated installed skills for security review and Windows/Tauri security validation were not available. The closest installed review, debugging, frontend, Browser, Computer Use, Context7, and architecture workflows were used instead. Nothing was installed.

### Context7 version matching

Installed versions inspected:

- Tauri `2.10.3`, tauri-build `2.5.6`, updater `2.10.1`.
- React `19.1.0`.
- Clerk React `5.61.3`.
- Express `5.2.1`.
- Vite `7.3.3`.
- Drizzle `0.45.2`.
- Orval installed `8.9.1`; generated markers `8.5.3`.
- Deepgram is used through the unversioned v1 HTTP/WebSocket API, not an SDK.

Context7 had exact/authoritative Tauri and Drizzle guidance and current product guidance for the other libraries. Exact patch documentation was unavailable for React 19.1, Clerk 5.61.3, Express 5.2.1 (5.2.0 docs), Vite 7.3.3 (7.3.1 docs), and unversioned Deepgram API; those gaps were not represented as exact matches.

## 23. Recommended repair batches in priority order

1. **Secure desktop auth handoff/storage** — replace loopback bearer query with a short-lived one-time code; exchange and rotate server-side; store refresh material in OS-backed secure storage; revoke old tokens.
2. **Release security gates** — configure and validate updater signing, make dependency install frozen, correct package versioning, and perform signed upgrade/install tests.
3. **CSP and per-window capabilities** — derive the minimum Clerk/Razorpay/API/Tauri allowlist, then split permissions by window and add denial tests.
4. **Shared abuse controls and log policy** — add edge/shared rate limiting, request-size limits, pseudonymous logging fields, and provider-error sanitization.
5. **Upload/parser parity** — validate DOCX internals, reject decompression bombs, and either implement DOC/DOCX extraction or stop accepting those formats.
6. **Database deployment discipline** — baseline migrations, detect existing duplicate provider IDs, apply unique indexes, and test rollback/forward deployment.
7. **Generated/build hygiene** — regenerate Orval with 8.9.1, resolve bundle splitting warnings, and isolate Rust formatting in a reviewable change.

## 24. Exact files proposed for Batch 1

- `artifacts/craft-vita/src/lib/desktopSession.ts`
- `artifacts/craft-vita/src/pages/DesktopAuth/DesktopAuthHandoff.tsx`
- `artifacts/craft-vita/src/components/auth/DesktopAuthHydrator.tsx`
- `artifacts/craft-vita/src/lib/desktopAuthSession.ts`
- `artifacts/api-server/src/routes/desktop.ts`
- `artifacts/api-server/src/lib/desktopAuth.ts`
- `artifacts/craft-vita/src-tauri/src/lib.rs`
- `artifacts/craft-vita/src-tauri/Cargo.toml` and `Cargo.lock` only if an already-approved OS secure-storage plugin is selected.
- `artifacts/craft-vita/src-tauri/capabilities/default.json`
- New focused API integration and Tauri manifest/contract tests adjacent to those files.

Dependency installation or upgrade requires explicit approval before Batch 1.

## 25. Recommendation

**Incremental repair.** The repository has functioning ownership checks, credit transactions, tests, and buildable frontend/API/native layers. The highest risks are concentrated in desktop auth handoff/storage, CSP/capability boundaries, production rate limiting, and release signing. A partial rewrite or full rebuild would add migration risk without addressing those boundaries faster.

## 26. Nothing pushed or deployed

- No push occurred.
- No deployment occurred.
- No production/external data was modified.
- No dependency was installed or upgraded.
- Two disposable local PostgreSQL containers created for integration tests were stopped and removed.
- No MSI was installed.

## 27. Final `git status --short`

```text
 M artifacts/craft-vita/src-tauri/entitlements.plist
 M artifacts/craft-vita/src-tauri/src/lib.rs
 M artifacts/craft-vita/src-tauri/tauri.conf.json
 M artifacts/craft-vita/src/components/auth/DesktopAuthHydrator.tsx
 M artifacts/craft-vita/src/features/session/audio/audioSessionController.ts
 M artifacts/craft-vita/src/features/session/hooks/useFloatingSession.ts
 M artifacts/craft-vita/src/features/session/slices/floatingSessionSlice.ts
 M artifacts/craft-vita/src/pages/DesktopAuth/DesktopAuthHandoff.tsx
 M artifacts/craft-vita/vite.config.ts
?? artifacts/craft-vita/src/features/session/audio/audioSessionController.test.ts
```

Final branch: `fix/windows-reopen-compile`  
Final HEAD: `7fc980e5547f8251e274e44f1516504da4992985`

## 28. Recommended next action

First, review and commit or discard the preserved pre-existing Windows/audio/auto-scroll work in separate batches; do not include the two status-only line-ending files. Then execute Batch 1 for secure desktop auth. Before any release candidate, configure updater signing securely and rerun:

```powershell
pnpm --dir artifacts/craft-vita tauri build
```

Expected release-gate evidence is a source-version-matched installer plus signed updater archive and `.sig`, followed by an actual safe update/install test. Do not publish the current `0.1.23` MSI.
