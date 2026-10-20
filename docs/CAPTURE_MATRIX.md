# CAPTURE_MATRIX — O2 invisibility at size

Branch feat-overlay-big. No commit. Scope: large/transparent overlay windows,
capture-path behaviour on this Windows host, compatibility mode, fallback ladder,
self-check UI. Every row says OBSERVED, INFERRED or UNTESTED with the exact method.
Raw evidence: docs/evidence/overlay-size/ (affinity JSON per transition, PNG
frames, mp4 recordings, summary JSON, logs).

Host: Windows 11, single display 1366x768 @ 1.05 scale factor (Electron DIP work
area 1301x686). Electron 37.10.3, Node 24.19.0, ffmpeg 8.1.2 (Windows build with
ddagrab). The overlay is a frameless, transparent, always-on-top BrowserWindow
with Electron setContentProtection(true) -> Windows SetWindowDisplayAffinity
WDA_EXCLUDEFROMCAPTURE (0x11). All numbers are pixel-difference fractions between
the capture and a hidden-window baseline captured through the SAME path.

## 1. Capture path matrix

| Capture path | App / OS | Result | Numbers (BANNER / READING) | Method + evidence |
|---|---|---|---|---|
| GDI BitBlt (System.Drawing CopyFromScreen, cropped to overlay rect) | HireShade Electron / Windows | **OBSERVED — HONORS exclusion** | ON vs hidden baseline: **0.004%** / **0.28%**; OFF vs baseline: **16.45%** / **7.32%** | gdi-grab.ps1 + image-diff.ps1; gdi-*-stealth-{on,off,hidden-baseline}.png, diff-*.json |
| ffmpeg gdigrab (GDI screen recording) | HireShade Electron / Windows | **OBSERVED — recordings captured; honours (A/B visible difference)** | ON vs OFF frame diff **6.28%** / **6.41%**; 2 s mp4s per state | gdigrab-{banner,reading}-stealth-{on,off}.mp4 + frames; diff-*-gdigrab-on-vs-off-frame.json |
| Chromium screen capture via Electron desktopCapturer.getSources({types:['screen']}) | HireShade Electron / Windows | **OBSERVED — HONORS exclusion** | ON vs hidden baseline **0.104%** / **0.117%**; OFF vs baseline **5.44%** / **5.57%** | electron-capture-probe.cjs + image-diff; desktopcapturer-*-screen-0.png |
| Chromium WINDOW capture via desktopCapturer.getSources({types:['window']}) | HireShade Electron / Windows | **OBSERVED — protected window yields NO pixels (0-byte thumbnail)** | ON: thumbnail 0x0 (0-byte PNG) for Launcher + Floating; OFF: **1366x252** / **1366x690** | desktopcapturer-*-window-Floating-Mini-Screen.png (0 vs 1366x252/690) |
| PrintWindow (user32, PW_RENDERFULLCONTENT=2 first, fallback 0) | HireShade Electron / Windows | **OBSERVED — no content leak; caveat below** | ON: mean luma **0.00**, **100% black**, flag 2 rejected -> fallback 0; OFF: mean luma **21.66 / 8.59**, black **31.1% / 72.8%** (content) | printwindow.ps1 + image-diff; printwindow-*-stealth-{on,off}.png |
| DXGI Desktop Duplication (ffmpeg ddagrab=0, D3D11) | HireShade Electron / Windows | **OBSERVED — IGNORES WDA_EXCLUDEFROMCAPTURE** | ON vs hidden ddagrab baseline **49.8%** of pixels differ; OFF **42.9%** — overlay visible in BOTH ON and OFF recordings | ddagrab banner hidden/on/off mp4s + frames; diff-ddagrab-banner-*.json |
| Chrome/Edge tab share (browser tab picker) | Chrome/Edge / Windows | **UNTESTED** | — | Needs a real browser tab-picker flow (automation not available here). The window-source row above is the closest Chromium window-capture observation. |
| Chrome/Edge full-screen share | Chrome/Edge / Windows | **UNTESTED (INDIRECT only)** | — | No automated browser picker; desktopCapturer screen capture exercises the same Chromium Windows plumbing but is not a real Chrome share. |
| macOS ScreenCaptureKit / NSWindowSharingNone | HireShade Electron / macOS | **UNTESTED** | — | No macOS host. NSWindowSharingNone is reported unreliable by external sources; no verification here. |
| Elevated vs non-elevated capture app | any / Windows | **UNTESTED** | — | No elevated capture tool exercised. |
| OBS/Discord/Zoom native full-screen capture | 3rd-party / Windows | **UNTESTED** | — | Not installed/automated here; the DXGI row is the API-level result those display-capture modes rely on. |
| Real monitor unplug/plug | HireShade / Windows | **UNTESTED (simulated path pass)** | affinity 0x11 after simulated display-metrics change and after DPI simulation (dpr 1.5) | Single-display host. screen display-metrics-changed handler exercised via debug IPC; DPI simulated with --force-device-scale-factor=1.5 (affinity PASS, display 607x341 DIP). |

