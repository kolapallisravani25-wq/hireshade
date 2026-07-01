use tauri::{Manager, Emitter, WebviewWindowBuilder, WebviewUrl, AppHandle, Window, PhysicalPosition, LogicalSize, command};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose};
use std::sync::{Arc, atomic::{AtomicU64, AtomicBool, AtomicU8, Ordering}};
use url::Url as NavUrl;

// Deepgram realtime transport (macOS + Windows only).
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod deepgram;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use deepgram::{DeepgramConfig, SttChannel};

/// Monotonic version counter — every new animation request bumps this.
static ANIM_VERSION: AtomicU64 = AtomicU64::new(0);
static SESSION_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── Native audio WebSocket state ─────────────────────────────────────────────
// On macOS, WKWebView never returns audio tracks from getDisplayMedia.
// We capture the default input device (mic, or a virtual loopback device such
// as BlackHole that routes app/tab audio) in Rust via cpal, then stream raw
// PCM frames over a localhost WebSocket so the frontend can feed them to
// Deepgram directly.
//
// 3-state guard: 0 = STOPPED, 1 = STARTING, 2 = RUNNING
// compare_exchange(0→1) ensures only one startup attempt proceeds at a time;
// any concurrent call while in STARTING or RUNNING returns early.
// This eliminates the race window between "starting" and "port ready" that
// caused repeated macOS TCC (permission) prompts.
const AUDIO_STOPPED: u8 = 0;
const AUDIO_STARTING: u8 = 1;
const AUDIO_RUNNING_STATE: u8 = 2;

#[cfg(any(target_os = "macos", target_os = "windows"))]
static AUDIO_STATE: AtomicU8 = AtomicU8::new(AUDIO_STOPPED);
// Keep AtomicBool for the cpal loop-exit signal (stream keep-alive thread reads this)
#[cfg(any(target_os = "macos", target_os = "windows"))]
static AUDIO_RUNNING: AtomicBool = AtomicBool::new(false);

#[cfg(any(target_os = "macos", target_os = "windows"))]
static AUDIO_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

/// ScreenCaptureKit display audio stream state.
/// Captures system/tab audio from the primary display — does NOT require a
/// virtual audio device (BlackHole/Loopback).  Requires macOS 13.0+ and the
/// user to have granted Screen Recording permission.
///
/// Same 3-state guard: 0 = STOPPED, 1 = STARTING, 2 = RUNNING
#[cfg(any(target_os = "macos", target_os = "windows"))]
static DISPLAY_AUDIO_STATE: AtomicU8 = AtomicU8::new(AUDIO_STOPPED);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static DISPLAY_AUDIO_RUNNING: AtomicBool = AtomicBool::new(false);

#[cfg(any(target_os = "macos", target_os = "windows"))]
static DISPLAY_AUDIO_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

/// Monotonic generation counter — incremented on every stop so a previous
/// zombie thread knows to exit even if DISPLAY_AUDIO_RUNNING was re-set to
/// true by a rapid stop→start sequence.
#[cfg(any(target_os = "macos", target_os = "windows"))]
static DISPLAY_AUDIO_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Rust-native Parakeet-style STT — Deepgram WS lives in Rust, the webview
/// only receives emitted transcript events (no raw audio in JS at all).
#[cfg(any(target_os = "macos", target_os = "windows"))]
static SYSTEM_STT_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static SYSTEM_STT_GENERATION: AtomicU64 = AtomicU64::new(0);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static SYSTEM_STT_STATE: AtomicU8 = AtomicU8::new(AUDIO_STOPPED);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static MIC_STT_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static MIC_STT_GENERATION: AtomicU64 = AtomicU64::new(0);
#[cfg(any(target_os = "macos", target_os = "windows"))]
static MIC_STT_STATE: AtomicU8 = AtomicU8::new(AUDIO_STOPPED);

// ─────────────────────────────────────────────────────────────────────────────

/// Window subclass proc for the mini overlay.
/// Returns HTTRANSPARENT (-1) for the transparent rounded-corner zones so that
/// mouse clicks pass through to whatever is underneath; everything else is
/// handled normally (drag, buttons, etc.).
#[cfg(target_os = "windows")]
unsafe extern "system" fn mini_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _uid_subclass: usize,
    _ref_data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{RECT, LRESULT};
    use windows::Win32::UI::WindowsAndMessaging::{WM_NCHITTEST, WM_NCCALCSIZE, GetWindowRect};
    use windows::Win32::UI::Shell::DefSubclassProc;

    // Intercept WM_NCCALCSIZE (wParam=TRUE) and return 0 so that the entire
    // window rect becomes the client rect — zero NC area — which is the only
    // reliable way to eliminate the DWM accent border at OS level on all
    // Windows versions, without also killing the compositor drop-shadow.
    if msg == WM_NCCALCSIZE && wparam.0 != 0 {
        return LRESULT(0);
    }

    if msg == WM_NCHITTEST {
        // Screen-space cursor position packed into LPARAM
        let pt_x = (lparam.0 & 0xFFFF) as i16 as i32;
        let pt_y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;

        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);

        let cx = pt_x - rect.left;
        let cy = pt_y - rect.top;
        let w  = rect.right  - rect.left;
        let h  = rect.bottom - rect.top;
        let r  = 12i32; // matches Tailwind `rounded-xl`

        if cx < 0 || cy < 0 || cx > w || cy > h {
            return LRESULT(-1); // HTTRANSPARENT
        }

        let in_corner =
            (cx <   r && cy <   r && (cx-r)*(cx-r)         + (cy-r)*(cy-r)         > r*r) ||
            (cx > w-r && cy <   r && (cx-(w-r))*(cx-(w-r)) + (cy-r)*(cy-r)         > r*r) ||
            (cx <   r && cy > h-r && (cx-r)*(cx-r)         + (cy-(h-r))*(cy-(h-r)) > r*r) ||
            (cx > w-r && cy > h-r && (cx-(w-r))*(cx-(w-r)) + (cy-(h-r))*(cy-(h-r)) > r*r);

        if in_corner {
            return LRESULT(-1); // HTTRANSPARENT
        }

        return DefSubclassProc(hwnd, msg, wparam, lparam);
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Remove every OS-level visual chrome from a Tauri window:
///  - accent / focus border (blue ring)
///  - top-edge highlight / caption outline
///  - drop shadow
///  - black background behind transparent/rounded corners
#[cfg(target_os = "windows")]
fn remove_window_border(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute,
        DWMWA_BORDER_COLOR,
        // DWMNCRP_DISABLED and DWMWCP_DONOTROUND removed: the WM_NCCALCSIZE
        // intercept in mini_subclass_proc collapses NC area to zero which is
        // the definitive fix. DWMNCRP_DISABLED also kills the DWM shadow;
        // DWMWCP_DONOTROUND was only needed to suppress the top-edge outline
        // that rounded corners create, which disappears with NC area = 0.
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SetWindowLongPtrW, GetWindowLongPtrW,
        GWL_STYLE, GWL_EXSTYLE,
        WS_BORDER, WS_DLGFRAME, WS_THICKFRAME, WS_CAPTION,
        WS_EX_DLGMODALFRAME, WS_EX_CLIENTEDGE, WS_EX_STATICEDGE, WS_EX_WINDOWEDGE,
        SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_FRAMECHANGED,
    };
    unsafe {
        // Strip NC frame window styles so Windows allocates no NC space even
        // before WM_NCCALCSIZE fires (belt-and-suspenders with the subclass).
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let mask  = (WS_BORDER.0 | WS_DLGFRAME.0 | WS_THICKFRAME.0 | WS_CAPTION.0) as isize;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !mask);

        let ex      = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let ex_mask = (WS_EX_DLGMODALFRAME.0
            | WS_EX_CLIENTEDGE.0
            | WS_EX_STATICEDGE.0
            | WS_EX_WINDOWEDGE.0) as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !ex_mask);

        // Belt-and-suspenders accent border removal for Win11 22H2+.
        // 0xFFFFFFFE = DWMWA_COLOR_NONE.
        let color_none: u32 = 0xFFFFFFFE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &color_none as *const u32 as *const std::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );

        // Flush all style changes immediately.
        let _ = SetWindowPos(
            hwnd,
            HWND_TOP,
            0, 0, 0, 0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
}

