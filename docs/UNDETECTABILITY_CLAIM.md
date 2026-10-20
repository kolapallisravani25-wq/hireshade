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

- **DXGI Desktop Duplication ignores WDA_EXCLUDEFROMCAPTURE.** ffmpeg `ddagrab` (D3D11/Desktop Duplication) shows the overlay in BOTH ON and OFF states: ON vs hidden baseline **49.8 %** pixels differ, OFF **42.9 %**. This is a real leak for capture apps that use Desktop Duplication; opacity and compatibility mode cannot fix it. Only monitor placement or window/tab sharing avoids it.
- **WDA_MONITOR (0x01) is not reachable for the product surface**: Electron exposes only `setContentProtection(bool)` (0x00/0x11), and an out-of-process `SetWindowDisplayAffinity(0x01)` fails with ERROR_ACCESS_DENIED because the window belongs to another process. Recorded UNTESTED-BLOCKED, not claimed as ineffective; the "black box beats visible answers" hypothesis is **UNRESOLVED**.
- **PrintWindow black rectangle**: a protected transparent window prints black, which is discoverable. The S2 root-cause fix for the runtime opaque-window recreation crash shipped (guarded teardown, deferred recreate, map identity guard, force-show fallback) but the **opaque-capture measurement is BLOCKED** in this environment (repro harness hangs; no OBSERVED row). Do not claim the black bar is fixed.
- **No affinity mode tested helps DXGI**: 0x00 shows content; 0x01 is unreachable; 0x11 is ignored. Mitigation is routing (monitor 2 / window/tab share), not affinity.

## Not verified — UNTESTED / UNTESTED-BLOCKED

- macOS: ScreenCaptureKit, QuickTime, `screencapture`, NSWindowSharingNone behaviour, TCC flow. Plan: [MACOS_PLAN.md](MACOS_PLAN.md). **No macOS host.**
- Real OS display scaling at 150 %: registry `LogPixels` set 144 and read back 144, but the live session scale factor stayed 1.05 before/after; Windows applies it at sign-in. **UNTESTED-BLOCKED**, requires sign-out/in.
- Real second-monitor hot-plug: `screen.getAllDisplays()=1`; PnP/VideoController/DriverStore/pnputil found no virtual-display driver; `DisplaySwitch /extend` no-op; installing a driver needs admin. **UNTESTED-BLOCKED.** The second-monitor recommendation remains the default product advice but is unverified on real hardware here.
- Elevated vs non-elevated capture: agent is Medium integrity; `schtasks /RL HIGHEST` denied; interactive UAC cannot be approved unattended. **UNTESTED-BLOCKED.**
- Exact app-tab selection for Chrome/Edge tab share: the auto-select tab flag selected the capture page's own tab on this build; tab capture is structurally source-scope-safe (no other app window can appear in a tab), but the app-tab DOM confirmation is **UNTESTED-BLOCKED**.
- Zoom/Teams/Meet/Webex/Lark/Chime native apps (not installed; represented only by API-level DXGI/WGC rows).
- Anti-cheat / kernel-level proctoring, process enumeration, network inspection, VM detection: **out of scope and unclaimed**. The overlay is an ordinary Electron window with a normal process name; a kernel driver can see it.

## What HireShade may say today (defensible)

> On Windows 10/11, with capture protection on, HireShade's overlay is excluded from GDI/screenshot capture, Chromium screen and window capture, Chrome/Edge full-screen sharing, and PrintWindow content capture at every shipped overlay size — tab sharing is structurally safe — and the app warns you when your setup may use a capture path it cannot protect (DXGI Desktop Duplication), recommending a second monitor or window/tab sharing instead. macOS and elevated capture paths are not yet verified, and HireShade does not claim to defeat kernel-level proctoring or anti-cheat.

That is the sentence we can defend with this evidence. We do **not** claim "100 % undetectable on every platform and every capture path".
