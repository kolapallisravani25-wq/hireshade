# Stealth wiring evidence (G-009, G-010, G-011, G-012)

Task: task-5. Branch: complete-build. No commits made. The pre-existing A/B capture
proof in docs/evidence/stealth/ was NOT modified; this directory is the evidence for
the new wiring (Rust stealth module, Electron hotkeys/overlay controls, CSP).

## 1. Rust / Tauri (G-011)

### 1.1 cargo check - baseline (before changes)

    cd artifacts/craft-vita/src-tauri
    cargo check --message-format=short
    -> Finished dev profile in 3m 09s; 9 warnings:
       screen_protect.rs: WDA_MONITOR unused, set_screen_protection unused, apply_on_create unused
       focus_bypass.rs: HOOK/event_hook/install_focus_bypass/uninstall_focus_bypass unused
       cursor.rs: hide_system_cursor/show_system_cursor unused
    Log: cargo-check-baseline.log (raw output; pwsh wraps native stderr as NativeCommandError)

### 1.2 cargo check - after wiring

    cargo check --message-format=short
    -> Finished dev profile in 15.53s, EXITCODE=0, ZERO warnings/errors
    Log: cargo-check-after.log

What changed:
- screen_protect.rs: WDA_EXCLUDEFROMCAPTURE 0x11 primary, WDA_MONITOR 0x01 fallback,
  pure apply_first_supported() policy + 7 unit tests; fixed HWND handling for Tauri's
  windows 0.61 handle (raw pointer field, not isize); portable apply_to_window()
  (Tauri set_content_protected on non-Windows). Applied in setup to mini/launcher,
  on floating/mini/launcher creation paths, and through the new
  set_screen_protection command. toggle_content_protection now routes overlay
  windows through this explicit path and keeps the main dashboard on Tauri's API.
- cursor.rs: rewritten to be cfg-portable; hide_system_cursor / show_system_cursor
  are registered in invoke_handler (were dead code).
- focus_bypass.rs: DELETED. It installed a WinEvent hook with an empty callback
  (no behavior at all); wiring it would have been cosmetic. mod declaration removed.

### 1.3 cargo test --lib

    cargo test --lib
    -> 14 passed; 0 failed (7 new screen_protect tests + 7 existing mini_state tests)
    -> Finished test profile in 4m 30s, EXITCODE=0
    Log: cargo-test.log

## 2. TypeScript unit tests / typecheck

    cd artifacts/craft-vita
    pnpm exec vitest run src/overlay/hotkeys.test.ts src/overlay/overlayGeometry.test.ts src/overlay/tauriCsp.test.ts
    -> 3 files / 41 tests passed, EXITCODE=0
    Log: overlay-vitest.log