#[tauri::command]
fn toggle_floating(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("floating") {
        win.close().map_err(|e| e.to_string())?;
    } else {
        WebviewWindowBuilder::new(&app, "floating", WebviewUrl::App("floating.html".into()))
            .title("Mini Overlay")
            // .inner_size(300f64, 200f64)
            .position(20f64, 20f64)
            .always_on_top(true)
            .minimizable(false)
            .maximizable(false)
            .decorations(false)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;

        #[cfg(target_os = "windows")]
        if let Some(win) = app.get_webview_window("floating") {
            if let Ok(hwnd) = win.hwnd() {
                let _ = winvd::pin_window(windows::Win32::Foundation::HWND(hwnd.0));
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn capture_screen(window: Window) -> Result<String, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    
    // Find the screen that contains the window, or fallback to the first screen
    let screen = Screen::from_point(position.x, position.y)
        .map_err(|e| e.to_string())?;
        
    let image = screen.capture().map_err(|e| e.to_string())?;
    let mut buffer = std::io::Cursor::new(Vec::new());
    image.write_to(&mut buffer, screenshots::image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(buffer.into_inner());
    
    Ok(format!("data:image/png;base64,{}", b64))
}


#[tauri::command]
async fn show_mini_top_center(app: AppHandle) -> Result<(), String> {
    // The mini window is destroyed when a session ends (getCurrentWindow().close()).
    // Re-create it with the same config as tauri.conf.json when it no longer exists.
    let window = match app.get_webview_window("mini") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(
            &app,
            "mini",
            WebviewUrl::App("floating.html".into()),
        )
        .title("ScribeShade Floating Screen")
        .inner_size(700f64, 360f64)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .minimizable(false)
        .maximizable(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .content_protected(true)
        .build()
        .map_err(|e| e.to_string())?,
    };

    window
        .set_size(LogicalSize::new(700u32, 222u32))
        .map_err(|e| e.to_string())?;

    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no primary monitor")?;

    let screen = monitor.size();
    let size = window.outer_size().map_err(|e| e.to_string())?;

    let x = (screen.width as i32 - size.width as i32) / 2;
    let y = 10;

    window
        .set_position(PhysicalPosition { x, y })
        .map_err(|e| e.to_string())?;
    window.set_minimizable(false).map_err(|e| e.to_string())?;
    window.set_maximizable(false).map_err(|e| e.to_string())?;

    // ── macOS: atomic level + show in one run_on_main_thread block ────────
    //
    // PROBLEM: `run_on_main_thread` from setup() (which runs on the main
    // thread) does NOT execute the closure inline — it enqueues it to the
    // Winit event-loop user-event queue for the NEXT iteration. Any Tauri
    // call after `run_on_main_thread` that dispatches via the same path
    // (e.g. set_focus → makeKeyAndOrderFront at the current level 3) will
    // race with our closure and may show the window at level 3 first.
    //
    // SOLUTION: Do NOT call set_focus / window.show() outside this block on
    // macOS. All show + level + collection-behavior work happens in a single
    // closure so it executes atomically on one event-loop tick.
    //
    //   orderFrontRegardless — shows the window unconditionally even when
    //     the app is not frontmost (unlike makeKeyAndOrderFront which silently
    //     no-ops if the app is inactive).
    //   activateIgnoringOtherApps — brings our process to the front so the
    //     window actually receives the key-window state.
    //
    // NSWindowCollectionBehavior:
    //   1   = canJoinAllSpaces       — visible on every Mission Control space
    //   16  = stationary             — doesn't slide away on space switch
    //   64  = ignoresCycle           — Cmd+` skips it
    //   256 = fullScreenAuxiliary    — floats over fullscreen apps
    #[cfg(target_os = "macos")]
    {
        let win_clone = window.clone();
        window
            .run_on_main_thread(move || {
                const NS_STATUS_WINDOW_LEVEL: i64 = 1;
                unsafe {
                    if let Ok(ns_win) = win_clone.ns_window() {
                        let ptr = ns_win as *mut objc2::runtime::AnyObject;
                        // 1. Set level — MUST happen before the window is ordered front.
                        let _: () = objc2::msg_send![ptr, setLevel: NS_STATUS_WINDOW_LEVEL];
                        // 2. Collection behavior.
                        let behavior: u64 = 1 | 16 | 64 | 256;
                        let _: () = objc2::msg_send![ptr, setCollectionBehavior: behavior];
                        // 3. Show regardless of app-active state (NSApp.active not required).
                        //    This is the correct call for floating overlay windows.
                        let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                        // 4. Activate the app so the widget can receive key events.
                        let app_cls = objc2::class!(NSApplication);
                        let ns_app: *mut objc2::runtime::AnyObject =
                            objc2::msg_send![app_cls, sharedApplication];
                        let _: () = objc2::msg_send![ns_app, activateIgnoringOtherApps: true];
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }

    // ── Windows ───────────────────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        if let Ok(hwnd) = window.hwnd() {
            let win_hwnd = windows::Win32::Foundation::HWND(hwnd.0);
            let _ = winvd::pin_window(win_hwnd);
            remove_window_border(win_hwnd);
            unsafe {
                let _ = windows::Win32::UI::Shell::SetWindowSubclass(
                    win_hwnd, Some(mini_subclass_proc), 1, 0,
                );
            }
        }
    }

    // ── Linux ─────────────────────────────────────────────────────────────
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }

    // On macOS focus is handled by activateIgnoringOtherApps in the block above.
    #[cfg(not(target_os = "macos"))]
    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

/// Animate the mini overlay to one of three discrete states.
///
/// React owns the *intent* (idle bar / expanded panel / collapsed badge)
/// and a content-derived `height` for the expanded case. Rust owns the
/// smooth, monotonic eased animation — keeping per-frame `set_size` calls
/// off the JS thread and out of the IPC bus.
#[tauri::command]
async fn set_mini_state(
    app: AppHandle,
    state: String,
    height: Option<u32>,
) -> Result<(), String> {
    let win = app.get_webview_window("mini").ok_or("mini window missing")?;

    let (target_w, target_h): (u32, u32) = match state.as_str() {
        "badge"    => (180, 36),
        "bar"      => (700, 222),
        "expanded" => (700, height.unwrap_or(185).clamp(120, 720)),
        other      => return Err(format!("unknown mini state: {other}")),
    };

    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let cur = win.inner_size().map_err(|e| e.to_string())?;
    let cur_w = (cur.width  as f64 / scale).round() as u32;
    let cur_h = (cur.height as f64 / scale).round() as u32;
    if cur_w == target_w && cur_h == target_h {
        return Ok(());
    }

    let version = ANIM_VERSION.fetch_add(1, Ordering::SeqCst) + 1;
    let win_clone = win.clone();

    tauri::async_runtime::spawn(async move {
        let start = std::time::Instant::now();
        let duration_ms: f32 = 220.0;
        let start_w = cur_w as f32;
        let start_h = cur_h as f32;
        let dx = target_w as f32 - start_w;
        let dy = target_h as f32 - start_h;

        loop {
            if ANIM_VERSION.load(Ordering::SeqCst) != version { return; }

            let elapsed = start.elapsed().as_millis() as f32;
            let t = (elapsed / duration_ms).min(1.0);
            let eased = 1.0 - (1.0 - t).powi(3); // ease-out cubic
            let w = (start_w + dx * eased).round() as u32;
            let h = (start_h + dy * eased).round() as u32;
            let _ = win_clone.set_size(LogicalSize::new(w, h));

            if t >= 1.0 { return; }
            tokio::time::sleep(std::time::Duration::from_millis(8)).await;
        }
    });

    Ok(())
}

/// Instantly resize the "mini" window (no animation) — used by
/// usePopupWindowExpand to grow the window before a popup renders, so the
/// popup isn't clipped by the native window frame, then shrink it back after.
/// Cancels any in-progress set_mini_state animation to avoid races.
#[tauri::command]
fn set_mini_size_instant(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    let win = app.get_webview_window("mini").ok_or("mini window missing")?;
    ANIM_VERSION.fetch_add(1, Ordering::SeqCst);
    win.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

// ── macOS native audio capture commands ──────────────────────────────────────
// Start a cpal input stream on the chosen device, encode raw samples as 16-bit
// little-endian PCM, and broadcast them to all connected WebSocket clients on
// a random localhost port.  Returns the port number so the frontend can open
// ws://127.0.0.1:{port}.
//
// Device selection:
//   device_name = None  → default input (microphone)
//   device_name = Some("BlackHole 2ch") etc. → virtual loopback for tab audio

#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_audio_stream(device_name: Option<String>) -> Result<u16, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use axum::{Router, extract::ws::{WebSocketUpgrade, WebSocket, Message}};
    use axum::extract::State;
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    // compare_exchange(STOPPED → STARTING) is the only path that proceeds.
    // Any concurrent call while STARTING or RUNNING returns early without
    // touching the OS mic device — preventing duplicate TCC permission prompts.
    match AUDIO_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {} // we own the startup
        Err(AUDIO_STARTING) => {
            // First startup still in progress — caller should retry after a short delay
            return Err("mic audio stream is already starting".into());
        }
        Err(_) => {
            // Already RUNNING — return the existing port
            let port = AUDIO_PORT.load(Ordering::SeqCst);
            if port != 0 { return Ok(port); }
            return Err("mic audio stream is running but port is not ready yet".into());
        }
    }

    // Helper that resets state on any failure path
    macro_rules! fail {
        ($msg:expr) => {{
            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err($msg.to_string());
        }};
    }

    let host = cpal::default_host();

    let device = if let Some(ref name) = device_name {
        match host.input_devices() {
            Ok(mut devs) => devs
                .find(|d| d.name().map(|n| n.contains(name.as_str())).unwrap_or(false))
                .ok_or_else(|| { AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst); format!("Audio device '{}' not found", name) })?,
            Err(e) => fail!(e.to_string()),
        }
    } else {
        match host.default_input_device() {
            Some(d) => d,
            None => fail!("No default input device found. Check microphone access in System Settings → Privacy & Security → Microphone."),
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => fail!(e.to_string()),
    };
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u32;

    // Broadcast channel — new WS clients subscribe, cpal thread publishes
    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(64);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();

    // Startup handshake: thread signals success/failure before we return Ok(port).
    // Without this the frontend could retry while macOS permission is unresolved,
    // causing repeated TCC dialogs.
    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    AUDIO_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[cpal mic] stream error: {e}");

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.iter().flat_map(|&s| {
                        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                },
                err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.iter().flat_map(|s| s.to_le_bytes()).collect();
                    let _ = tx.send(Arc::new(pcm));
                },
                err_fn, None,
            ),
            _ => {
                AUDIO_RUNNING.store(false, Ordering::SeqCst);
                AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                let _ = init_tx.send(Err("Unsupported sample format".into()));
                return;
            }
        };

        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    AUDIO_RUNNING.store(false, Ordering::SeqCst);
                    AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                    let _ = init_tx.send(Err(format!("Failed to start mic stream: {e}")));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while AUDIO_RUNNING.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                // stream dropped here → cpal stops
            }
            Err(e) => {
                AUDIO_RUNNING.store(false, Ordering::SeqCst);
                AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!(
                    "Failed to open mic device: {e}. \
                     Grant access in System Settings → Privacy & Security → Microphone."
                )));
            }
        }
    });

    // Wait up to 8 s for the cpal thread to confirm the stream started.
    match tokio::time::timeout(std::time::Duration::from_secs(8), init_rx).await {
        Ok(Ok(Ok(()))) => {} // stream confirmed started
        Ok(Ok(Err(e))) => {
            eprintln!("[start_audio_stream] cpal init FAILED: {e}");
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            let msg = "Mic stream timed out — check Microphone permission in System Settings.";
            eprintln!("[start_audio_stream] cpal init TIMEOUT");
            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(msg.into());
        }
    }

    // Bind axum WebSocket server on a random port
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => fail!(e.to_string()),
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => fail!(e.to_string()),
    };
    AUDIO_PORT.store(port, Ordering::SeqCst);
    AUDIO_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst);

    // Include sample_rate and channel count in the first message so the
    // frontend can configure Deepgram correctly.
    let meta = format!("{{\"sampleRate\":{sample_rate},\"channels\":{channels}}}");
    let meta_bytes = Arc::new(meta.into_bytes());

    let router = Router::new()
        .route("/", axum::routing::get(
            move |ws: WebSocketUpgrade, State(state): State<Arc<broadcast::Sender<Arc<Vec<u8>>>>>| {
                let meta_clone = meta_bytes.clone();
                async move {
                    ws.on_upgrade(move |mut socket: WebSocket| async move {
                        let _ = socket.send(Message::Text(
                            String::from_utf8_lossy(&meta_clone).into()
                        )).await;
                        let mut rx = state.subscribe();
                        loop {
                            match rx.recv().await {
                                Ok(pcm) => {
                                    if socket.send(Message::Binary((*pcm).clone())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(_) => break,
                            }
                        }
                    })
                }
            }
        ))
        .with_state(tx_arc);

    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    Ok(port)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn stop_audio_stream() {
    AUDIO_RUNNING.store(false, Ordering::SeqCst);
    AUDIO_PORT.store(0, Ordering::SeqCst);
    AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

/// Returns the list of available audio input device names so the frontend can
/// offer a picker (e.g. "BlackHole 2ch" for loopback / tab audio).
#[cfg(target_os = "macos")]
#[tauri::command]
fn list_audio_devices() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    host.input_devices()
        .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

// ── macOS ScreenCaptureKit display audio stream ───────────────────────────────
// Captures the audio playing on the primary display (system/tab audio) via SCKit.
// This does NOT require a virtual audio device — SCKit taps the OS audio graph
// directly.  Requires macOS 13.0+ and Screen Recording permission.
//
// Same WS/broadcast architecture as start_audio_stream:
//   SCKit callback → broadcast channel → axum WS → frontend → Deepgram

#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_display_audio_stream() -> Result<u16, String> {
    use screencapturekit::prelude::*;
    use axum::{Router, extract::ws::{WebSocketUpgrade, WebSocket, Message}};
    use axum::extract::State;
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard (same pattern as start_audio_stream) ────
    match DISPLAY_AUDIO_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {} // we own the startup
        Err(AUDIO_STARTING) => {
            return Err("display audio stream is already starting".into());
        }
        Err(_) => {
            // Already RUNNING — return the existing port
            let port = DISPLAY_AUDIO_PORT.load(Ordering::SeqCst);
            if port != 0 { return Ok(port); }
            return Err("display audio stream is running but port is not ready yet".into());
        }
    }

    // Broadcast channel: SCKit callback thread → axum WS clients
    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(128);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();

    // Startup result channel: SCKit thread signals success or failure back to
    // this async fn BEFORE it returns Ok(port). Previously the function returned
    // immediately after spawning the thread, meaning a permission-denied error
    // in SCKit was invisible: the axum WS stayed open, JS showed "transcribing",
    // but zero PCM ever flowed.
    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    // Bump generation so any previous zombie thread (from a rapid stop→start)
    // exits on its next 50 ms tick even if DISPLAY_AUDIO_RUNNING was re-set true.
    let my_gen = DISPLAY_AUDIO_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    DISPLAY_AUDIO_RUNNING.store(true, Ordering::SeqCst);

    // SCKit must be set up and kept alive on a dedicated OS thread.
    // All SCKit objects (SCStream, SCShareableContent, etc.) are created and
    // dropped on this thread — no Send constraints needed.
    std::thread::spawn(move || {
        let tx = tx_capture;

        // Get the list of capturable displays
        let content = match SCShareableContent::get() {
            Ok(c) => c,
            Err(e) => {
                DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!(
                    "Screen Recording permission denied or SCKit unavailable: {e:?}. \
                     Grant access in System Settings → Privacy & Security → Screen Recording."
                )));
                return;
            }
        };

        let displays = content.displays();
        let display = match displays.into_iter().next() {
            Some(d) => d,
            None => {
                DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err("No display found for system audio capture.".to_string()));
                return;
            }
        };

        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();

        // Audio-only config — 2×2 video size to minimise GPU overhead.
        // with_captures_audio requires macOS 13.0+ (feature = "macos_13_0").
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2);

        let mut stream = SCStream::new(&filter, &config);

        // The audio callback runs on SCKit's internal dispatch queue.
        // AudioBufferList is !Send, so we extract bytes here and send Vec<u8>.
        stream.add_output_handler(
            move |sample: CMSampleBuffer, of_type: SCStreamOutputType| {
                match of_type {
                    SCStreamOutputType::Audio => {}
                    _ => return,
                }

                let abl = match sample.audio_buffer_list() {
                    Some(a) => a,
                    None => return,
                };

                let num_bufs = abl.num_buffers();
                if num_bufs == 0 { return; }

                // Convert f32 stereo → mono i16 LE PCM for Deepgram (linear16, channels=1).
                // SCKit always delivers float32 at 48 kHz with 2 channels.
                // Downmixing to mono here means Deepgram receives a clean single-channel
                // stream — no multichannel mode needed, works reliably with nova-3.
                let mut pcm: Vec<u8> = Vec::new();

                if num_bufs == 1 {
                    // Interleaved stereo: layout is [L0_f32][R0_f32][L1_f32][R1_f32]...
                    // Read 8 bytes per frame (2 × f32), average L+R → mono.
                    if let Some(buf) = abl.get(0) {
                        for frame in buf.data().chunks_exact(8) {
                            let l = f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
                            let r = f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]);
                            let mono = ((l + r) * 0.5).clamp(-1.0, 1.0);
                            let v = (mono * i16::MAX as f32) as i16;
                            pcm.extend_from_slice(&v.to_le_bytes());
                        }
                    }
                } else {
                    // Non-interleaved: one buffer per channel.
                    // Average all channels per sample position → mono.
                    let samples_per_ch = abl.get(0)
                        .map(|b| b.data().len() / 4)
                        .unwrap_or(0);
                    for i in 0..samples_per_ch {
                        let mut sum = 0.0f32;
                        let mut count = 0u32;
                        for b in 0..num_bufs {
                            if let Some(buf) = abl.get(b) {
                                let raw = buf.data();
                                let off = i * 4;
                                if off + 4 <= raw.len() {
                                    let f = f32::from_le_bytes([
                                        raw[off], raw[off+1], raw[off+2], raw[off+3]
                                    ]);
                                    sum += f;
                                    count += 1;
                                }
                            }
                        }
                        if count > 0 {
                            let mono = (sum / count as f32).clamp(-1.0, 1.0);
                            let v = (mono * i16::MAX as f32) as i16;
                            pcm.extend_from_slice(&v.to_le_bytes());
                        }
                    }
                }

                if !pcm.is_empty() {
                    let _ = tx.send(Arc::new(pcm));
                }
            },
            SCStreamOutputType::Audio,
        );

        if let Err(e) = stream.start_capture() {
            DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
            let _ = init_tx.send(Err(format!(
                "System audio capture failed to start: {e:?}. \
                 Ensure Screen Recording permission is granted in System Settings → Privacy & Security → Screen Recording."
            )));
            return;
        }

        // Signal successful startup — the async caller is waiting on init_rx.
        let _ = init_tx.send(Ok(()));

        // Keep SCKit stream alive, checking both the running flag AND the
        // generation so a rapid stop→start sequence doesn't leave this thread
        // looping after a new stream has been spawned.
        while DISPLAY_AUDIO_RUNNING.load(Ordering::Relaxed)
            && DISPLAY_AUDIO_GENERATION.load(Ordering::Relaxed) == my_gen
        {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let _ = stream.stop_capture();
        // stream, content, display, filter dropped here (on this thread)
    });

    // Wait up to 10 s for SCKit to confirm it started.  10 s gives the user
    // time to grant Screen Recording permission on first run; a denied or
    // missing permission still fails fast (SCShareableContent::get errors).
    match tokio::time::timeout(std::time::Duration::from_secs(10), init_rx).await {
        Ok(Ok(Ok(()))) => {} // SCKit started — proceed to bind axum server
        Ok(Ok(Err(e))) => {
            DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
            DISPLAY_AUDIO_PORT.store(0, Ordering::SeqCst);
            DISPLAY_AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
            DISPLAY_AUDIO_PORT.store(0, Ordering::SeqCst);
            DISPLAY_AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(
                "System audio capture timed out — check Screen Recording permission \
                 in System Settings → Privacy & Security → Screen Recording."
                    .to_string(),
            );
        }
    }

    // Bind axum WebSocket server on a random localhost port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    DISPLAY_AUDIO_PORT.store(port, Ordering::SeqCst);
    DISPLAY_AUDIO_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst);

    // First WS message is JSON metadata so the frontend can configure Deepgram.
    // We always output mono (channels=1) regardless of SCKit's native stereo
    // capture — the downmix happens in the callback above.
    let sample_rate: u32 = 48000;
    let channels: u32 = 1;
    let meta = format!("{{\"sampleRate\":{sample_rate},\"channels\":{channels}}}");
    let meta_bytes = Arc::new(meta.into_bytes());

    let router = Router::new()
        .route("/", axum::routing::get(
            move |ws: WebSocketUpgrade, State(state): State<Arc<broadcast::Sender<Arc<Vec<u8>>>>>| {
                let meta_clone = meta_bytes.clone();
                async move {
                    ws.on_upgrade(move |mut socket: WebSocket| async move {
                        let _ = socket.send(Message::Text(
                            String::from_utf8_lossy(&meta_clone).into()
                        )).await;
                        let mut rx = state.subscribe();
                        loop {
                            match rx.recv().await {
                                Ok(pcm) => {
                                    if socket.send(Message::Binary((*pcm).clone())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                                Err(_) => break,
                            }
                        }
                    })
                }
            }
        ))
        .with_state(tx_arc);

    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    Ok(port)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn stop_display_audio_stream() {
    // Increment generation FIRST so the SCKit thread exits on its next tick
    // even if start_display_audio_stream is called immediately after this
    // (which would re-set DISPLAY_AUDIO_RUNNING to true).
    DISPLAY_AUDIO_GENERATION.fetch_add(1, Ordering::SeqCst);
    DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
    DISPLAY_AUDIO_PORT.store(0, Ordering::SeqCst);
    DISPLAY_AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── Windows: cpal mic audio stream ───────────────────────────────────────────
#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_audio_stream(device_name: Option<String>) -> Result<u16, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use axum::{Router, extract::ws::{WebSocketUpgrade, WebSocket, Message}};
    use axum::extract::State;
    use tokio::sync::broadcast;
    use std::sync::Arc;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match AUDIO_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("mic audio stream is already starting".into()),
        Err(_) => {
            let port = AUDIO_PORT.load(Ordering::SeqCst);
            if port != 0 { return Ok(port); }
            return Err("mic audio stream is running but port is not ready yet".into());
        }
    }

    macro_rules! fail {
        ($msg:expr) => {{
            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err($msg.to_string());
        }};
    }

    let host = cpal::default_host();
    let device = if let Some(ref name) = device_name {
        match host.input_devices() {
            Ok(devs) => devs
                .find(|d| d.name().map(|n| n.contains(name.as_str())).unwrap_or(false))
                .ok_or_else(|| { AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst); format!("Audio device '{}' not found", name) })?,
            Err(e) => fail!(e.to_string()),
        }
    } else {
        match host.default_input_device() {
            Some(d) => d,
            None => fail!("No default input device found"),
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => fail!(e.to_string()),
    };
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u32;

    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(64);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();

    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    AUDIO_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[cpal win mic] stream error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.iter().flat_map(|&s| {
                        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.iter().flat_map(|s| s.to_le_bytes()).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            _ => {
                AUDIO_RUNNING.store(false, Ordering::SeqCst);
                AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                let _ = init_tx.send(Err("Unsupported sample format".into()));
                return;
            }
        };
        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    AUDIO_RUNNING.store(false, Ordering::SeqCst);
                    AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                    let _ = init_tx.send(Err(format!("Failed to start mic stream: {e}")));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while AUDIO_RUNNING.load(Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            Err(e) => {
                AUDIO_RUNNING.store(false, Ordering::SeqCst);
                AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!("Failed to open mic device: {e}")));
            }
        }
    });

    match tokio::time::timeout(std::time::Duration::from_secs(8), init_rx).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(e))) => {
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            AUDIO_RUNNING.store(false, Ordering::SeqCst);
            AUDIO_PORT.store(0, Ordering::SeqCst);
            AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err("Mic stream timed out".into());
        }
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    AUDIO_PORT.store(port, Ordering::SeqCst);
    AUDIO_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst);

    let meta = format!("{{\"sampleRate\":{sample_rate},\"channels\":{channels}}}");
    let meta_bytes = Arc::new(meta.into_bytes());

    let router = Router::new().route("/", axum::routing::get(
        move |ws: WebSocketUpgrade, State(state): State<Arc<broadcast::Sender<Arc<Vec<u8>>>>>| {
            let meta_clone = meta_bytes.clone();
            async move {
                ws.on_upgrade(move |mut socket: WebSocket| async move {
                    let _ = socket.send(Message::Text(String::from_utf8_lossy(&meta_clone).into())).await;
                    let mut rx = state.subscribe();
                    loop {
                        match rx.recv().await {
                            Ok(pcm) => { if socket.send(Message::Binary((*pcm).clone())).await.is_err() { break; } }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                })
            }
        }
    )).with_state(tx_arc);

    tokio::spawn(async move { let _ = axum::serve(listener, router).await; });
    Ok(port)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_audio_stream() {
    AUDIO_RUNNING.store(false, Ordering::SeqCst);
    AUDIO_PORT.store(0, Ordering::SeqCst);
    AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn list_audio_devices() -> Vec<String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    host.input_devices()
        .map(|devs| devs.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

// ── Windows: WASAPI loopback — captures system/speaker audio ──────────────────
// On Windows, cpal's WASAPI backend supports loopback capture by calling
// build_input_stream on an *output* device. This taps whatever is currently
// playing through the speakers — i.e. the remote interviewer's voice.


#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_display_audio_stream() -> Result<u16, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use axum::{Router, extract::ws::{WebSocketUpgrade, WebSocket, Message}};
    use axum::extract::State;
    use tokio::sync::broadcast;
    use std::sync::Arc;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match DISPLAY_AUDIO_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("display audio stream is already starting".into()),
        Err(_) => {
            let port = DISPLAY_AUDIO_PORT.load(Ordering::SeqCst);
            if port != 0 { return Ok(port); }
            return Err("display audio stream is running but port is not ready yet".into());
        }
    }

    let host = cpal::default_host();
    // WASAPI loopback: use default OUTPUT device as an input source.
    // cpal's WASAPI backend automatically enables loopback mode when
    // build_input_stream is called on a device obtained from output_devices().
    let device = host.default_output_device()
        .ok_or("No default output device found for loopback capture")?;

    // Output config gives us the native sample rate / channel count that the
    // system is actually running at — important for Deepgram accuracy.
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as u32;

    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(128);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();

    // Bump generation so any previous zombie thread exits on its next 50 ms tick.
    let my_gen = DISPLAY_AUDIO_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    // Capture the channel count now so the downmix callbacks below can use it
    // without borrowing `config` after it is moved into the stream builder.
    let ch_count = channels as usize;
    DISPLAY_AUDIO_RUNNING.store(true, Ordering::SeqCst);
    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[wasapi loopback] stream error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !DISPLAY_AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    // Downmix multi-channel frames to mono: average each frame.
                    let pcm: Vec<u8> = data.chunks(ch_count).flat_map(|frame| {
                        let sum: f32 = frame.iter().copied().sum();
                        let mono = (sum / frame.len() as f32).clamp(-1.0, 1.0);
                        let v = (mono * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !DISPLAY_AUDIO_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch_count).flat_map(|frame| {
                        let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                        let mono = (sum / frame.len() as i32)
                            .clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        mono.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            _ => return,
        };
        if let Ok(s) = stream {
            let _ = s.play();
            while DISPLAY_AUDIO_RUNNING.load(Ordering::Relaxed)
                && DISPLAY_AUDIO_GENERATION.load(Ordering::Relaxed) == my_gen
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    });

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    DISPLAY_AUDIO_PORT.store(port, Ordering::SeqCst);
    DISPLAY_AUDIO_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst);

    // Always report channels=1 — the WASAPI callback downmixes to mono above.
    let meta = format!("{{\"sampleRate\":{sample_rate},\"channels\":1}}");
    let meta_bytes = Arc::new(meta.into_bytes());

    let router = Router::new().route("/", axum::routing::get(
        move |ws: WebSocketUpgrade, State(state): State<Arc<broadcast::Sender<Arc<Vec<u8>>>>>| {
            let meta_clone = meta_bytes.clone();
            async move {
                ws.on_upgrade(move |mut socket: WebSocket| async move {
                    let _ = socket.send(Message::Text(String::from_utf8_lossy(&meta_clone).into())).await;
                    let mut rx = state.subscribe();
                    loop {
                        match rx.recv().await {
                            Ok(pcm) => { if socket.send(Message::Binary((*pcm).clone())).await.is_err() { break; } }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                })
            }
        }
    )).with_state(tx_arc);

    tokio::spawn(async move { let _ = axum::serve(listener, router).await; });
    Ok(port)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_display_audio_stream() {
    DISPLAY_AUDIO_GENERATION.fetch_add(1, Ordering::SeqCst);
    DISPLAY_AUDIO_RUNNING.store(false, Ordering::SeqCst);
    DISPLAY_AUDIO_PORT.store(0, Ordering::SeqCst);
    DISPLAY_AUDIO_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── Linux stubs (audio capture not supported) ─────────────────────────────────
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn start_audio_stream(_device_name: Option<String>) -> Result<u16, String> {
    Err("Native audio capture is macOS/Windows-only".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn stop_audio_stream() {}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn list_audio_devices() -> Vec<String> { vec![] }

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn start_display_audio_stream() -> Result<u16, String> {
    Err("Display audio capture is macOS/Windows-only".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn stop_display_audio_stream() {}

// ── Parakeet-style Rust-native STT ───────────────────────────────────────────
// The mini overlay never touches raw audio or connects to Deepgram directly.
// Rust captures PCM, owns the Deepgram WS, and emits Tauri events:
//   "stt:system-audio"  → TranscriptPayload  (Interviewer — system audio)
//   "stt:mic"           → TranscriptPayload  (User — microphone)
//   "stt:status:system" → SttStatusPayload
//   "stt:status:mic"    → SttStatusPayload
//
// All Deepgram WebSocket plumbing lives in `crate::deepgram` — these commands
// are responsible only for OS-level audio capture and feeding PCM into a
// broadcast channel that `deepgram::run_session` consumes.

// Deepgram API key loaded from VITE_DEEPGRAM_API_KEY in .env at startup.
// Stored as managed state so commands never receive the key from the frontend.
struct DeepgramKey(String);

// ── macOS: SCKit system audio → Deepgram ─────────────────────────────────────
#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_system_audio_transcription(
    app: tauri::AppHandle,
    dg_key: tauri::State<'_, DeepgramKey>,
    language: String,
    model: String,
) -> Result<(), String> {
    let api_key = dg_key.0.clone();
    use screencapturekit::prelude::*;
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match SYSTEM_STT_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("system audio STT is already starting".into()),
        Err(_) => return Ok(()),   // already running — idempotent
    }

    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let (pcm_tx, _) = broadcast::channel::<Arc<Vec<u8>>>(256);
    let tx_arc = Arc::new(pcm_tx);
    let tx_capture = tx_arc.clone();
    let my_gen = SYSTEM_STT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    SYSTEM_STT_RUNNING.store(true, Ordering::SeqCst);

    // but PCM goes straight into the broadcast channel — no axum WS server.
    std::thread::spawn(move || {
        let tx = tx_capture;
        let content = match SCShareableContent::get() {
            Ok(c) => c,
            Err(e) => {
                SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!(
                    "Screen Recording permission denied: {e:?}. \
                     Grant in System Settings → Privacy & Security → Screen Recording."
                )));
                return;
            }
        };
        let display = match content.displays().into_iter().next() {
            Some(d) => d,
            None => {
                SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err("No display found for system audio.".into()));
                return;
            }
        };
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();
        let cfg = SCStreamConfiguration::new()
            .with_width(2).with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2);
        let mut stream = SCStream::new(&filter, &cfg);
        stream.add_output_handler(
            move |sample: CMSampleBuffer, of_type: SCStreamOutputType| {
                match of_type { SCStreamOutputType::Audio => {} _ => return }
                let abl = match sample.audio_buffer_list() { Some(a) => a, None => return };
                let num_bufs = abl.num_buffers();
                if num_bufs == 0 { return; }
                let mut pcm: Vec<u8> = Vec::new();
                if num_bufs == 1 {
                    if let Some(buf) = abl.get(0) {
                        for frame in buf.data().chunks_exact(8) {
                            let l = f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
                            let r = f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]);
                            let v = (((l + r) * 0.5).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            pcm.extend_from_slice(&v.to_le_bytes());
                        }
                    }
                } else {
                    let n = abl.get(0).map(|b| b.data().len() / 4).unwrap_or(0);
                    for i in 0..n {
                        let mut sum = 0.0f32; let mut cnt = 0u32;
                        for b in 0..num_bufs {
                            if let Some(buf) = abl.get(b) {
                                let raw = buf.data(); let off = i * 4;
                                if off + 4 <= raw.len() {
                                    sum += f32::from_le_bytes([raw[off],raw[off+1],raw[off+2],raw[off+3]]);
                                    cnt += 1;
                                }
                            }
                        }
                        if cnt > 0 {
                            let v = ((sum / cnt as f32).clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                            pcm.extend_from_slice(&v.to_le_bytes());
                        }
                    }
                }
                if !pcm.is_empty() { let _ = tx.send(Arc::new(pcm)); }
            },
            SCStreamOutputType::Audio,
        );
        if let Err(e) = stream.start_capture() {
            SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
            let _ = init_tx.send(Err(format!(
                "System audio capture failed: {e:?}. Check Screen Recording permission."
            )));
            return;
        }
        let _ = init_tx.send(Ok(()));
        while SYSTEM_STT_RUNNING.load(Ordering::Relaxed)
            && SYSTEM_STT_GENERATION.load(Ordering::Relaxed) == my_gen
        {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = stream.stop_capture();
    });

    match tokio::time::timeout(std::time::Duration::from_secs(10), init_rx).await {
        Ok(Ok(Ok(()))) => {
            SYSTEM_STT_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst);
        }
        Ok(Ok(Err(e))) => {
            eprintln!("[stt:system macos] SCKit init FAILED: {e}");
            SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
            SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            let msg = "System audio capture timed out — check Screen Recording permission.".to_string();
            eprintln!("[stt:system macos] SCKit init TIMEOUT");
            SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
            SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(msg);
        }
    }
    let app_c = app.clone();
    tokio::spawn(async move {
        let pcm_rx = tx_arc.subscribe();
        deepgram::run_session(
            app_c,
            DeepgramConfig {
                api_key,
                model,
                language,
                sample_rate: 48000,
                channels: 1,
                tag: "hireshade-rust",
            },
            SttChannel::System,
            pcm_rx,
            &SYSTEM_STT_RUNNING,
            &SYSTEM_STT_GENERATION,
            my_gen,
        )
        .await;
    });

    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn stop_system_audio_transcription() {
    SYSTEM_STT_GENERATION.fetch_add(1, Ordering::SeqCst);
    SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
    SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── macOS: cpal mic → Deepgram ────────────────────────────────────────────────
#[cfg(target_os = "macos")]
#[tauri::command]
async fn start_mic_transcription(
    app: tauri::AppHandle,
    dg_key: tauri::State<'_, DeepgramKey>,
    language: String,
    model: String,
) -> Result<(), String> {
    let api_key = dg_key.0.clone();
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match MIC_STT_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("mic STT is already starting".into()),
        Err(_) => return Ok(()),   // already running — idempotent
    }

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| {
        MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        "No microphone found".to_string()
    })?;
    let config = device.default_input_config().map_err(|e| {
        MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        e.to_string()
    })?;
    let sample_rate = config.sample_rate().0;
    let ch = config.channels() as usize;

    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(64);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();
    let my_gen = MIC_STT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    MIC_STT_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[mic-stt] cpal error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !MIC_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: f32 = frame.iter().copied().sum();
                        let mono = (sum / frame.len() as f32).clamp(-1.0, 1.0);
                        let v = (mono * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !MIC_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                        let mono = (sum / frame.len() as i32)
                            .clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        mono.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            _ => {
                MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err("Unsupported sample format".into()));
                return;
            }
        };
        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                    let _ = init_tx.send(Err(format!("Failed to start mic stream: {e}")));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while MIC_STT_RUNNING.load(Ordering::Relaxed)
                    && MIC_STT_GENERATION.load(Ordering::Relaxed) == my_gen
                {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            Err(e) => {
                MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!("Failed to open mic device: {e}")));
            }
        }
    });

    match tokio::time::timeout(std::time::Duration::from_secs(8), init_rx).await {
        Ok(Ok(Ok(()))) => { MIC_STT_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst); }
        Ok(Ok(Err(e))) => {
            MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            MIC_STT_RUNNING.store(false, Ordering::SeqCst);
            MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err("Mic STT stream timed out".into());
        }
    }

    let app_c = app.clone();
    tokio::spawn(async move {
        let pcm_rx = tx_arc.subscribe();
        deepgram::run_session(
            app_c,
            DeepgramConfig {
                api_key,
                model,
                language,
                sample_rate,
                channels: 1,
                tag: "hireshade-mic",
            },
            SttChannel::Mic,
            pcm_rx,
            &MIC_STT_RUNNING,
            &MIC_STT_GENERATION,
            my_gen,
        )
        .await;
    });

    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn stop_mic_transcription() {
    MIC_STT_GENERATION.fetch_add(1, Ordering::SeqCst);
    MIC_STT_RUNNING.store(false, Ordering::SeqCst);
    MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── Windows: WASAPI loopback → Deepgram (system audio) ───────────────────────
#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_system_audio_transcription(
    app: tauri::AppHandle,
    dg_key: tauri::State<'_, DeepgramKey>,
    language: String,
    model: String,
) -> Result<(), String> {
    let api_key = dg_key.0.clone();
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match SYSTEM_STT_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("system audio STT is already starting".into()),
        Err(_) => return Ok(()),
    }

    let host = cpal::default_host();
    let device = host.default_output_device().ok_or_else(|| {
        SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        "No output device for loopback".to_string()
    })?;
    let config = device.default_output_config().map_err(|e| {
        SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        e.to_string()
    })?;
    let sample_rate = config.sample_rate().0;
    let ch = config.channels() as usize;

    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(128);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();
    let my_gen = SYSTEM_STT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    SYSTEM_STT_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[wasapi-stt] stream error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !SYSTEM_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: f32 = frame.iter().copied().sum();
                        let mono = (sum / frame.len() as f32).clamp(-1.0, 1.0);
                        let v = (mono * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !SYSTEM_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                        let mono = (sum / frame.len() as i32)
                            .clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        mono.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            _ => {
                SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err("Unsupported sample format".into()));
                return;
            }
        };
        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
                    let _ = init_tx.send(Err(format!("Failed to start system audio stream: {e}")));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while SYSTEM_STT_RUNNING.load(Ordering::Relaxed)
                    && SYSTEM_STT_GENERATION.load(Ordering::Relaxed) == my_gen
                {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            Err(e) => {
                SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!("Failed to open loopback device: {e}")));
            }
        }
    });

    match tokio::time::timeout(std::time::Duration::from_secs(8), init_rx).await {
        Ok(Ok(Ok(()))) => { SYSTEM_STT_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst); }
        Ok(Ok(Err(e))) => {
            SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
            SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err("System audio STT stream timed out".into());
        }
    }

    let app_c = app.clone();
    tokio::spawn(async move {
        let pcm_rx = tx_arc.subscribe();
        deepgram::run_session(
            app_c,
            DeepgramConfig {
                api_key,
                model,
                language,
                sample_rate,
                channels: 1,
                tag: "hireshade-rust",
            },
            SttChannel::System,
            pcm_rx,
            &SYSTEM_STT_RUNNING,
            &SYSTEM_STT_GENERATION,
            my_gen,
        )
        .await;
    });

    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_system_audio_transcription() {
    SYSTEM_STT_GENERATION.fetch_add(1, Ordering::SeqCst);
    SYSTEM_STT_RUNNING.store(false, Ordering::SeqCst);
    SYSTEM_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── Windows: cpal mic input → Deepgram ───────────────────────────────────────
#[cfg(target_os = "windows")]
#[tauri::command]
async fn start_mic_transcription(
    app: tauri::AppHandle,
    dg_key: tauri::State<'_, DeepgramKey>,
    language: String,
    model: String,
) -> Result<(), String> {
    let api_key = dg_key.0.clone();
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use tokio::sync::broadcast;

    // ── 3-state idempotency guard ─────────────────────────────────────────
    match MIC_STT_STATE.compare_exchange(
        AUDIO_STOPPED, AUDIO_STARTING, Ordering::SeqCst, Ordering::SeqCst,
    ) {
        Ok(_) => {}
        Err(AUDIO_STARTING) => return Err("mic STT is already starting".into()),
        Err(_) => return Ok(()),
    }

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| {
        MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        "No microphone found".to_string()
    })?;
    let config = device.default_input_config().map_err(|e| {
        MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
        e.to_string()
    })?;
    let sample_rate = config.sample_rate().0;
    let ch = config.channels() as usize;

    let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let (tx, _rx) = broadcast::channel::<Arc<Vec<u8>>>(64);
    let tx_arc = Arc::new(tx);
    let tx_capture = tx_arc.clone();
    let my_gen = MIC_STT_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    MIC_STT_RUNNING.store(true, Ordering::SeqCst);

    std::thread::spawn(move || {
        let tx = tx_capture;
        let err_fn = |e| eprintln!("[mic-stt-win] cpal error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    if !MIC_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: f32 = frame.iter().copied().sum();
                        let mono = (sum / frame.len() as f32).clamp(-1.0, 1.0);
                        let v = (mono * i16::MAX as f32) as i16;
                        v.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    if !MIC_STT_RUNNING.load(Ordering::Relaxed) { return; }
                    let pcm: Vec<u8> = data.chunks(ch).flat_map(|frame| {
                        let sum: i32 = frame.iter().map(|&s| s as i32).sum();
                        let mono = (sum / frame.len() as i32)
                            .clamp(i16::MIN as i32, i16::MAX as i32) as i16;
                        mono.to_le_bytes()
                    }).collect();
                    let _ = tx.send(Arc::new(pcm));
                }, err_fn, None,
            ),
            _ => {
                MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err("Unsupported sample format".into()));
                return;
            }
        };
        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                    let _ = init_tx.send(Err(format!("Failed to start mic stream: {e}")));
                    return;
                }
                let _ = init_tx.send(Ok(()));
                while MIC_STT_RUNNING.load(Ordering::Relaxed)
                    && MIC_STT_GENERATION.load(Ordering::Relaxed) == my_gen
                {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
            Err(e) => {
                MIC_STT_RUNNING.store(false, Ordering::SeqCst);
                let _ = init_tx.send(Err(format!("Failed to open mic device: {e}")));
            }
        }
    });

    match tokio::time::timeout(std::time::Duration::from_secs(8), init_rx).await {
        Ok(Ok(Ok(()))) => { MIC_STT_STATE.store(AUDIO_RUNNING_STATE, Ordering::SeqCst); }
        Ok(Ok(Err(e))) => {
            MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err(e);
        }
        _ => {
            MIC_STT_RUNNING.store(false, Ordering::SeqCst);
            MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
            return Err("Mic STT stream timed out".into());
        }
    }

    let app_c = app.clone();
    tokio::spawn(async move {
        let pcm_rx = tx_arc.subscribe();
        deepgram::run_session(
            app_c,
            DeepgramConfig {
                api_key,
                model,
                language,
                sample_rate,
                channels: 1,
                tag: "hireshade-mic",
            },
            SttChannel::Mic,
            pcm_rx,
            &MIC_STT_RUNNING,
            &MIC_STT_GENERATION,
            my_gen,
        )
        .await;
    });

    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn stop_mic_transcription() {
    MIC_STT_GENERATION.fetch_add(1, Ordering::SeqCst);
    MIC_STT_RUNNING.store(false, Ordering::SeqCst);
    MIC_STT_STATE.store(AUDIO_STOPPED, Ordering::SeqCst);
}

