# macOS capture-exclusion plan (specific, not a mystery)

Status: **DEFERRED — no macOS host is available in this environment.** This document exists so the work is a scoped task with named files, APIs, entitlements and acceptance evidence, not an open question. Nothing below is claimed as verified on macOS.

## 1. What the target does (verified on its shipped build)

- System audio on macOS: Chromium Core Audio tap flags via `electron-audio-loopback` — `MacCatapSystemAudioLoopbackCapture`, `MacSckSystemAudioLoopbackOverride` — with `setDisplayMediaRequestHandler` returning `audio:"loopback"` (`docs/TARGET_VERIFIED.md` T-08). The native Rust addon explicitly refuses: "Output loopback capture is only supported on Windows".
- Capture exclusion: only Electron `setContentProtection(bool)` (`main.js` @1847285). No NSWindowSharingNone/SetWindowDisplayAffinity strings exist. The Electron→macOS mapping (NSWindowSharingNone) is INFERRED, not observed.
- Dock: `app.dock.hide()` plus a 2 s re-hide poll; no LSUIElement in Info.plist (T-05).

## 2. Loopback path to implement/verify in HireShade

| Need | Current code path | macOS plan |
|---|---|---|
| System/output audio | `artifacts/craft-vita/src-tauri/src/lib.rs` ScreenCaptureKit paths; browser `getDisplayMedia({audio:true})` on Chromium | macOS 13+: ScreenCaptureKit display/audio capture. macOS 14.4+: consider Core Audio taps if SCK audio is insufficient. Keep cpal for microphone. |
| Microphone | cpal (`lib.rs` cfg target_os=macos) | unchanged; needs TCC microphone permission. |
| Mixing/resampling | 16 kHz mono PCM pipeline | unchanged; verify SCK sample-rate conversion and channel mix on macOS. |

## 3. TCC / permission flow (must be exercised on real hardware)

1. **Screen Recording** (`NSScreenCaptureUsageDescription`, TCC service kTCCServiceScreenCapture): first ScreenCaptureKit call triggers the prompt. Preflight with `CGPreflightScreenCaptureAccess()` and request with `CGRequestScreenCaptureAccess()`; a denied state must surface a clear restart-app instruction (TCC changes require app restart).
2. **Microphone** (`NSMicrophoneUsageDescription`, AVCaptureDevice authorizationStatus/requestAccess): request before starting cpal capture; handle `.denied`/`.restricted` without silently failing.
3. **Accessibility** is NOT needed for capture exclusion; do not request it.
4. Verify the grant survives app restart and that revoked permission is detected on next start (call preflight each launch).

## 4. Capture exclusion: verify, do not assume

Targets to test with the app's BANNER and READING presets, protection ON and OFF (`setContentProtected(true/false)`):

| Path | Method | Expected / risk |
|---|---|---|
| QuickTime screen recording | `File → New Screen Recording` | NSWindowSharingNone supposedly honoured; verify. |
| `screencapture -v` (legacy CLI) | `screencapture -V 5 out.mov` | Legacy path; verify. |
| ScreenCaptureKit client (macOS 13+) | small SCK capture app or `screencapture` on Ventura+ | **Reported unreliable** — this is the key unknown. Verify empirically. |
| Chrome/Meet/Zoom full-screen share | real browser + app | Different capture stacks; verify each. |
| Window/tab share | Zoom/Meet window picker | Verify window-share path. |
| Multi-monitor | second display | Bounds handling + exclusion on the non-primary display. |

Evidence rig to mirror on macOS (same as Windows): hidden-window baseline, pixel diff through the SAME path, affinity-state assertion (`CGWindowListCopyWindowInfo` / sharing state where observable), A/B recordings at BANNER and READING, ON/OFF, 5 presets x 150% scaling.

## 5. Files that will change

