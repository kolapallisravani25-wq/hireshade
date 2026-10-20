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