// ── Linux stubs for new STT commands ─────────────────────────────────────────
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn start_system_audio_transcription(
    _app: tauri::AppHandle, _dg_key: tauri::State<'_, DeepgramKey>, _language: String, _model: String,
) -> Result<(), String> { Err("STT is macOS/Windows-only".into()) }

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn stop_system_audio_transcription() {}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn start_mic_transcription(
    _app: tauri::AppHandle, _dg_key: tauri::State<'_, DeepgramKey>, _language: String, _model: String,
) -> Result<(), String> { Err("STT is macOS/Windows-only".into()) }

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
fn stop_mic_transcription() {}

// ── OS-level permission settings deep-links ──────────────────────────────────
// Lazy permission flow: when system audio / mic capture fails because the user
// denied the OS permission, the JS layer surfaces a "Open Settings" button that
// invokes one of these commands to deep-link to the right Privacy pane.

// ── Microphone permission preflight ──────────────────────────────────────────
// Call this ONCE before start_audio_stream.  Returns Ok(()) if the mic is
// accessible, Err with a human-readable message if not.
// Separating permission-check from stream-start means the app never calls
// start_audio_stream until permission is confirmed, eliminating the pattern
// that triggers repeated macOS TCC dialogs.
#[tauri::command]
async fn ensure_microphone_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        match host.default_input_device() {
            Some(device) => {
                // Attempt to open a config — this is what triggers the macOS
                // TCC mic dialog on first access.  If the user already granted
                // permission the call returns instantly.
                device.default_input_config()
                    .map(|_| ())
                    .map_err(|e| format!(
                        "Microphone permission denied or device unavailable: {e}. \
                         Grant access in System Settings → Privacy & Security → Microphone."
                    ))
            }
            None => Err(
                "No microphone found. Connect a mic and check System Settings → Sound → Input."
                    .into(),
            ),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: permission is either always granted (Windows) or
        // managed by the DE (Linux).  Probe the device as a basic sanity check.
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        host.default_input_device()
            .ok_or_else(|| "No default input device found".to_string())
            .and_then(|d| d.default_input_config().map(|_| ()).map_err(|e| e.to_string()))
    }
}

