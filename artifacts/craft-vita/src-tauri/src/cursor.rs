//! System cursor hiding for screenshot / overlay flows (G-011).
//!
//! These commands are wired into the Tauri invoke_handler so the module is no
//! longer dead code. They are Windows-only in effect; other platforms return a
//! descriptive error instead of failing to compile (the windows crate is a
//! Windows-only dependency).

#[tauri::command]
pub fn hide_system_cursor() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::ShowCursor;
        // ShowCursor keeps a per-thread display counter; decrement until the
        // cursor is actually hidden. Pair with show_system_cursor to restore it
        // (otherwise the pointer stays hidden until the process exits).
        unsafe {
            while ShowCursor(false) >= 0 {}
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("cursor hiding is only implemented on Windows".to_string())
    }
}

#[tauri::command]
pub fn show_system_cursor() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::ShowCursor;
        unsafe {
            while ShowCursor(true) < 0 {}
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("cursor hiding is only implemented on Windows".to_string())
    }
}
