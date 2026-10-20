use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT};
use std::sync::OnceLock;

static HOOK: OnceLock<isize> = OnceLock::new();

unsafe extern "system" fn event_hook(
    _: HWINEVENTHOOK,
    _: u32,
    _: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {}

pub fn install_focus_bypass() {
    unsafe {
        let hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            HMODULE(std::ptr::null_mut()),
            Some(event_hook),
            0, 0,
            WINEVENT_OUTOFCONTEXT,
        );
        if !hook.0.is_null() {
            let _ = HOOK.set(hook.0 as isize);
        }
    }
}

pub fn uninstall_focus_bypass() {
    if let Some(hook) = HOOK.get() {
        unsafe {
            let _ = UnhookWinEvent(HWINEVENTHOOK(*hook as *mut core::ffi::c_void));
        }
    }
}