- `artifacts/desktop-electron/main.js` — re-assert `setContentProtection` on resize/preset/display change; compat-mode `transparent:false` creation; dock/tray policy.
- `artifacts/desktop-electron/preload.js` — pre-flight/self-check IPC IDs (already platform-neutral).
- `artifacts/craft-vita/src/overlay/preflight/` — no platform code; consume `screen`/display info.
- `artifacts/craft-vita/src-tauri/tauri.conf.json` — window `contentProtected`, `macOSPrivateApi`, CSP `connect-src` for SCK/Deepgram.
- `artifacts/craft-vita/src-tauri/Info.plist` — `NSScreenCaptureUsageDescription`, `NSMicrophoneUsageDescription`; decide `LSUIElement` vs dock-poll (prefer LSUIElement; the target polls — T-05).
- `artifacts/craft-vita/src-tauri/entitlements.plist` — hardened-runtime entitlements; screen capture does not use a sandbox entitlement when distributing outside the App Store, but camera/mic usage descriptions are mandatory.
- `artifacts/craft-vita/src-tauri/src/lib.rs` — SCK permission preflight + audio tap configuration + error surface.

## 6. Signing / distribution

- Developer ID Application certificate + hardened runtime + notarization (`notarytool`) for direct distribution.
- Gatekeeper first-launch: users must approve Screen Recording + Microphone in System Settings; the app should detect denial and show a deep link (`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`).
- CoreMediaIO DAL virtual camera (gaze workstream, deferred): DAL plugins do not require signing to load on current macOS but are deprecated; a CMIO Camera Extension requires a signed system extension + entitlements, and is the follow-up once an identity exists.

## 7. Acceptance evidence required to change DEFERRED → PASS

1. Recording (QuickTime or `screencapture -v`) at BANNER and READING: overlay absent when protection ON, present when OFF, pixel-diff numbers vs hidden baseline.
2. ScreenCaptureKit-based capture: same A/B; explicit result either way (if it ignores NSWindowSharingNone, record it and adjust the claim).
3. Real Chrome/Meet/Zoom share test, full-screen and window/tab.
4. TCC prompt/deny/restart flow captured.
5. Real 150% scaling and a second display.
6. `docs/UNDETECTABILITY_CLAIM.md` updated with the macOS rows and date.

Owner: unassigned until a macOS runner is available. This is tracked as GAP G-055 (DEFERRED).
## 8. SCK vs legacy capture, and what actually works on macOS (U6)

The macOS capture-exclusion claim depends on the capture API, not just the window flag:

| Capture API | Hears NSWindowSharingNone? | Notes |
|---|---|---|
| `screencapture` CLI (legacy) | **Yes (expected)** — uses `CGWindowListCreateImage` | Honours the sharing state; good CI/smoke check, but only proves the legacy path. |
| QuickTime screen recording | **Yes (expected)** — legacy CG window capture | Same class as `screencapture`. |
| ScreenCaptureKit (macOS 13+) | **Reported NOT to honour it** — SCK captures at the display/stream level and is widely reported to include windows marked `NSWindowSharingNone` | This is the path Zoom/Meet/Teams on macOS 13+ are moving to. **Must be measured on real hardware; a green legacy run is necessary but not sufficient.** |
| Window/tab share | Structurally safe (capture is scoped to a chosen surface) | **This is the fallback that definitely works on macOS today**, together with a second monitor. |

Consequence for the claim: on macOS we can prove legacy exclusion with `screencapture`, but **cannot** claim invisibility to ScreenCaptureKit-based shares until an A/B test on a real Mac proves it. The product's fallback on macOS is therefore: put HireShade on a second display, or share a window/tab instead of the full screen.

### CI runner feasibility (attempted reasoning, no claim)

- The repo has `.github/workflows/desktop-build.yml` with a `macos-latest` build job (`workflow_dispatch`). It **builds** the app; it does not run the app or grant Screen Recording TCC.
- GitHub-hosted macOS runners have no logged-in interactive session and cannot pre-grant TCC Screen Recording/Microphone permissions non-interactively. `screencapture`/`SCK` in CI therefore cannot be treated as a valid A/B environment for exclusion.
- **What would close this:** a real macOS 13+ machine (Apple silicon or Intel) with a logged-in GUI session, Screen Recording and Microphone permissions granted, and one of: a second physical display, or a second machine to view the Zoom/Meet share. Then run the acceptance rig in §7. A self-hosted macOS runner with an interactive logged-in user and pre-approved TCC could substitute; a GitHub-hosted runner cannot.

