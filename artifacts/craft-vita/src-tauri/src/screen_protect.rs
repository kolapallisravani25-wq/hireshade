use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WINDOW_DISPLAY_AFFINITY};

const WDA_MONITOR: u32 = 0x00000001;

#[tauri::command]
pub fn set_screen_protection(window: tauri::Window, protect: bool) -> Result<(), String> {
    unsafe {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        let affinity = if protect { WDA_MONITOR } else { 0 };
        
        SetWindowDisplayAffinity(HWND(hwnd), WINDOW_DISPLAY_AFFINITY(affinity))
            .map_err(|e| format!("Failed: {}", e))?;
    }
    Ok(())
}

pub fn apply_on_create(window: &tauri::WebviewWindow) {
    unsafe {
        if let Ok(hwnd) = window.hwnd() {
            let _ = SetWindowDisplayAffinity(HWND(hwnd.0), WINDOW_DISPLAY_AFFINITY(WDA_MONITOR));
        }
    }
}