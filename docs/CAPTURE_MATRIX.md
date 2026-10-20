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
| Chrome/Edge tab share (real getDisplayMedia tab capture) | Chrome/Edge / Windows | **OBSERVED — structurally safe; recommended mode** | Chrome + Edge: displaySurface=browser, canvas 1367x769, overlay-screen sample rgb **6,46,23** (tab content) — overlay magenta **0/2** runs. Exact app-tab selection **UNTESTED-BLOCKED**: --auto-select-tab-capture-source-by-title selected the capture page's own tab on this Chrome 155/Edge build, so the app-tab DOM pixel was not confirmed; the overlay window still never appears in ANY tab capture (source-scoped). | scripts/capture-sprint browser-share; docs/evidence/capture-sprint/s4/ s4-share-*-tab-protected.png + s4-capture-sprint-results.json |
| Chrome/Edge full-screen share (real getDisplayMedia) | Chrome/Edge / Windows | **OBSERVED — HONORS exclusion** | Protected overlay region rgb **19,22,21** (Chrome) / **19,22,21** (Edge) = NOT magenta; same-path positive control with protection OFF = **254,2,253** magenta. displaySurface=monitor, canvas 1367x769. | scripts/capture-sprint browser-share (auto-select-desktop-capture-source + --use-fake-ui-for-media-stream + CDP pixel sampling); s4-share-{chrome,edge}-full-{protected,control}.png |
| OS click-through: dedicated target window behind a protected overlay | HireShade Electron harness / Windows | **OBSERVED — passes through to the app behind; overlay controls receive clicks when disabled** | Click-through ON at overlay transparent point: target clicks **0 -> 1**, overlay clicks **0**; click-through OFF on overlay control: overlay clicks **0 -> 1**, target unchanged **1**. Foregrounded by the test itself (target.moveTop/focus + overlay moveTop/showInactive), physical Win32 SendInput click. | scripts/capture-sprint click-through.mjs; s4-clickthrough-{on-overlay,on-target,off-overlay}.png |
| Real OS display scaling 150% | Windows / HireShade | **UNTESTED-BLOCKED** | LogPixels written 144 and read back 144, but live session Electron scale factor stayed **1.05 before and after**; value restored to previous 120. Blocker: Windows applies write at sign-in; in-session change requires sign-out/in (or Settings UI), which would end the harness desktop session. | registry commands + Electron dpi_probe scale readings in s4-capture-sprint-results.json |
| Second monitor (real hardware) | Windows / HireShade | **UNTESTED-BLOCKED** | screen.getAllDisplays() = **1** (work area 1301x732). Attempts: Get-PnpDevice displays, Win32_VideoController, DriverStore search for idd/usbmmidd/virtualdisplay (none), pnputil /enum-drivers (none), DisplaySwitch.exe /extend (no-op). Installing a virtual display driver needs an admin driver package, unavailable. | enumeration + commands in s4-capture-sprint-results.json (attemptSecondMonitor) |
| Elevated vs non-elevated capture app | any / Windows | **UNTESTED-BLOCKED** | Agent integrity = **Medium** (S-1-16-8192). schtasks /RL HIGHEST creation **denied** (admin required); interactive UAC deliberately not triggered (an unattended consent prompt cannot be approved and would block the desktop); EnableLUA/prompt policy captured. Only the non-elevated capture path is covered by the other rows. | whoami /groups + denied schtasks + UAC policy in s4-capture-sprint-results.json (attemptElevation) |
| macOS ScreenCaptureKit / NSWindowSharingNone | HireShade Electron / macOS | **UNTESTED** | — | No macOS host. NSWindowSharingNone is reported unreliable by external sources; no verification here. |
| Elevated vs non-elevated capture app | any / Windows | **UNTESTED** | — | No elevated capture tool exercised. |
| OBS/Discord/Zoom native full-screen capture | 3rd-party / Windows | **UNTESTED** | — | Not installed/automated here; the DXGI row is the API-level result those display-capture modes rely on. |
| Real monitor unplug/plug | HireShade / Windows | **UNTESTED (simulated path pass)** | affinity 0x11 after simulated display-metrics change and after DPI simulation (dpr 1.5) | Single-display host. screen display-metrics-changed handler exercised via debug IPC; DPI simulated with --force-device-scale-factor=1.5 (affinity PASS, display 607x341 DIP). |

