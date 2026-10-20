# Windows screen-capture exclusion — proof (A/B)

**Claim proved:** with stealth enabled, HireShade's Electron overlay windows are fully visible on the physical desktop but are **absent from screen-capture pixels** on this Windows host. With stealth disabled, the same windows are captured normally. The application DOM is rendered in both cases (proved independently via CDP), so the difference is capture exclusion, not a rendering failure.

**Date:** 2026-10-20 (Asia/Calcutta) · **Host:** Windows, 1366×768 single display · **Shell:** `artifacts/desktop-electron` (Electron 37) · **Primitive:** `BrowserWindow.setContentProtection(true)` → Win32 `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE = 0x11)`.

## Method

1. Build the UI with relative asset paths for `file://` loading:
   `node artifacts/desktop-electron/scripts/build-ui.js`
2. Launch Electron with the harness's `ELECTRON_RUN_AS_NODE=1` **removed** (otherwise electron.exe runs as plain Node and `app` is undefined):
   `Remove-Item Env:ELECTRON_RUN_AS_NODE; cd artifacts/desktop-electron; electron .`
3. Raise both windows to the front (same screen position in both runs):
   `powershell -File artifacts/desktop-electron/scripts/bring-to-front.ps1`
4. Read the OS-level affinity: `powershell -File artifacts/desktop-electron/scripts/verify-capture-affinity.ps1`
5. Record the desktop with FFmpeg's GDI/DWM desktop capture for 5 s:
   `ffmpeg -f gdigrab -framerate 10 -i desktop -t 5 -c:v libx264 -pix_fmt yuv420p recording.mp4`
6. Capture the exact window rectangles with `capture-stealth-proof.ps1` (uses `Graphics.CopyFromScreen`).
7. Confirm the windows are actually rendering with CDP (`Runtime.evaluate` on `document.body.innerText` + `Page.captureScreenshot`), independent of capture exclusion.

The two runs differ **only** in `ELECTRON_STEALTH` (unset = stealth on; `0` = off). Same binary, same UI, same window geometry.

## Results

| Evidence | Stealth OFF | Stealth ON |
|---|---|---|
| `GetWindowDisplayAffinity` | `0x0` | **`0x11` (WDA_EXCLUDEFROMCAPTURE)** |
| Full-screen recording (5 s) | `recording-stealth-off.mp4` — HireShade launcher card and floating overlay visible | `recording-stealth-on.mp4` — **no HireShade pixels anywhere**; underlying app only |
| Frame at t=2 s | `frame-stealth-off.png` — "HireShade / Login to your HireShade account…" + "Claude Haiku 4.5 / Waiting for session…" visible | `frame-stealth-on.png` — same region, HireShade absent |
| Window-rectangle capture | `window-region-*-190216/191049.png` show the UI | `window-region-*-190240/191215/191216.png` show only the desktop behind |
| CDP DOM text (both runs) | launcher: "HireShade / Login to your HireShade account…"; floating: "Claude Haiku 4.5 / FAST / 00:00 / Waiting for session… / Disconnected / AI Answer / Analyze Screen" | identical — the app renders while excluded |
| CDP screenshot | `cdp-Launcher.png`, `cdp-Floating-Mini-Screen.png` | same (web-contents capture is not the OS capture path) |

SHA-256 (first 16 hex chars):

| File | SHA-256 |
|---|---|
| `capture-proof.json` | `9C9D3012C5FEBF16…` |
| `recording-stealth-off.mp4` | `DFCA5FD39D1F1F00…` |
| `recording-stealth-on.mp4` | `2987227DA5F251BE…` |
| `frame-stealth-off.png` | `190ED644CD029331…` |
| `frame-stealth-on.png` | `440EF3CE2E78DE07…` |

## Why this is the right primitive

- `WDA_MONITOR` (0x1) would make the window a **black rectangle** in captures — itself a red flag to a proctor. `WDA_EXCLUDEFROMCAPTURE` (0x11) makes it *not present* in the captured image while it stays visible to the user.
- The target product uses the same Electron API: `main.js` offset **1847067**: `t.setPrivateMode=function(e){…o.mainWindow.setContentProtection(e)…}` — toggled by a stored `isPrivate` setting. Our Electron shell applies it always-on (env opt-out for testing only), which is equivalent to the target's private-mode ON state.
- The target additionally uses `setAlwaysOnTop(true,"screen-saver",1)` + 1 s re-assert, `skipTaskbar`, `hiddenInMissionControl`, `movable:false`, and `setIgnoreMouseEvents(true,{forward:true})` (offsets in `docs/raw/desktop/target-scan.json`); our Electron shell mirrors the window flags and the verification harness validates the affinity they produce.

## Scope and limits (honest)

- **OBSERVED:** Windows desktop capture via GDI `CopyFromScreen` and FFmpeg `gdigrab` excludes the window. `GetWindowDisplayAffinity` is `0x11` while the window is visible (`IsWindowVisible = true`).
- **INFERRED (not tested here):** every capture pipeline that respects the OS display-affinity contract (Teams/Zoom/Meet screen share, OBS display capture, browsers' `getDisplayMedia`, Windows Snipping Tool) will also exclude the window. This is the documented behavior of `WDA_EXCLUDEFROMCAPTURE`, but per-application verification is a manual step (see `docs/RUNBOOK.md`).
- **NOT COVERED:** macOS (no macOS host — DEFERRED, GAP_MATRIX G-007), Linux, multi-monitor, High-DPI, windows re-creation after a driver reset.
- **NOT CLAIMED:** "undetectable by anti-cheat" in general. This proves the screen-capture channel only. The process name, window class, network traffic, and timing remain observable by a kernel-level proctor and are outside this evidence.

## Reproduce

```powershell
# from repo root, with the Electron deps installed
node artifacts/desktop-electron/scripts/build-ui.js
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
cd artifacts/desktop-electron

# OFF (control)
$env:ELECTRON_STEALTH='0'; Start-Process .\node_modules\.bin\electron.cmd -ArgumentList '.' 
# wait for windows, then:
powershell -File scripts/bring-to-front.ps1
ffmpeg -y -f gdigrab -framerate 10 -i desktop -t 5 -c:v libx264 docs/../docs/evidence/stealth/recording-stealth-off.mp4

# ON
Get-Process electron | Stop-Process -Force
Remove-Item Env:ELECTRON_STEALTH
Start-Process .\node_modules\.bin\electron.cmd -ArgumentList '.'
powershell -File scripts/bring-to-front.ps1
powershell -File scripts/verify-capture-affinity.ps1   # expect 0x11
ffmpeg -y -f gdigrab -framerate 10 -i desktop -t 5 -c:v libx264 docs/../docs/evidence/stealth/recording-stealth-on.mp4
```

The `capture-proof.json` in this directory is the machine-readable record of the final stealth-ON capture (affinity, rectangles, artifact paths).
