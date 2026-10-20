// S1 option (b): in-process affinity probe using the Windows crate.
// Creates its own layered-less Win32 window, sets WDA mode from AFFINITY_MODE,
// paints a high-contrast pattern, prints JSON (bounds + affinity readback) and
// stays alive for AFFINITY_SECONDS so external capture paths can measure it.
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::time::{SystemTime, UNIX_EPOCH};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{BeginPaint, CreateSolidBrush, EndPaint, FillRect, UpdateWindow, PAINTSTRUCT};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW,
    GetWindowDisplayAffinity, GetWindowRect, PostQuitMessage, RegisterClassW, SetTimer,
    SetWindowDisplayAffinity, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, MSG, SW_SHOW,
    WINDOW_DISPLAY_AFFINITY, WM_DESTROY, WM_PAINT, WM_TIMER, WNDCLASSW, WS_EX_TOPMOST,
    WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
}

fn parse_mode() -> u32 {
    match std::env::var("AFFINITY_MODE").unwrap_or_else(|_| "none".into()).as_str() {
        "exclude" | "0x11" | "11" => 0x11,
        "monitor" | "0x01" | "1" => 0x01,
        _ => 0x00,
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut paint = PAINTSTRUCT::default();
            let hdc = BeginPaint(hwnd, &mut paint);
            let mut rect = RECT::default();
            let _ = GetClientRect(hwnd, &mut rect);
            let white = CreateSolidBrush(COLORREF(0x00FFFFFF));
            let black = CreateSolidBrush(COLORREF(0x00000000));
            let _ = FillRect(hdc, &rect, white);
            let stripe = 40;
            let mut x = 0;
            while x < rect.right {
                let band = RECT { left: x, top: 0, right: (x + stripe).min(rect.right), bottom: rect.bottom };
                let _ = FillRect(hdc, &band, black);
                x += stripe * 2;
            }
            let _ = EndPaint(hwnd, &paint);
            LRESULT(0)
        }
        WM_TIMER => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn main() {
    unsafe {
        let instance = windows::Win32::System::LibraryLoader::GetModuleHandleW(None).unwrap();
        let class_name = wide("HireShadeAffinityProbe");
        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: HINSTANCE(instance.0),
            lpszClassName: PCWSTR(class_name.as_ptr()),
            ..Default::default()
        };
        let _ = RegisterClassW(&wc);
        let title = wide("HireShade Affinity Probe");
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST,
            PCWSTR(class_name.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            120,
            120,
            520,
            340,
            None,
            None,
            HINSTANCE(instance.0),
            None,
        )
        .expect("CreateWindowExW failed");
        let mode = parse_mode();
        let set_result = SetWindowDisplayAffinity(hwnd, WINDOW_DISPLAY_AFFINITY(mode));
        let mut readback = 0u32;
        let _ = GetWindowDisplayAffinity(hwnd, &mut readback);
        let mut rect = RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = UpdateWindow(hwnd);
        let seconds: u64 = std::env::var("AFFINITY_SECONDS").ok().and_then(|v| v.parse().ok()).unwrap_or(8);
        let _ = SetTimer(hwnd, 1, (seconds * 1000) as u32, None);
        let started = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        println!(
            "{{\"probe\":\"affinity-probe\",\"requested\":{},\"set_ok\":{},\"readback\":{},\"hwnd\":{},\"bounds\":{{\"x\":{},\"y\":{},\"width\":{},\"height\":{}}},\"started_ms\":{},\"seconds\":{}}}",
            mode,
            set_result.is_ok(),
            readback,
            hwnd.0 as usize,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            started,
            seconds
        );
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, hwnd, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
