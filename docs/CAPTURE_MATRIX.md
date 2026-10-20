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
| Chrome/Edge tab share (real getDisplayMedia tab capture) | Chrome/Edge / Windows | **OBSERVED — structurally safe; recommended mode** | Chrome 155 + Edge: `displaySurface=browser`, `selfBrowserSurface=exclude`, `preferCurrentTab=false`; app-tab DOM pixel sampled **rgb 30,78,217** (blue app tab) and control **59,7,100**; overlay sample equals app-tab pixels, **magenta 0/2**, so the overlay window never appears in any tab capture. Dedicated app-tab window + separate capture window over CDP, no fake-UI. | scripts/capture-sprint/u4-tab-share.mjs; docs/evidence/capture-sprint/s4/u4-tab-share-results.json + u4-tab-{chrome,edge}-{captured,app-tab}.png |
| Chrome/Edge full-screen share (real getDisplayMedia) | Chrome/Edge / Windows | **OBSERVED — HONORS exclusion** | Protected overlay region rgb **19,22,21** (Chrome) / **19,22,21** (Edge) = NOT magenta; same-path positive control with protection OFF = **254,2,253** magenta. displaySurface=monitor, canvas 1367x769. | scripts/capture-sprint browser-share (auto-select-desktop-capture-source + --use-fake-ui-for-media-stream + CDP pixel sampling); s4-share-{chrome,edge}-full-{protected,control}.png |
| OS click-through: dedicated target window behind a protected overlay | HireShade Electron harness / Windows | **OBSERVED — 20/20 valid V4 iterations (100%); click-through ON passes to target, OFF is consumed by the overlay control** | V4 state-gated harness, 20 fresh launches (launch success **20/20**, every launch first attempt). Each phase resets counters, prepares focus/stack in Electron (tracked `ignoreMouse` + HWNDs via IPC, Electron getter when available), raises the overlay, then one bounded Win32 gate polls **WS_EX_TRANSPARENT (0x20)** on the overlay HWND, **GetForegroundWindow == expected** (target for ON, overlay for OFF), and **WindowFromPoint == expected root**; physical SendInput is injected inside the same gated helper only after all three pass, with a bounded counter wait (no fixed sleeps). ON: target **0 -> 1**, overlay **0**; OFF: overlay control **0 -> 1**, target **0**. Gate medians 365 ms (ON) / 362 ms (OFF), 0 gate failures. | scripts/capture-sprint/{click-through.mjs,u4v-win32.ps1,u4v-clickthrough-20x.mjs}; docs/evidence/capture-sprint/s4/u4v-clickthrough-20x.json + s4-clickthrough-{on-overlay,on-target,off-overlay}.png |
| Real OS display scaling | Windows / HireShade | **PARTIAL — 125% live OBSERVED, 150% unavailable on this host** | Settings UI offers only **100%** at 1366x768 (UIAutomation `scale-item-not-found` for 150/125); `DisplayConfigSetDeviceInfo` relative +2 returned success but Windows clamped to relative +1 and the live Electron scale factor changed **1.05 -> 1.3125 (125% ratio 1.25)**, then restored to 1.05. Registry LogPixels+broadcast did NOT change live scale (applies at sign-in). 150% is not offered by this display source (CCD maxRelativeScale=1). | scripts/capture-sprint/u3-ccd-dpi.ps1 / u3-settings-scale.ps1; docs/evidence/capture-sprint/s4/u3-live-scaling-results.json + u3-settings-scale-options.png |
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

## 1b. Affinity-mode experiment (S1 → resolved by U1): 0x00 / 0x01 / 0x11

Goal: determine whether a different `SetWindowDisplayAffinity` value helps where 0x11 fails (DXGI). Method: Electron launched with an in-process koffi call to `user32!SetWindowDisplayAffinity` on its own HWND (`win.getNativeWindowHandle()`), verified by `GetWindowDisplayAffinity` readback and an external probe. Same hidden-window baseline / pixel-diff method as §1. Evidence: `docs/evidence/capture-sprint/native-affinity-dxgi.json`, `affinity-native-0x01.json`, `gdi-native-0x01-gdi.json`, `printwindow-native-0x01.json`, `native-0x01-dxgi-frame.png`, `native-0x01-crop.png`.

