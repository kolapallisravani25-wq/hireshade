use windows::Win32::UI::WindowsAndMessaging::ShowCursor;
use tauri::command;

#[command]
pub fn hide_system_cursor() {
    unsafe { while ShowCursor(false) >= 0 {} }
}

#[command]
pub fn show_system_cursor() {
    unsafe { while ShowCursor(true) < 0 {} }
}