PrintWindow caveat: flag 2 failed on the protected window and the fallback flag 0
produced an all-black bitmap; when protection is OFF the same window renders real
content. That supports "exclusion applies to PrintWindow here", but the black
result cannot fully distinguish "WDA blocked it" from "transparent/DWM surface
prints black" — labelled OBSERVED with that caveat.

## 1b. Affinity-mode experiment (S1): 0x00 / 0x01 / 0x11 against every path

Goal: determine whether a different `SetWindowDisplayAffinity` value helps where 0x11 fails (DXGI). Same hidden-window baseline and pixel-diff method as §1. Raw evidence: `docs/evidence/capture-sprint/affinity-grid-*.json`, `grid-ddagrab-*`, `gdi-*`, `desktopcapturer-*`, `printwindow-*`, `zoom-clean-*`, grid log `docs/affinity-grid-run7.tmp.log`.

| Path | 0x00 WDA_NONE | 0x01 WDA_MONITOR | 0x11 WDA_EXCLUDEFROMCAPTURE |
|---|---|---|---|
| GDI `CopyFromScreen` | **VISIBLE_CONTENT** (BANNER + READING) | **UNTESTED-BLOCKED** | **Excluded** (independent run: ON 0.004 %/0.28 % vs OFF 16.45 %/7.32 %) |
| Chromium `desktopCapturer` screen | **VISIBLE_CONTENT** | **UNTESTED-BLOCKED** | **Excluded** (ON 0.104 %/0.117 % vs OFF 5.44 %/5.57 %) |
| Chromium `desktopCapturer` window | **CONTENT** (1366x252 BANNER / 1366x690 READING) | **UNTESTED-BLOCKED** | **NO_PIXELS** (0x0 thumbnail) |
| PrintWindow | **CONTENT_VISIBLE** | **UNTESTED-BLOCKED** | **BLACK_NO_CONTENT** (caveat: transparent/DWM may also print black) |
| DXGI Desktop Duplication (`ddagrab`) | **VISIBLE_CONTENT** | **UNTESTED-BLOCKED** | **VISIBLE_CONTENT — IGNORES 0x11** |

Why 0x01 is UNTESTED-BLOCKED (OBSERVED blocker, not a guess): `SetWindowDisplayAffinity` requires the caller to own the HWND. Electron exposes only `setContentProtection(bool)` (0x00/0x11); an out-of-process PowerShell/Win32 call returns **ERROR_ACCESS_DENIED (Win32 5)** on the Electron window, so no valid 0x01 state could be established. A Rust in-process probe exists in `scripts/capture-matrix/rust-affinity-probe/` but targets a separate native surface, not the shipped Electron overlay, so its result is not presented as a product result. The mixed-mode grid was aborted on an affinity-drift check for this reason; only the 0x00 and independent 0x11 rows are claimed.

**Conclusion:** no affinity mode tested helps DXGI; 0x11 remains the shipped mode. 0x01 cannot be reached on the transparent Electron surface in this build, so the "black-box beats visible answers" hypothesis is **UNRESOLVED**, not rejected.

**Residual (GDI ON vs baseline):** clean edge-ring analysis shows **0 changed pixels in the 1/2/4/8 px rings and a contiguous band of 0 px**; interior differences are 0.007 % (BANNER) / 0.294 % (READING) with max luma 84/200 — desktop/clock noise between captures, **not a visible edge line**. Zoomed montages: `docs/evidence/capture-sprint/zoom-clean-*-gdi-0x11-{top,bottom,left,right,corner-topleft}.png`.

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
  persisted compat flag). Runtime recreation is opt-in (HIRESHADE_COMPAT_RECREATE=1).

### S2: recreation crash root cause + fix (code shipped), opaque-capture verification BLOCKED

Root cause class (found by reproducing with `scripts/capture-matrix/repro-recreate.mjs`): the compat toggle used to synchronously destroy a **protected** surface inside the IPC handler the renderer was awaiting; the old window's late `closed` handler then deleted the new replacement's map entries, and the new HWND could race the GPU surface swap. Symptoms: CDP target never appeared / process exit.

Fix shipped in `artifacts/desktop-electron/main.js` (`git diff` shows exact lines):
1. Clear `setContentProtection(false)` before teardown (no protected surface racing the new HWND).
2. Recreate after `old.once('closed')` + 30 ms, never synchronously inside the IPC handler (60 ms defer), with a 750 ms fallback build.
3. `closed` handler now deletes map entries only if they still point at THIS window (identity guard), so a late close cannot unregister the replacement.
4. `did-finish-load` force-show fallback for recreated opaque surfaces that miss `ready-to-show`.
5. Pre-flight move/self-check handlers added (see §6).

