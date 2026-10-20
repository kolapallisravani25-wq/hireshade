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

- **DXGI Desktop Duplication can ignore WDA_EXCLUDEFROMCAPTURE (0x11), but the result is host-dependent.** In the controlled U1 run ffmpeg `ddagrab` showed the overlay in both ON and OFF states (ON vs baseline 49.8 %, OFF 42.9 %); in the V1 rig with a 0x00 positive control the same 0x11 window measured hidden. Do not claim "always leaks" or "always excludes". When it leaks, answer text syncs with questions - that is the damning tell. Mitigations: **black box mode** (concealment), monitor 2, or window/tab sharing. Compatibility mode does not help DXGI.
- **Black box mode (WDA_MONITOR 0x01) is CONCEALMENT, not invisibility.** It turns the overlay into a discoverable black rectangle, not a live answer. U1 established 0x01 in-process via koffi on the app's own HWND (readback 0x1); DXGI over the overlay region = **mean luma 0.01, 100 % black** (vs 0x11: 27.39 luma / content visible); GDI and PrintWindow also all-black. It is persisted (`captureState.affinityMode`), re-asserted on the same triggers, offered only for known-DXGI/high-risk single-display setups with explicit cost copy, and paired with a COMPACT recommendation and a switch-back-to-invisible undo. It hides that the overlay is AI and hides the answer text/question sync; it does not make the overlay undetectable.
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

> On Windows 10/11, with capture protection on, HireShade's overlay is excluded from GDI/screenshot capture, Chromium screen and window capture, Chrome/Edge full-screen sharing, and PrintWindow content capture at every shipped overlay size — tab sharing is structurally safe — and if your meeting app captures with DXGI Desktop Duplication (which can ignore normal exclusion, host-dependent), black box mode **conceals** the overlay as a black rectangle in that capture: it is discoverable, but your answer text and question sync are not readable. The app recommends a second monitor or window/tab sharing before relying on that. Compatibility mode is cosmetic and does not change capture. macOS and elevated capture paths are not yet verified, and HireShade does not claim to defeat kernel-level proctoring or anti-cheat.

That is the sentence we can defend with this evidence. We do **not** claim "100 % undetectable on every platform and every capture path".
