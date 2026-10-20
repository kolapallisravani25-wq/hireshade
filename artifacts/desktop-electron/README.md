# @workspace/desktop-electron

Parallel **Electron** desktop shell for the HireShade web UI (`artifacts/craft-vita`). The existing Tauri build (`artifacts/craft-vita/src-tauri`) is untouched; this package runs the same Vite front end inside Electron, mirroring the Tauri window config (frameless, transparent, always-on-top, skip-taskbar).

## Commands

- `pnpm --filter @workspace/desktop-electron run dev` — starts the craft-vita Vite dev server (port 5173), then launches the Electron windows pointed at it (HMR works inside the desktop windows).
- `pnpm --filter @workspace/desktop-electron run build:ui` — builds craft-vita to `artifacts/craft-vita/dist/public` with all three HTML entries (`index`, `launcher`, `floating`) and relative asset URLs.
- `pnpm --filter @workspace/desktop-electron run start` — launches Electron in production mode, loading the built files over `file://`.

## Stealth mode (capture exclusion)

Enabled always-on for **every** window via `BrowserWindow.setContentProtection(true)`
(`main.js` → `applyStealth`, re-asserted on `show`/`restore`/`focus`). This maps to:

- Windows: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — the window stays on screen but is excluded from screen shares, recording, and screenshots.
- macOS: window-level capture-sharing exclusion via CoreGraphics.
- Linux: GTK-backed behavior (weakest support of the three platforms).

Verify at the OS level with `scripts/verify-capture-affinity.ps1` (queries `GetWindowDisplayAffinity`; app windows should report `0x11` while running).

## Notes

- Microphone permission is granted via `session.setPermissionRequestHandler` (`main.js` → `allowMediaPermissions`) because the floating screen uses `getUserMedia`/WebSocket transcription.
- Windows are sandboxed renderers with `contextIsolation`, no Node integration, no preload; the UI uses the browser `tauri-stubs` path of the Vite build.
- Single-instance lock: a second launch focuses the existing launcher window.