**Verification status:** the crash root cause is fixed in code, but the opaque-capture **measurement** is BLOCKED in this environment: the repro harness (`repro-recreate.mjs`) hangs waiting for the recreated page target, and unattended UAC/desktop constraints prevent a clean end-to-end run. No OBSERVED row claims "opaque removes the PrintWindow black bar". This is recorded as G-052 PARTIAL, not PASS.

- Fallback ladder (plain language, in src/overlay/capture/captureLogic.cjs and the
  in-app self-check panel), now failure-specific:
  1) **second monitor** - fixes DXGI/whole-screen capture that ignores WDA_EXCLUDEFROMCAPTURE;
  2) **share a window or tab** - same DXGI/whole-screen leak with one monitor;
  3) **compatibility mode** - fixes the black rectangle/bar from transparent/PrintWindow compositing (does NOT fix DXGI);
  4) **browser-only overlay** - all desktop-window capture paths, at the cost of overlay ergonomics.
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

S4 capture sprint (real click-through, Chrome/Edge share, honest blockers):

    node scripts/capture-sprint/run-capture-sprint.mjs           # full sprint, ~86 s
    node scripts/capture-sprint/run-capture-sprint.mjs --quick   # cheap check, ~10 s
    node scripts/demo/run-demo.mjs capture-sprint                 # same quick check via make demo

S4 evidence: docs/evidence/capture-sprint/s4/s4-capture-sprint-results.json
(plus s4-clickthrough-*.png and s4-share-{chrome,edge}-{full,tab}-{protected,control}.png).
## 6. S3 runtime pre-flight (product behaviour)

The matrix is now an in-app pre-flight shown before a session (Connect dialog), not just a doc.

- **States:** exactly GREEN (nothing to do) / AMBER (one thing to change) / RED (exclusion cannot be relied on). No other states.
- **Second display is the DEFAULT recommendation** whenever present (structurally unbeatable: share the other screen).
- **Curated tested-app list is DATA** (`src/overlay/preflight/testedApps.data.ts`): schema v1, list version `2026.10.20.1`, testedOn `2026-10-20`, 11 apps (Zoom/Teams/Webex/Discord high risk = DXGI-family; Meet/Slack/Lark/Chime/CoderPad/HackerRank medium) with per-path risk and OBSERVED/INFERRED/UNTESTED evidence status.
- **Actions:** move to monitor 2 (real IPC: validates display, computes layout, persists bounds, re-asserts 0x11), window-share guidance, compatibility mode, run self-check (pattern sent to the floating renderer; preload renders content-leak or black-bar-leak).
- **Honest copy always present:** "We can't reliably detect which capture path an app uses..." `canAutoDetect=false` is surfaced, not hidden.
- **Black-bar self-check:** high-contrast bars around a solid black 60%x50% panel, so an opaque black rectangle leak is obvious (not only a content leak).
- **Wiring shipped:** `main.js` channels `desktop:preflight:get-context`, `move-to-display`, `show-self-check`; `preload.js` exposes `window.hireshadePreflight` and renders the patterns; `PreflightCard` mounted in `ConnectDialog` (degrades to a single-display honest verdict in the browser).
- **Evidence:** `docs/evidence/capture-sprint/preflight/` (11-scenario GREEN/AMBER/RED matrix, 25 assertions, both pattern SVGs).
- **Not claimed:** automatic capture-path detection. The verdict is based on displays + the versioned app list + user report/self-check.

## 7. S4 untested-list closure (summary)

| Item | Result |
|---|---|
| Click-through (dedicated target window) | **OBSERVED PASS** — ON: target click 0->1, overlay 0; OFF: overlay control 0->1, target unchanged |
| Chrome 155 full-screen share | **OBSERVED excluded** — protected rgb 19,22,21; OFF control 254,2,253 magenta |
| Edge full-screen share | **OBSERVED excluded** — same method/result |
| Chrome/Edge tab share | **OBSERVED structurally safe** (`displaySurface=browser`, no overlay pixels); exact app-tab selection **UNTESTED-BLOCKED** (picker chose the capture page's own tab) |
| Real 150 % OS scaling | **UNTESTED-BLOCKED** — LogPixels 144 written/read back, live scale stays 1.05 until sign-out |
| Second monitor | **UNTESTED-BLOCKED** — single display; no virtual-display driver installable without admin |
| Elevated vs non-elevated | **UNTESTED-BLOCKED** — Medium integrity; schtasks HIGHEST denied; unattended UAC impossible |