#[tauri::command]
fn open_screen_recording_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
        app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        // Windows has no system-audio permission; loopback works without consent.
        // Open the Sound mixer so the user can verify the default output device.
        let _ = app;
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:sound"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err("Not supported on this OS".into())
    }
}

#[tauri::command]
fn open_microphone_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
        app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:privacy-microphone"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        Err("Not supported on this OS".into())
    }
}

#[command]
fn set_session_active(active: bool) {
    SESSION_ACTIVE.store(active, Ordering::SeqCst);
}

#[command]
fn handle_launcher_click(app: AppHandle) -> Result<(), String> {
    if SESSION_ACTIVE.load(Ordering::SeqCst) {
        if let Some(mini) = app.get_webview_window("mini") {
            // macOS: never call show() or set_focus() on overlay windows —
            // they both route through makeKeyAndOrderFront which resets the
            // compositor level back to NSFloatingWindowLevel (3). Use
            // orderFrontRegardless instead, which honours the existing level.
            #[cfg(target_os = "macos")]
            {
                let w = mini.clone();
                let _ = mini.run_on_main_thread(move || {
                    unsafe {
                        if let Ok(ns_win) = w.ns_window() {
                            let ptr = ns_win as *mut objc2::runtime::AnyObject;
                            let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                        }
                    }
                });
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = mini.show();
                let _ = mini.unminimize();
                let _ = mini.set_focus();
            }
        }
    } else {
        if let Some(launcher) = app.get_webview_window("launcher") {
            #[cfg(target_os = "macos")]
            {
                let w = launcher.clone();
                let _ = launcher.run_on_main_thread(move || {
                    unsafe {
                        if let Ok(ns_win) = w.ns_window() {
                            let ptr = ns_win as *mut objc2::runtime::AnyObject;
                            let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                        }
                    }
                });
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = launcher.show();
                let _ = launcher.set_focus();
            }
        }
    }
    Ok(())
}