Full craft-vita suite (includes other teammates' current work):

    pnpm exec vitest run
    -> 32 files / 376 tests passed, EXITCODE=0
    Log: frontend-vitest.log

Typecheck status:
- Pure overlay modules (my new files) in isolation:
  pnpm exec tsc --noEmit --skipLibCheck --strict --target ES2022 --module ESNext --moduleResolution Bundler src/overlay/hotkeys.ts src/overlay/overlayGeometry.ts
  -> EXITCODE=0 (typecheck-pure-overlay.log)
- Full craft-vita typecheck (tsc -p tsconfig.json --noEmit) was RED at the time of
  writing, only because of files owned by other in-flight teammates, NOT my files:
  src/pages/Launcher/WidgetApp.tsx JSX unclosed tags (mid-edit) and earlier
  ../api-server/src/lib/mocks/*.ts Request.userId typing errors.
  Log: typecheck-craft-vita.log. Re-run after their edits land.
- The first full run also caught a real bug in my code (index.ts exported
  HOTKEY_ACTIONS before it existed); HOTKEY_ACTIONS was added to hotkeys.ts and
  the isolated typecheck is now clean.

## 3. Electron runtime proof (G-009, G-010, T-02..T-07)

Prerequisite that cost two failed launches (recorded so it is not repeated):
ELECTRON_RUN_AS_NODE=1 is set in this shell environment. Electron must be launched
with it unset, otherwise require("electron") returns a path string and main.js dies
with "Cannot read properties of undefined (reading 'setPath')".

Launch used:

    Remove-Item Env:ELECTRON_RUN_AS_NODE
    $env:HIRESHADE_DEBUG_CDP='9223'      # adds --remote-debugging-port (debug only)
    $env:HIRESHADE_DEBUG_IPC='1'         # enables debug:invoke-action (evidence only)
    $env:HIRESHADE_USER_DATA='...\docs\evidence\stealth-wiring\userdata'
    $env:HIRESHADE_LOG_FILE='...\electron-main-1.log'
    pnpm start                          # prestart builds the shared helpers, then electron .

### 3.1 Hotkey registration (T-07 two sets + HireShade safety keys)

electron-main-1.log lines 2-15 show all 14 bindings registered (registered: true in
electron-state-initial.json):
- app set: CommandOrControl+Shift+H / +Shift+X / +Shift+M and +Shift+Up/Down/Left/Right
- live-call set (registered while the floating overlay is visible):
  CommandOrControl+Enter, +Shift+Enter, +Up/Down, +H, +Left/Right

### 3.2 Panic hide via a REAL OS hotkey (not debug IPC)

    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("^+x")   # Ctrl+Shift+X
    -> electron-main-1.log: "[hotkeys] fired panic-hide"
    -> CDP state (electron-state-after-panic.json): floating.visible=false,
       launcher.visible=false
    -> OS enumeration (window-visibility-after-panic.log):
       HWND=... visible=False title=Launcher
       HWND=... visible=False title=Floating Mini-Screen (aff=0x11)

Then Ctrl+Shift+H -> "[hotkeys] fired toggle-overlay", floating.visible=true
(electron-state-after-restore.json). Ctrl+Shift+M -> "[hotkeys] fired cycle-model",
model -> anthropic/claude-sonnet-4.5 (same log, state activeModel).

### 3.3 Overlay controls over contextIsolation-safe IPC

Node script scripts/cdp-verify-overlay.mjs (run with CDP_PORT=9223) drives
window.hireshadeDesktop in the real renderer:
- preload bridge present; no window.require/process/module leak
- all checked hotkeys report registered:true
- opacity -> 0.55 persisted + BrowserWindow.getOpacity()=0.55
- dynamic click-through false -> true persisted
- position preset top-right: window right edge within 16 px of screen.availWidth,
  preset label stored as top-right
- private mode false -> true persisted
Result: 16/16 checks PASS (electron-overlay-controls.json).

### 3.4 Persistence across a real relaunch

Kill app, relaunch with the same HIRESHADE_USER_DATA:
- persisted-overlay-settings.json: opacity 0.55, positionPreset top-right,
  bounds.floating {x:583,y:16,w:702,h:363}, isPrivate true
- electron-state-after-restart.json: opacity 0.55 / windowOpacity 0.55,
  preset top-right, bounds restored {x:582,y:15,w:704,h:365}
- electron-main-2.log: "[settings] loaded ... opacity=0.55, preset=top-right"

## 4. CSP (G-012)

tauri.conf.json app.security.csp is no longer null. Production policy covers
default-src 'self', script-src self + clerk.hireshade.com + *.clerk.accounts.dev +
*.clerk.com + checkout.razorpay.com + challenges.cloudflare.com; connect-src adds
ipc: + http://ipc.localhost, *.hireshade.com, Razorpay (api/checkout/lumberjack),
wss://api.deepgram.com, ws/http localhost for the native-audio WebSocket;
frame-src for Clerk/Razorpay/Cloudflare; object-src 'none'. No 'unsafe-eval' or bare
https: in production. devCsp keeps Vite HMR working via 'unsafe-eval',
'unsafe-inline', ws://localhost:5173 and ws://127.0.0.1:5173.

Test: src/overlay/tauriCsp.test.ts (4 tests, in the 41 above).

## 5. Deviations / unverified

1. Tauri global hotkeys remain Electron-only. tauri-plugin-global-shortcut is not
   in the local Cargo registry cache; adding it needs a network fetch + Cargo.lock
   change (explicitly out of scope: risky dependency work). Documented in
   artifacts/desktop-electron/README.md. The pure binding model is shared, so adding
   the plugin later is registration + capability permissions only.
2. T-02 says one BrowserWindow; the Electron shell still creates two (launcher +
   floating) because craft-vita ships separate HTML entries and the launcher must
   stay interactive while the overlay moves. T-02 flags were applied to the floating
   overlay; movable/resizable intentionally stay true so position presets and
   drag-to-move (G-010) work. type:"panel" is macOS-only in Electron.
3. cmd+H (T-07 live hide) is reserved by macOS; findConflicts reports it as a
   warning and registration failure is logged, never fatal. The Electron-only
   target is Windows here, where Ctrl+H registers fine.
4. The click-through hit-test was verified at the settings/IPC level and by
   inspecting preload logic; Electron exposes no getter for "ignore mouse events",
   so the actual OS-level click-through flip is not read back in this evidence.
   Hit-test semantics are adapted, not literal: craft-vita has 0
   [data-transparent='true'] markers and 24 [data-interactive] markers, so preload
   passes the pointer through by default, captures it over [data-interactive]
   islands, and still honors [data-transparent='true'] as an explicit opt-out.
   Using the target's literal !matches([data-transparent]) formula would have made
   every unmarked surface click-through and the overlay unusable.
5. The launcher window reported WDA affinity 0x0 while hidden in
   window-visibility-after-panic.log (floating reported 0x11). The authoritative
   A/B capture proof for visible windows remains docs/evidence/stealth/
   (capture-proof.json reports 0x11 for both windows when shown).
6. macOS runtime (always-on-top/panel/dock) not exercised: Windows host only.