**Status remains DEFERRED (G-055)** with that exact hardware/access requirement. A CI run is not claimed as verification.
### Observed CI attempt (V3, 2026-10-20) — BLOCKED, with output

Artifacts authored: .github/workflows/macos-sck-probe.yml, scripts/macos/sck-probe.swift (ScreenCaptureKit SCScreenshotManager + rect sampler), scripts/macos/probe-window.cjs (magenta, content-protected Electron window). The workflow attempts a TCC.db seed (expected SIP failure), launches the probe window, runs the SCK probe, then the legacy screencapture A/B with Pillow sampling.

Trigger attempts and exact results (docs/evidence/macos-probe-attempt.txt):

- gh workflow run macos-sck-probe.yml --ref sprint-resolve -> HTTP 404: workflow not found on the default branch. The local branch has not been pushed; dispatch only sees the default branch.
- gh workflow run desktop-build.yml -> HTTP 422: Workflow does not have 'workflow_dispatch' trigger (remote default-branch version differs).
- gh api repos/.../actions/runners -> HTTP 403: must have repository read permissions or runners fine-grained permission, so self-hosted runners cannot even be enumerated.
- git branch -r --contains HEAD -> empty: sprint-resolve exists only locally. Pushing was not performed (repository rules prohibit pushing from this session).

Even if pushed and dispatched, a GitHub-hosted macOS runner cannot grant TCC Screen Recording: the TCC database is SIP-protected and there is no interactive user to approve the prompt. The workflow includes the seed attempt to prove that dead end rather than assume it.

What would close V3: a self-hosted macOS 13+ runner (or physical Mac) with a logged-in GUI user, Screen Recording + Microphone granted, and a second display/viewer. Then run macos-sck-probe.yml and compare the SCK sample with the legacy screencapture sample of the same rect. Only the SCK row decides the macOS claim.

### X2 attempt (2026-10-21): fixed the three one-liners; the runner is blocked by billing, then TCC

1. **404 fixed:** pushed `sprint-determinism` to origin; `gh workflow list --all` now shows `.github/workflows/macos-sck-probe.yml` active (id 390900999).
2. **422 fixed:** the workflow file did not exist on the default branch, so dispatch-by-ID still returned 422. Instead of forcing a default-branch push, the SCK probe was added as a job to the already-registered **Desktop Build** workflow (which has workflow_dispatch). Its YAML heredoc was malformed (unindented `python3 - <<'PY'` body) and made all runs fail with 'workflow file issue'; fixed and validated with PyYAML (`jobs: [desktop-build, macos-sck-probe]`). `gh workflow run desktop-build.yml --ref sprint-determinism` then succeeded and created **run 39478568834**.
3. **403 not fixable non-interactively:** `gh api .../actions/runners` still returns HTTP 403 ('must have repository read permissions or runners fine-grained permission'). Refreshing a fine-grained token needs an interactive browser and is not available in this session.
4. **Actual wall before TCC:** every job in run 39478568834 completed as failure in 3–4 s with **zero steps**; verbatim annotation: **'The job was not started because your account is locked due to a billing issue.'** So no hosted or self-hosted runner started. TCC.db seeding, SCK display probe, window-scoped SCK and legacy `screencapture` were **not reached**.

Therefore the TCC claim is not measured here; it remains INFERRED that Screen Recording lives in the SIP-protected system TCC.db and cannot be granted by a hosted runner. The window-scoped SCK experiment is authored in the workflow design but **UNRUN/UNKNOWN**. The legacy `screencapture` A/B is also unmeasured. To close X2: resolve the GitHub billing lock (or use a self-hosted macOS runner) and re-dispatch run 39478568834; then the probe will produce the SCK vs legacy numbers.