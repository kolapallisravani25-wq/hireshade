# Undetectability claim (dated, evidence-bound)

**As of:** 2026-10-20 · **Branch:** sprint-capture · **Host:** Windows 11 10.0.22631, single 1366x768 display @1.05 scale, Electron 37.10.3.
**Evidence:** [CAPTURE_MATRIX.md](CAPTURE_MATRIX.md), [OVERLAY_SIZE.md](OVERLAY_SIZE.md), `docs/evidence/capture-sprint/`, `docs/evidence/stealth/`.

This page states exactly what is proven, where, on which capture path. It is deliberately narrower than the target's "100% undetectable" marketing.

## Proven — Windows, this host, OBSERVED

| Capture path | Result | How it was measured |
|---|---|---|
| GDI BitBlt (`Graphics.CopyFromScreen`, screenshots) | **Excluded** at BANNER and READING | hidden-window baseline + pixel diff through the same path (ON 0.004 %/0.28 % vs OFF 16.45 %/7.32 %); edge-ring analysis shows **0 px changed at the window border**, so the residual is interior desktop/clock noise, not an edge line |
| Chromium `desktopCapturer` **screen** source | **Excluded** | ON 0.104 %/0.117 % vs OFF 5.44 %/5.57 % |
| Chromium `desktopCapturer` **window** source | **Protected windows yield no pixels** (0x0 thumbnail) | on/off thumbnail dimensions |
| Chrome 155 + Edge full-screen share (real `getDisplayMedia`) | **Excluded** | protected overlay region sampled rgb 19,22,21 (not magenta); same-path positive control with protection OFF sampled 254,2,253 magenta |
| Chrome + Edge **tab** share | **Structurally safe** — the captured tab cannot contain another app's window; no overlay pixels in tab frames | `displaySurface=browser`, pixel sampling; exact app-tab selection caveat below |
| PrintWindow (`PW_RENDERFULLCONTENT`) | **No content leak**; protected transparent window renders all-black (caveat: black cannot fully distinguish WDA from transparent/DWM rendering; opaque path under verification this sprint) | PrintWindow bitmap + luma stats |
| ffmpeg `gdigrab` | Excluded (A/B frame diff 6.28 %/6.41 %) | recordings at BANNER/READING |
| OS affinity state | `GetWindowDisplayAffinity = 0x11` after 11/11 transitions (startup, all presets, resize, private toggle, compat toggle, simulated display metrics, simulated DPI) | Win32 probe per transition |
| Overlay sizes | COMPACT, BANNER (default), TELEPROMPTER, SIDE COLUMN, READING; BANNER 936x240, READING ~1257x635 | affinity assertions at each preset |

## Known failure — OBSERVED

- **The earlier "DXGI ignores 0x11" result was a detector artifact, not an exclusion failure.** X1 ran both detectors in the same run/window: content-specific marker = **0 pixels in 20/20** runs (HIDDEN), while the luma-only baseline method called "visible" in 8/20 merely because unrelated desktop content changed (luma means 3.97–6.17). U1's 27.39 was the IDE window underneath the excluded overlay, not the overlay (the saved crop shows that window); that claim is withdrawn. Under 0x11 on this software-composited host, DXGI Desktop Duplication is deterministically hidden by marker detection. **GPU-composited DXGI remains UNTESTED** — every Electron config on this host reports `gpu_compositing=disabled_software`, so the "GPU surface bypasses DWM" hypothesis could not be exercised. Do not claim a DXGI leak; do not claim universal exclusion either.
- **Black box mode (WDA_MONITOR 0x01) is CONCEALMENT and now OPTIONAL, not load-bearing.** It turns the overlay into a discoverable black rectangle, not a live answer. 0x01 in-process was established via koffi (readback 0x1); DXGI over the overlay region = mean luma 0.01/100 % black; GDI and PrintWindow also all-black. With X1 showing 0x11 hidden on DXGI in 20/20 marker runs, black box is no longer required for the tested DXGI path; it remains a fallback for unverified GPU-composited setups, offered only for known-DXGI/high-risk single-display setups **after window/tab sharing**, with cost copy, COMPACT recommendation and switch-back-to-invisible undo. It hides AI/answer-text sync; it does not make the overlay undetectable.
- **PrintWindow black rectangle**: a protected window prints black, which is discoverable. V1 measured transparent and opaque identical under 0x11 on all five paths (including PrintWindow); compatibility mode does **not** fix this and is demoted to cosmetic. Do not claim the black bar is fixed.

## Not verified — UNTESTED / UNTESTED-BLOCKED

- macOS: ScreenCaptureKit, QuickTime, `screencapture`, NSWindowSharingNone behaviour, TCC flow. Plan: [MACOS_PLAN.md](MACOS_PLAN.md). **No macOS host.**
- Real OS display scaling: live change **1.05 → 1.3125 (125 %)** via `DisplayConfigSetDeviceInfo` then restored; **150 % is not offered on this 1366×768 display** (Settings lists only 100 %, CCD `maxRelativeScale=1`). Registry `LogPixels` needs sign-in. **PARTIAL** — real path exercised at the host's maximum, 150 % requires different display hardware.
- Real second-monitor hot-plug: `screen.getAllDisplays()=1`; PnP/VideoController/DriverStore/pnputil found no virtual-display driver; `DisplaySwitch /extend` no-op; installing a driver needs admin. **UNTESTED-BLOCKED.** The second-monitor recommendation remains the default product advice but is unverified on real hardware here.
- Elevated vs non-elevated capture: agent is Medium integrity; `schtasks /RL HIGHEST` denied; interactive UAC cannot be approved unattended. **UNTESTED-BLOCKED.**
- Chrome/Edge tab share: **OBSERVED PASS** with `selfBrowserSurface=exclude` + a dedicated app-tab window (`displaySurface=browser`, app-tab DOM pixel 30,78,217, overlay magenta pixels 0). Tab share is the recommended share mode.
- Zoom/Teams/Meet/Webex/Lark/Chime native apps (not installed; represented only by API-level DXGI/WGC rows).
- Anti-cheat / kernel-level proctoring, process enumeration, network inspection, VM detection: **out of scope and unclaimed**. The overlay is an ordinary Electron window with a normal process name; a kernel driver can see it.

## What HireShade may say today (defensible)

> On Windows 10/11, with capture protection on, HireShade's overlay is excluded from GDI/screenshot capture, Chromium screen and window capture, Chrome/Edge full-screen sharing, and PrintWindow content capture at every shipped overlay size — tab sharing is structurally safe — and on this software-composited host it is also excluded from DXGI Desktop Duplication in 20/20 content-specific marker runs (the earlier luma-only "leak" was background contamination). **GPU-composited DXGI remains unverified**, so black box mode is offered only as an optional concealment fallback (a discoverable black rectangle, not invisibility), after a second monitor or window/tab sharing. Compatibility mode is cosmetic and does not change capture. macOS and elevated capture paths are not yet verified, and HireShade does not claim to defeat kernel-level proctoring or anti-cheat.

That is the sentence we can defend with this evidence. We do **not** claim "100 % undetectable on every platform and every capture path".