| Path | 0x00 WDA_NONE | 0x01 WDA_MONITOR (in-process) | 0x11 WDA_EXCLUDEFROMCAPTURE |
|---|---|---|---|
| GDI `CopyFromScreen` | **VISIBLE_CONTENT** | **ALL-BLACK** (mean luma 0.00, black 100%) | **Excluded** (ON 0.004 %/0.28 % vs OFF 16.45 %/7.32 %) |
| Chromium `desktopCapturer` screen | **VISIBLE_CONTENT** | **INFERRED black** (WDA_MONITOR semantics; not re-measured) | **Excluded** (ON 0.104 %/0.117 % vs OFF 5.44 %/5.57 %) |
| Chromium `desktopCapturer` window | **CONTENT** (1366x252 / 1366x690) | **INFERRED black** (same; not re-measured) | **NO_PIXELS** (0x0 thumbnail) |
| PrintWindow | **CONTENT_VISIBLE** | **ALL-BLACK** (mean luma 0, 100% black) | **BLACK_NO_CONTENT** (caveat) |
| DXGI Desktop Duplication (`ddagrab`) | **VISIBLE_CONTENT** (mean luma 93.82, black 0.2%) | **ALL-BLACK — HONOURS 0x01** (mean luma **0.01**, black **100%**) | **VISIBLE_CONTENT — IGNORES 0x11** (mean luma 27.39, black 0.34%) |

**Answer to the question: YES.** DXGI Desktop Duplication ignores 0x11 but **honours WDA_MONITOR 0x01**: the overlay region becomes a 100% black rectangle instead of a live answer window. GDI and PrintWindow are black under 0x01 as well. The 0x01 state was established entirely in-process (koffi + `win.getNativeWindowHandle()`, with readback 0x1), which is why the earlier out-of-process ERROR_ACCESS_DENIED blocker is resolved.

**Shipped product behaviour:** black box mode is a real, persisted toggle in the app (`captureState.affinityMode: "exclude" | "monitor"`, IPC `desktop:capture:set-affinity-mode`), uses one code path (`applyStealth` → native `SetWindowDisplayAffinity`; no mixing with `setContentProtection`), and re-asserts on the same triggers as normal protection (resize/preset/display/show/focus/recreate). The pre-flight offers it as a one-click action for DXGI-risk single-display setups. Black box is **discoverable** (a black rectangle), but it leaks no answer text — strictly better than a visible overlay for DXGI capture.

**Residual (GDI ON vs baseline for 0x11):** clean edge-ring analysis shows **0 changed pixels in the 1/2/4/8 px rings and a contiguous band of 0 px**; interior differences are 0.007 % (BANNER) / 0.294 % (READING) with max luma 84/200 — desktop/clock noise between captures, **not a visible edge line**. Zoomed montages: `docs/evidence/capture-sprint/zoom-clean-*-gdi-0x11-{top,bottom,left,right,corner-topleft}.png`.

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

### V1 definitive: compatibility mode has NO measured capture effect under 0x11 (RETIRE/DEMOTE; G-052 closed with corrected premise)

Question: under WDA_EXCLUDEFROMCAPTURE (0x11), does transparent vs opaque change any of the five capture
paths? Answer: **no, on this host/build all five paths measure identical.**

Method (definitive rig; scripts/capture-matrix/v1-compat-ab.mjs):
- Two product-shell launches: **A** `compatMode=false` (transparent), **B** `compatMode=true`
  (`transparent:false` at creation), both `affinityMode=exclude` (0x11 via U1 koffi), profile READING.
- A unique `rgb(1,254,1)` marker fills the overlay client area, so presence/absence is measured by marker
  pixels only; third-party windows on the shared desktop cannot masquerade as the overlay.
- `IsWindowVisible` + `GetWindowDisplayAffinity=0x11` + topmost are asserted **immediately before and
  after every capture**; 0 assertion failures for A and B.
- Positive control: same paths with affinity 0x00 must capture the marker. Triggering 0x00 through the
  renderer detaches the CDP page context, so the control was captured externally (no CDP dependence).

| path | A transparent (0x11) | B opaque (0x11) | verdict |
|---|---|---|---|
| GDI CopyFromScreen | marker 0.00000 -> HIDDEN | 0.00000 -> HIDDEN | identical |
| desktopCapturer screen | 0.00000 -> HIDDEN | 0.00000 -> HIDDEN | identical |
| desktopCapturer window | 0x0 thumbnail -> NO_PIXELS | 0x0 -> NO_PIXELS | identical |
| PrintWindow | marker 0.00000, black_fraction 1.0 | 0.00000, black_fraction 1.0 | identical |
| DXGI ddagrab | 0.00000 -> HIDDEN | 0.00000 -> HIDDEN | identical |