/// Show (or create) the full dashboard window and navigate it directly to the
/// requested route with conditions encoded as URL query params.
///
/// The frontend reads `?openCreate=true&isFree=true` via `useSearchParams` —
/// no separate Tauri event is needed, and there is no race condition between
/// window creation and event delivery.
///
/// Called from the widget for: Start Session, Buy Credits, Past Sessions, Sign In.
/// The dashboard window is NOT opened for any other widget interaction.
#[tauri::command]
async fn open_main_dashboard(
    app: AppHandle,
    route: Option<String>,
    show_create: Option<bool>,
    is_free: Option<bool>,
    // When `false`: create/navigate the window without showing it — used as a
    // hidden background session-processor (e.g. event bus for the mini overlay).
    visible: Option<bool>,
) -> Result<(), String> {
    // ── 1. Create the main window lazily — only when the user explicitly needs it ──
    let is_new_window = app.get_webview_window("main").is_none();

    let main_win = if let Some(win) = app.get_webview_window("main") {
        win
    } else {
        let nav_handle = app.clone();
        
        let mut path = route.clone().unwrap_or_else(|| "/dashboard".to_string());
        let mut query = Vec::new();
        if show_create.unwrap_or(false) { query.push("openCreate=true"); }
        if is_free.unwrap_or(false) { query.push("isFree=true"); }
        if !query.is_empty() {
            path.push('?');
            path.push_str(&query.join("&"));
        }
        
        let url = WebviewUrl::App(path.into());

        WebviewWindowBuilder::new(&app, "main", url)
            .title("ScribeShade")
            .decorations(false)
            .inner_size(1200.0, 800.0)
            .center()
            .resizable(false)
            .maximized(true)
            .skip_taskbar(false)
            .content_protected(false)
            .on_navigation(move |url| {
                let scheme = url.scheme();
                let host = url.host_str().unwrap_or("");
                // Allow internal app URLs in both dev and production.
                if scheme == "tauri"
                    || host == "localhost"
                    || host == "tauri.localhost"
                    || host == "127.0.0.1"
                {
                    return true;
                }
                // Allow Razorpay payment gateway pages to open inside the window.
                if host.ends_with("razorpay.com") || host.ends_with("razorpay.in") {
                    return true;
                }
                // All other external URLs open in the system browser.
                let _ = nav_handle.opener().open_url(url.as_str(), None::<&str>);
                false
            })
            .build()
            .map_err(|e| e.to_string())?
    };

    // Ensure decorations are always off, even if the window was reused from a
    // previous call that predates this setting being added to the builder.
    main_win.set_decorations(false).map_err(|e| e.to_string())?;

    // Only show/focus when caller wants the window to be visible (default true).
    // Passing `visible: false` creates or navigates the window as a hidden
    // background processor (e.g. session event bus for the mini overlay).
    if visible.unwrap_or(true) {
        main_win.show().map_err(|e| e.to_string())?;
        main_win.unminimize().map_err(|e| e.to_string())?;
        main_win.set_focus().map_err(|e| e.to_string())?;
    }

    // ── 2. Navigate to the target route with conditions as URL query params ──
    // For EXISTING windows: a full webview navigation to the new URL.
    if !is_new_window && (route.is_some() || show_create.unwrap_or(false)) {
        let current = main_win.url().map_err(|e| e.to_string())?;

        // Extract origin: scheme://host[:port]
        let scheme = current.scheme();
        let host = current.host_str().unwrap_or("localhost");
        let mut origin = format!("{}://{}", scheme, host);
        if let Some(port) = current.port() {
            origin = format!("{}:{}", origin, port);
        }

        let route_path = route.as_deref().unwrap_or("/dashboard");

        // Build the full URL: origin + /route?params
        let raw = format!("{}{}", origin, route_path);
        let mut nav_url = NavUrl::parse(&raw).map_err(|e| e.to_string())?;

        // Append condition params so the frontend knows what action to trigger.
        {
            let mut qp = nav_url.query_pairs_mut();
            if show_create.unwrap_or(false) {
                qp.append_pair("openCreate", "true");
            }
            if is_free.unwrap_or(false) {
                qp.append_pair("isFree", "true");
            }
        }

        main_win.navigate(nav_url).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Position and show the launcher widget with proper OS-level floating settings.
/// Mirrors the logic in `show_mini_top_center` but targets the "launcher" window.
///
/// SAFETY NOTE: This function calls objc2::msg_send! (NSWindow APIs on macOS)
/// which must run on the main thread. It is called directly from setup() which
/// runs on the main thread. The macOS block uses run_on_main_thread as a safety
/// net in case it is ever called from a tokio worker via invoke.
#[tauri::command]
fn show_launcher_widget(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("launcher")
        .ok_or("launcher window not found")?;

    window
        .set_size(LogicalSize::new(460u32, 260u32))
        .map_err(|e| e.to_string())?;

    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no primary monitor")?;

    let screen = monitor.size();
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let x = (screen.width as i32 - size.width as i32) / 2;
    let y = 20i32;

    window
        .set_position(PhysicalPosition { x, y })
        .map_err(|e| e.to_string())?;
    window.set_minimizable(false).map_err(|e| e.to_string())?;
    window.set_maximizable(false).map_err(|e| e.to_string())?;

    // ── macOS: atomic level + show in one run_on_main_thread block ────────
    //
    // Same race-condition fix as show_mini_top_center. See that function for
    // the detailed explanation. TL;DR: run_on_main_thread enqueues to the
    // Winit event-loop user-event queue, so any Tauri call made AFTER it on
    // the calling thread may execute BEFORE the closure. We therefore put ALL
    // macOS show/level/focus work inside one closure and skip set_focus() on
    // the outer call path for macOS.
    //
    // orderFrontRegardless — shows the overlay even when the app is inactive.
    // activateIgnoringOtherApps — lets the widget receive key events.
    #[cfg(target_os = "macos")]
    {
        let win_clone = window.clone();
        window
            .run_on_main_thread(move || {
                const NS_STATUS_WINDOW_LEVEL: i64 = 25;
                unsafe {
                    if let Ok(ns_win) = win_clone.ns_window() {
                        let ptr = ns_win as *mut objc2::runtime::AnyObject;
                        // 1. Set level before showing — compositor locks at
                        //    the level the window has when first ordered front.
                        let _: () = objc2::msg_send![ptr, setLevel: NS_STATUS_WINDOW_LEVEL];
                        // 2. canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary
                        let behavior: u64 = 1 | 16 | 64 | 256;
                        let _: () = objc2::msg_send![ptr, setCollectionBehavior: behavior];
                        // 3. Show regardless of app-active state.
                        let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                        // 4. Activate so the widget can receive key events.
                        let app_cls = objc2::class!(NSApplication);
                        let ns_app: *mut objc2::runtime::AnyObject =
                            objc2::msg_send![app_cls, sharedApplication];
                        let _: () = objc2::msg_send![ns_app, activateIgnoringOtherApps: true];
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }

    // ── Windows ───────────────────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        if let Ok(hwnd) = window.hwnd() {
            let win_hwnd = windows::Win32::Foundation::HWND(hwnd.0);
            let _ = winvd::pin_window(win_hwnd);
            remove_window_border(win_hwnd);
            unsafe {
                let _ = windows::Win32::UI::Shell::SetWindowSubclass(
                    win_hwnd, Some(mini_subclass_proc), 1, 0,
                );
            }
        }
    }

    // ── Linux ─────────────────────────────────────────────────────────────
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }

    // macOS: focus handled by activateIgnoringOtherApps in the block above.
    #[cfg(not(target_os = "macos"))]
    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}
// ─────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── Deepgram API key resolution (two-tier) ────────────────────────────
    //
    // PRODUCTION (bundled .app):
    //   The .env file is never shipped inside the bundle, so dotenvy finds
    //   nothing and std::env::var returns Err.  The key must be baked into
    //   the binary at compile time by the CI workflow.
    //
    //   option_env!("VITE_DEEPGRAM_API_KEY") reads the env var that the CI
    //   runner exports during `pnpm tauri build`; the value is embedded as a
    //   &'static str.  There is exactly one binary → one embed → no
    //   possibility of the warning firing multiple times per launch.
    //
    // DEVELOPMENT (pnpm tauri dev):
    //   dotenvy::dotenv() loads the project-root .env file, then
    //   std::env::var picks up the runtime value as the fallback.
    //
    // WHY THE WARNING FIRED MULTIPLE TIMES BEFORE:
    //   The Tauri auto-updater downloads a new binary, replaces the old one,
    //   and spawns a fresh process — so run() (and this block) executes once
    //   per relaunch.  Each fresh process had no .env → empty key → warning.
    //   Baking the key at compile time removes the dependency on .env at
    //   runtime, so the warning never fires in a correctly-built release.
    dotenvy::dotenv().ok(); // dev only; silently a no-op in bundled builds

    let deepgram_key: String = option_env!("VITE_DEEPGRAM_API_KEY")
        // compile-time path: CI baked the key into the binary
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(str::to_string)
        // runtime path: local .env loaded above (development)
        .or_else(|| {
            std::env::var("VITE_DEEPGRAM_API_KEY")
                .ok()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
        })
        .unwrap_or_default();

    if deepgram_key.is_empty() {
        eprintln!(
            "[startup] VITE_DEEPGRAM_API_KEY is not set — STT will fail.\n\
             Dev: add it to .env\n\
             Release: add it as a GitHub Actions secret and expose it in the \
             release workflow (VITE_DEEPGRAM_API_KEY: ${{{{ secrets.VITE_DEEPGRAM_API_KEY }}}})"
        );
        // In release builds, abort immediately — a missing key means STT is
        // completely broken and would confuse debugging with permission errors.
        #[cfg(not(debug_assertions))]
        panic!("Release build is missing VITE_DEEPGRAM_API_KEY — aborting to prevent silent STT failure.");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DeepgramKey(deepgram_key))
        .setup(|app| {
            // ── macOS: switch to Accessory activation policy ───────────────
            //
            // ROOT CAUSE FIX: The default NSApplicationActivationPolicyRegular
            // (0) makes macOS treat us as a foreground app whose windows can be
            // beaten by any active app, even at NSStatusWindowLevel (25).
            //
            // NSApplicationActivationPolicyAccessory (1) means:
            //   - No dock icon / menu bar (pure overlay / background app)
            //   - Our windows float above ALL regular-policy windows
            //   - We never steal the active-app indicator from the frontmost app
            //
            // This is how Loom, Parakeet, Raycast, and every true macOS overlay
            // achieves persistent above-all-others behavior.
            //
            // setup() runs on the main thread — safe to call ObjC directly.
            #[cfg(target_os = "macos")]
            unsafe {
                let app_cls = objc2::class!(NSApplication);
                let ns_app: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![app_cls, sharedApplication];
                // 1 = NSApplicationActivationPolicyAccessory
                let _: () = objc2::msg_send![ns_app, setActivationPolicy: 1i64];
            }

            // ── Apply OS chrome removal to the mini overlay ────────────────
            #[cfg(target_os = "windows")]
            {
                if let Some(win) = app.get_webview_window("mini") {
                    if let Ok(hwnd) = win.hwnd() {
                        let win_hwnd = windows::Win32::Foundation::HWND(hwnd.0);
                        remove_window_border(win_hwnd);
                        unsafe {
                            let _ = windows::Win32::UI::Shell::SetWindowSubclass(
                                win_hwnd, Some(mini_subclass_proc), 1, 0,
                            );
                        }
                    }
                }
            }

            // ── Launch the compact widget as the primary interface ─────────
            // show_launcher_widget calls objc2::msg_send! (NSWindow ObjC APIs)
            // which MUST run on the main thread. setup() already runs on the
            // main thread, so call it directly — never via async_runtime::spawn
            // which would put it on a tokio worker and cause EXC_BREAKPOINT/SIGTRAP.
            if let Err(e) = show_launcher_widget(app.handle().clone()) {
                eprintln!("[setup] show_launcher_widget failed: {e}");
            }

            // ── Deep-link: handle auth ticket + bring widget to front ────
            // hireshade://auth-callback?ticket=TOKEN  ← browser login flow
            //   Extract the ticket and emit it to the launcher webview so the
            //   widget can sign in via Clerk's "ticket" strategy without ever
            //   showing a webview or the main window.
            //
            // Any other deep link (e.g. hireshade://oauth-callback) just
            // brings the appropriate window to the front as before.
            let deep_link_handle = app.handle().clone();
            app.handle().deep_link().on_open_url(move |event| {
                let urls = event.urls();
                let url_str = urls.first().map(|u| u.as_str().to_owned()).unwrap_or_default();

                // ── auth-callback: extract ticket, emit to launcher ────────
                if url_str.starts_with("hireshade://auth-callback") {
                    if let Ok(parsed) = url::Url::parse(&url_str) {
                        let ticket = parsed
                            .query_pairs()
                            .find(|(k, _)| k == "ticket")
                            .map(|(_, v)| v.into_owned());

                        if let Some(ticket) = ticket {
                            // Ticket present: widget signs in via Clerk ticket strategy
                            let _ = deep_link_handle.emit("auth:tauri-ticket", &ticket);
                        } else {
                            // No ticket: widget reloads to pick up shared localStorage session
                            let _ = deep_link_handle.emit("auth:reload", ());
                        }
                    } else {
                        // Parse failed but URL starts with auth-callback — still reload
                        let _ = deep_link_handle.emit("auth:reload", ());
                    }

                    // Bring launcher to front — do NOT open the main window
                    if let Some(widget) = deep_link_handle.get_webview_window("launcher") {
                        #[cfg(target_os = "macos")]
                        {
                            let w = widget.clone();
                            let _ = widget.run_on_main_thread(move || {
                                unsafe {
                                    if let Ok(ns_win) = w.ns_window() {
                                        let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                        let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                                    }
                                }
                            });
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let _ = widget.show();
                            let _ = widget.set_focus();
                        }
                    }
                    return;
                }

                // ── All other deep links: just bring the right window front ─
                if let Some(main) = deep_link_handle.get_webview_window("main") {
                    let _ = main.show();
                    let _ = main.set_focus();
                } else if let Some(widget) = deep_link_handle.get_webview_window("launcher") {
                    #[cfg(target_os = "macos")]
                    {
                        let w = widget.clone();
                        let _ = widget.run_on_main_thread(move || {
                            unsafe {
                                if let Ok(ns_win) = w.ns_window() {
                                    let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                    let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                                }
                            }
                        });
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        let _ = widget.show();
                        let _ = widget.set_focus();
                    }
                }
            });

            if let Ok(Some(_)) = app.handle().deep_link().get_current() {
                if let Some(widget) = app.handle().get_webview_window("launcher") {
                    #[cfg(target_os = "macos")]
                    {
                        let w = widget.clone();
                        let _ = widget.run_on_main_thread(move || {
                            unsafe {
                                if let Ok(ns_win) = w.ns_window() {
                                    let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                    let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                                }
                            }
                        });
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        let _ = widget.show();
                        let _ = widget.set_focus();
                    }
                }
            }

            // ── Mini window events ─────────────────────────────────────────
            // When the active-session overlay is minimized, restore the widget.
            if let Some(mini_win) = app.get_webview_window("mini") {
                let mini_handle = app.handle().clone();
                mini_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        let mini = mini_handle.get_webview_window("mini").unwrap();
                        if mini.is_minimized().unwrap_or(false) {
                            let _ = mini.hide();
                            if !SESSION_ACTIVE.load(Ordering::SeqCst) {
                                if let Some(widget) = mini_handle.get_webview_window("launcher") {
                                    // macOS: avoid makeKeyAndOrderFront path.
                                    #[cfg(target_os = "macos")]
                                    {
                                        let w = widget.clone();
                                        let _ = widget.run_on_main_thread(move || {
                                            unsafe {
                                                if let Ok(ns_win) = w.ns_window() {
                                                    let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                                    let _: () = objc2::msg_send![ptr, orderFrontRegardless];
                                                }
                                            }
                                        });
                                    }
                                    #[cfg(not(target_os = "macos"))]
                                    {
                                        let _ = widget.show();
                                        let _ = widget.set_focus();
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // ── macOS: re-apply NSStatusWindowLevel on every Focused event ─
            //
            // macOS resets window levels after any focus / show lifecycle
            // event (Tauri internally calls makeKeyAndOrderFront which
            // re-enters the Quartz Compositor at the current level — which
            // may have been downgraded to NSFloatingWindowLevel (3) by
            // system events like Mission Control, Exposé, or another app
            // stealing focus).
            //
            // The fix: install a persistent on_window_event listener on both
            // overlay windows. On every Focused(_) event we re-apply level 25
            // (NSStatusWindowLevel) atomically on the main thread. This costs
            // one msg_send per focus event and is invisible to the user.
            #[cfg(target_os = "macos")]
            {
                // launcher window — always shown
                if let Some(win) = app.get_webview_window("launcher") {
                    let w = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::Focused(_) = event {
                            let ww = w.clone();
                            let _ = w.run_on_main_thread(move || {
                                const NS_STATUS_WINDOW_LEVEL: i64 = 25;
                                unsafe {
                                    if let Ok(ns_win) = ww.ns_window() {
                                        let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                        let _: () = objc2::msg_send![ptr, setLevel: NS_STATUS_WINDOW_LEVEL];
                                    }
                                }
                            });
                        }
                    });
                }

                // mini overlay — shown during active sessions
                if let Some(win) = app.get_webview_window("mini") {
                    let w = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::Focused(_) = event {
                            let ww = w.clone();
                            let _ = w.run_on_main_thread(move || {
                                const NS_STATUS_WINDOW_LEVEL: i64 = 25;
                                unsafe {
                                    if let Ok(ns_win) = ww.ns_window() {
                                        let ptr = ns_win as *mut objc2::runtime::AnyObject;
                                        let _: () = objc2::msg_send![ptr, setLevel: NS_STATUS_WINDOW_LEVEL];
                                    }
                                }
                            });
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_floating, capture_screen, show_mini_top_center, set_mini_state,
            set_mini_size_instant,
            start_audio_stream, stop_audio_stream, list_audio_devices,
            start_display_audio_stream, stop_display_audio_stream,
            start_system_audio_transcription, stop_system_audio_transcription,
            start_mic_transcription, stop_mic_transcription,
            open_screen_recording_settings, open_microphone_settings,
            ensure_microphone_permission,
            set_session_active, handle_launcher_click,
            open_main_dashboard, show_launcher_widget,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: clicking the Dock icon when no windows are visible fires
            // Reopen instead of relaunching the process. Tauri has no default
            // handler for it, so without this the Dock icon does nothing once
            // the launcher/mini windows have been hidden.
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Err(e) = handle_launcher_click(app.clone()) {
                    eprintln!("[reopen] handle_launcher_click failed: {e}");
                }
            }
        });
}