PrintWindow caveat: flag 2 failed on the protected window and the fallback flag 0
produced an all-black bitmap; when protection is OFF the same window renders real
content. That supports "exclusion applies to PrintWindow here", but the black
result cannot fully distinguish "WDA blocked it" from "transparent/DWM surface
prints black" — labelled OBSERVED with that caveat.

## 2. Affinity re-assert after transitions (Windows GetWindowDisplayAffinity)

Script: scripts/capture-matrix/affinity.ps1 (PID-scoped to the app under test).
Every JSON below reports matching visible windows.

| Transition | Expected | Observed | Evidence |
|---|---|---|---|
| app startup | 0x11 | PASS (Launcher + Floating 0x11) | affinity-initial-startup.json |
| applyProfile card -> banner -> reading -> card -> banner -> reading | 0x11 each | PASS 6/6 | affinity-transition-{card,banner,reading}-*.json |
| simulated display-metrics-changed (DPI/work-area) | 0x11 | PASS | affinity-transition-display-metrics-simulated.json |
| private mode OFF | 0x0 (no claim) | PASS: both windows 0x0 | affinity-transition-private-off.json |
| private mode ON | 0x11 | PASS | affinity-transition-private-on.json |
| BANNER stealth ON | 0x11 | PASS | affinity-banner-stealth-on.json |
| BANNER stealth OFF | 0x0 | PASS (expected: no exclusion) | affinity-banner-stealth-off.json |
| READING stealth ON | 0x11 | PASS (floating 0x11; hidden launcher 0x0) | affinity-reading-stealth-on.json |
| compatibility mode ON at READING | 0x11 | PASS | affinity-compat-mode-on-reading.json |
| compatibility mode OFF at READING | 0x11 | PASS | affinity-compat-mode-off-reading.json |
| DPI simulated (1.5x, separate instance) | 0x11 | PASS | affinity-dpi-simulated.json |

All 11 assertions PASS (private-OFF asserts the intentional 0x0 state).
Re-assert log in main.log shows reason + counter for resize/move/preset/profile/
display/show/restore/focus/private/compat/recreate (#1..#32 in the evidence run).

## 3. Compatibility mode, fallback ladder, self-check (code status)

- Runtime compatibility mode (IPC channel desktop:capture:set-compat-mode):
  setContentProtection re-asserted; solid scrim #0b0d12 applied through
  setBackgroundColor + an injected renderer class that removes backdrop-filter,
  blur, border-radius and shadows. Affinity stays 0x11 (PASS).
  Electron's transparent flag is creation-only: a genuinely opaque
  transparent:false window is created on the NEXT launch (createWindow reads the
  persisted compat flag). A live window-recreation path exists but is opt-in
  (HIRESHADE_COMPAT_RECREATE=1), because recreating a protected surface at
  runtime crashed Electron on this host during evidence collection.
- Fallback ladder (plain language, in src/overlay/capture/captureLogic.cjs and the
  in-app self-check panel): 1) second monitor 2) share a window/tab instead of the
  screen 3) compatibility mode 4) browser-only overlay.
- Self-check UI (preload-injected, floating window only): "Capture check" pill ->
  panel with "Can they see it?" high-contrast pattern, "It is hidden" / "I can
  still see it" buttons, compatibility toggle, fallback ladder, and honest copy:
  "We cannot reliably detect whether a capture app is showing this window..."
  IDs used by CDP: hireshade-capture-toggle, hireshade-selfcheck-run,
  hireshade-selfcheck-visible/hidden, hireshade-compat-toggle.
- Auto-suggest (best effort, never claimed as detection):
  * user reports visible -> confidence "reported"
  * large transparent overlay (>=45% of work area) -> confidence "heuristic"
  * known-bad capture-path hint (env HIRESHADE_CAPTURE_HINT, debug IPC) ->
    confidence "hint"; canAutoDetect is always false and the UI says so.

## 4. Failures / anomalies observed

1. Orchestrator hang after runtime compatibility recreation (before the scrim-only
   fix): the recreated CDP target did not become available and the app process
   exited. Fixed by making runtime compat scrim-only (stable) with recreation
   opt-in; affinity for compat mode was re-captured successfully.
2. Shared desktop interference: another Electron app owned by a concurrent
   teammate ("HireShade overlay size acceptance", other PID) matched the initial
   title filter; affinity is now PID-scoped. Capture diffs are computed against a
   hidden-window baseline through the same path, so static third-party windows
   cancel out; small residuals (GDI READING 0.28%) are likely desktop/clock noise
   and are reported as measured, not rounded away.
3. Chromium WGC logged GetFrame failures while capturing the protected window;
   screen thumbnails still returned and showed exclusion. Window-source
   thumbnails for the protected window were 0x0 / 0 bytes.

## 5. Repro

    node scripts/capture-matrix/run-matrix.mjs          # full matrix (may hang on compat recreate; see anomalies)
    node scripts/capture-matrix/run-supplementary.mjs   # compat + DXGI + DPI (stable path)
    node scripts/capture-matrix/summarize.mjs           # -> docs/evidence/overlay-size/summary.json
    pnpm --dir artifacts/craft-vita exec vitest run src/overlay/capture
