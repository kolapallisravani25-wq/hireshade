# @workspace/desktop-electron

Parallel **Electron** desktop shell for the HireShade web UI (artifacts/craft-vita). The Tauri build (artifacts/craft-vita/src-tauri) is untouched; this package runs the same Vite front end inside Electron, mirroring the Tauri window config (frameless, transparent, always-on-top, skip-taskbar).

This shell now also owns the desktop stealth/overlay stack, aligned to docs/TARGET_VERIFIED.md T-02..T-07.

## Commands

- pnpm --filter @workspace/desktop-electron run dev — builds the shared main helpers, starts the craft-vita Vite dev server (port 5173), then launches the Electron windows pointed at it (HMR works inside the desktop windows).
- pnpm --filter @workspace/desktop-electron run build:ui — builds craft-vita to artifacts/craft-vita/dist/public with all three HTML entries (index, launcher, floating) and relative asset URLs.
- pnpm --filter @workspace/desktop-electron run start — launches Electron in production mode, loading the built files over file://. A prestart hook rebuilds the main helpers.
- pnpm --filter @workspace/desktop-electron run build:helpers — compiles the shared pure-TS contract modules (craft-vita/src/overlay/hotkeys.ts and overlayGeometry.ts) to artifacts/desktop-electron/lib/*.js for main/preload.

## Stealth mode (capture exclusion, T-04)

BrowserWindow.setContentProtection() is the only exclusion primitive:

- Windows: maps to SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) inside Electron; the window stays on screen but disappears from shares/recordings/screenshots.
- macOS: window sharing exclusion via CoreGraphics.
- Linux: GTK-backed behavior (weakest support).

The setting is persisted as isPrivate in userData/overlay-settings.json and re-applied on every show/restore/focus (a re-created window must not silently become capturable). ELECTRON_STEALTH=0 disables it for debugging. The existing A/B capture evidence lives in docs/evidence/stealth/ (untouched); the new wiring evidence lives in docs/evidence/stealth-wiring/.

The Tauri side of the same feature is the Rust screen_protect.rs module: explicit WDA_EXCLUDEFROMCAPTURE (0x11) with a WDA_MONITOR (0x01) fallback, applied on window creation and through the set_screen_protection command (see artifacts/craft-vita/src-tauri/src/screen_protect.rs).

## Overlay window flags and always-on-top (T-02/T-03)

The floating overlay is created with: transparent, roundedCorners:false, hasShadow:false, alwaysOnTop:true, frame:false, skipTaskbar:true, hiddenInMissionControl:true, backgroundThrottling:false, experimentalFeatures:true, and type:"panel" on macOS. It also enables webContents.setBackgroundThrottling(false) and (Windows) the disable-features=CalculateNativeWinOcclusion Chromium switch, plus a 1000 ms setAlwaysOnTop(true, "screen-saver", 1) watchdog. macOS uses setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true}) and a one-shot app.dock.hide().

Deviation from the target: the shell keeps two BrowserWindows (launcher + floating) instead of one, because craft-vita ships separate launcher.html / floating.html entries and the product needs a persistent launcher while the overlay moves independently. movable/resizable stay true so position presets and drag-to-move keep working (G-010). The flag matrix is therefore applied to the floating overlay window.

## Global hotkeys (T-07)

Defined once in craft-vita/src/overlay/hotkeys.ts (pure, unit-tested) and registered by main.js. Two sets:

App set (always registered, so the overlay can always be restored):
- CommandOrControl+Shift+H — toggle overlay
- CommandOrControl+Shift+X — panic hide (all windows)
- CommandOrControl+Shift+M — cycle AI model
- CommandOrControl+Shift+Up/Down/Left/Right — nudge overlay (24 px steps)

Live-call set (registered only while the floating overlay is visible):
- CommandOrControl+Enter — primary answer
- CommandOrControl+Shift+Enter — secondary answer
- CommandOrControl+Up/Down — previous/next message
- CommandOrControl+H — hide overlay
- CommandOrControl+Left/Right — previous/next AI answer

Native effects in main: toggle-overlay, panic-hide, cycle-model (emits model id), overlay nudges, live-hide-overlay. The remaining live-call actions are broadcast to the renderer as {action} on the desktop:hotkey IPC channel for the session UI to consume.

Registration conflicts (OS-owned combinations such as Command+H on macOS, or a shortcut already taken by another app) are logged and never crash the app; reserved combos are surfaced by findConflicts() in the pure module.

### Tauri global-shortcut gap (documented)

The Tauri build does NOT register global hotkeys. The sanctioned implementation is tauri-plugin-global-shortcut, which is not present in the local Cargo registry cache; adding it requires a new crates.io fetch + Cargo.lock change (network-dependent dependency work explicitly out of scope for this task). Therefore:

- Global hotkeys are Electron-only today.
- The Tauri commands needed by an in-window fallback are wired: set_screen_protection, hide_system_cursor, show_system_cursor.
- The binding model itself is shared and platform-neutral, so adding the plugin later is a main.rs registration + capability permission change, not a rewrite.

## Overlay controls (IPC, contextIsolation)

preload.js exposes only a whitelisted API on window.hireshadeDesktop (sandboxed preload, contextIsolation:true, nodeIntegration:false, no raw ipcRenderer). Main handles:

- desktop:overlay:get-settings / desktop:hotkeys:get-bindings / desktop:overlay:get-state
- desktop:overlay:set-opacity (0.20 - 1.00, window-level opacity on the floating overlay)
- desktop:overlay:set-click-through (enables/disables the dynamic hit-test mode)
- desktop:overlay:set-private-mode (persisted setContentProtection)
- desktop:overlay:apply-position-preset (top-left/top-center/top-right/center/bottom-left/bottom-center/bottom-right)
- desktop:overlay:pointer-pass-through (fire-and-forget, preload-only)
- desktop:debug:invoke-action (only with HIRESHADE_DEBUG_IPC=1; used by evidence scripts)

Position/opacity/private/click-through state persists to userData/overlay-settings.json. Window moved/resized events are debounced and written back, so a manual move reopens in the same place and demotes the preset label to "custom"; choosing a preset records the preset name + computed bounds.

Dynamic click-through (T-06) lives in preload.js: mousemove is throttled to 40 ms and flips setIgnoreMouseEvents(ignore, {forward:true}); pass-through is suppressed while dragging and cleared on mouseleave. It only applies to the floating window. Hit-testing supports the target's [data-transparent='true'] opt-out and craft-vita's existing [data-interactive] island convention (an unmarked surface passes through, an interactive island captures the pointer); without the interactive fallback every unmarked surface would become click-through and the overlay UI would be unusable.

## Dev CSP

tauri.conf.json now has a restrictive production CSP (self + Clerk + Razorpay + HireShade API + Deepgram WSS + Tauri IPC) and a separate devCsp that adds unsafe-inline/unsafe-eval and ws://localhost:5173 so Vite HMR keeps working. Covered by craft-vita/src/overlay/tauriCsp.test.ts.

## Verification

- pnpm --filter @workspace/craft-vita exec vitest run src/overlay — 41 unit tests (hotkeys, geometry/persistence, CSP manifest).
- cd artifacts/craft-vita/src-tauri; cargo check — no dead-code warnings for stealth modules; cargo test --lib runs the screen_protect fallback tests.
- Runtime: start with HIRESHADE_DEBUG_CDP=9222 and HIRESHADE_DEBUG_IPC=1, then run node scripts/cdp-verify-overlay.mjs and node scripts/cdp-overlay-state.mjs. Evidence is written to docs/evidence/stealth-wiring/.