Positive-control (0x00) marker fractions: **B: GDI 0.85248, desktopCapturer screen 0.85248, DXGI 0.85332**;
**A: DXGI 0.85808**. A GDI/desktopCapturer control attempts were covered by another agent's always-on-top
S4 click-target windows (image: `gdi-A-gdi-control-0x00-crop.png`), so those two A control cells are
**not control-validated**; every screen path is still validated by at least one variant, and B validates
all three. This limitation is recorded, not hidden.

State/style (both variants): window visible=true, topmost=true; affinity 0x11 PASS; `WS_EX_LAYERED` true
in BOTH (exstyle 0x80028 transparent, 0x80128 opaque). Therefore `WS_EX_LAYERED` and PrintWindow-black
are properties of the protected/frameless Electron surface, **not** evidence of an opacity effect.

**Verdict: RETIRE/DEMOTE.** Compatibility mode has no measured capture benefit under 0x11; keep it only as
a cosmetic "no blur / solid scrim" option, or remove it as a capture mitigation. The earlier V1 B
differences (GDI 0.99996, desktopCapturer 0.954, DXGI 0.30556) were third-party windows, not the overlay;
the labels were inverted/contaminated and are withdrawn.

**G-052**: the premise ("opaque removes the PrintWindow black bar / opaque changes capture") was wrong.
Exit G-052 with: *under WDA_EXCLUDEFROMCAPTURE 0x11, transparent vs opaque is a no-op on all five measured
paths on this host/build; PrintWindow is black and WS_EX_LAYERED persists in both; compatibility mode is
cosmetic only.* Residual limitation: single Windows host/GPU/driver, Electron 37.10.3, one display; the
transparent GDI/DC positive-control cells were occluded by a concurrent agent and are marked as such.

Evidence: docs/evidence/capture-sprint/v1/{v1-compat-ab.json, v1-verdict.json, v1-control-A.json,
gdi-A-gdi-control-0x00-crop.png, gdi-B-gdi-control-0x00-crop.png, marker-*.json, window-style-*.json,
affinity-*.json, main-A.log, main-B.log} and scripts/capture-matrix/{v1-compat-ab.mjs, marker-stats.ps1,
focus-window.ps1, window-style.ps1}. U2 harness details remain in the U2 evidence files.

- Fallback ladder (plain language, in src/overlay/capture/captureLogic.cjs and the
  in-app self-check panel), now failure-specific:
  1) **second monitor** - fixes DXGI/whole-screen capture that ignores WDA_EXCLUDEFROMCAPTURE;
  2) **share a window or tab** - same DXGI/whole-screen leak with one monitor;
  3) **compatibility mode** - cosmetic only (solid scrim / no blur): V1 measured NO capture benefit under
     0x11 on any of the five paths (transparent and opaque identical); do not present it as a capture fix;
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
| Click-through (dedicated target window) | **OBSERVED PASS — 20/20 valid V4 iterations**; launch 20/20, gate asserts WS_EX_TRANSPARENT + foreground + hit-test before SendInput (`u4v-clickthrough-20x.json`) |
| Chrome 155 full-screen share | **OBSERVED excluded** — protected rgb 19,22,21; OFF control 254,2,253 magenta |
| Edge full-screen share | **OBSERVED excluded** — same method/result |
| Chrome/Edge tab share | **OBSERVED PASS** — app-tab DOM pixel confirmed in Chrome 155 + Edge; zero overlay pixels (`u4-tab-share-results.json`) |
| Real OS scaling | **PARTIAL** — live change **1.05 -> 1.3125 (125%)** via CCD, restored; 150% not offered on this 1366x768 source (Settings only 100%, CCD max relative 1) |
| Second monitor | **UNTESTED-BLOCKED** — single display; no virtual-display driver installable without admin |
| Elevated vs non-elevated | **UNTESTED-BLOCKED** — Medium integrity; schtasks HIGHEST denied; unattended UAC impossible |

## 9. sprint-resolve (V1–V4): compat verdict, affinity policy, macOS probe attempt, click-through rate

### V1 — compatibility mode is DEMOTED to cosmetic (premise was wrong)

Definitive 2×5 measurement under **WDA_EXCLUDEFROMCAPTURE 0x11**, same rig, same runs:

| Path | 0x11 transparent | 0x11 opaque (compat, startup) | Same? |
|---|---|---|---|
| GDI CopyFromScreen | HIDDEN (marker 0) | HIDDEN (marker 0) | yes |
| desktopCapturer screen | HIDDEN (0) | HIDDEN (0) | yes |
| desktopCapturer window | NO_PIXELS (0×0) | NO_PIXELS (0×0) | yes |
| PrintWindow | HIDDEN (0) | HIDDEN (0) | yes |
| DXGI ddagrab | HIDDEN (0) | HIDDEN (0) | yes |

**Positive control (0x00, same rig): the unique rgb(1,254,1) marker WAS captured on the display paths**, so the zero fractions under 0x11 are meaningful, not a broken detector. `WS_EX_LAYERED` was recorded for both variants, so it is not used as the discriminator. Verdict: **identical on all five paths — compatibility mode has no measured capture effect.** It is retained only as a cosmetic dark surface (contrast/readability); the pre-flight no longer recommends it and the self-check copy says so. Evidence: `docs/evidence/capture-sprint/v1/v1-compat-ab.json` + per-path state/captures.

Caveat recorded honestly: DXGI under 0x11 measured HIDDEN in this rig but showed content (luma 27.39) in the earlier controlled U1 run. DXGI behaviour is **host/run dependent**; do not claim "always leaks" or "always excludes". Black-box mode remains the targeted mitigation when it does leak.

### V2 — affinity routing policy (0x11 default, 0x01 targeted)

- `affinityMode` defaults to `exclude` (0x11); black box (0x01) is offered only for known-DXGI-hint or high-risk-app single-display RED setups, never by default and never when the overlay is already confirmed hidden.
- Copy states the cost: on paths that already hid the overlay you trade invisibility for a black band and the rectangle is discoverable. It is a targeted mitigation, not an upgrade.
- With black box on, the pre-flight recommends **COMPACT** (`switch-to-compact` → `applyProfile('card')`) so the band reads as a docked panel; it also offers **Switch back to invisible mode** when no known-DXGI/high-risk setup is detected.
- Evidence/tests: `docs/evidence/capture-sprint/preflight-v2/v2-affinity-preflight.json` (11 setup rows + 17 copy/behaviour assertions), preflight suite **55 tests**.

### V3 — macOS ScreenCaptureKit probe: attempted, BLOCKED at CI dispatch

Authored `.github/workflows/macos-sck-probe.yml` (SCK `SCScreenshotManager` probe + legacy `screencapture` A/B + TCC seed attempt) and `scripts/macos/{sck-probe.swift,probe-window.cjs}`. Trigger attempts: `gh workflow run macos-sck-probe.yml --ref sprint-resolve` → **HTTP 404 workflow not found on default branch** (branch not pushed; pushing is disallowed here); `desktop-build.yml` dispatch → **HTTP 422 no workflow_dispatch**; runners API → **HTTP 403** no permission. Even with a push, hosted runners cannot grant TCC Screen Recording (SIP-protected DB, no interactive approval). Exact output: `docs/evidence/macos-probe-attempt.txt`; plan: `docs/MACOS_PLAN.md`. **G-055 remains DEFERRED**; only a self-hosted logged-in Mac with TCC grant can close it.

### V4 — click-through flake: gated harness, 20/20 valid

The harness now asserts the actual state before any click: Electron tracked ignore-mouse value (getter when available), Win32 `WS_EX_TRANSPARENT` (0x20) on the overlay HWND, and a bounded `GetForegroundWindow` poll; SendInput happens only after both pass, otherwise the gate blocks the click and the iteration fails without touching counters. Fixed the prior forward-option bug (`setIgnoreMouseEvents(false, {forward:true})` → plain false).

Final 20 iterations with per-phase counter resets, isolated per-run ports, targeted S4 cleanup, and the full gate (Electron tracked ignore-mouse, `WS_EX_TRANSPARENT`, `GetForegroundWindow`, `WindowFromPoint`): **20/20 launches first attempt, 20/20 valid passes (100 %), 0 gate failures.** ON: target 0->1/overlay 0; OFF: overlay control 0->1/target 0. Gate medians 365 ms (ON)/362 ms (OFF), per-iteration median 9.06 s. Evidence: `docs/evidence/capture-sprint/s4/u4v-clickthrough-20x.json`.