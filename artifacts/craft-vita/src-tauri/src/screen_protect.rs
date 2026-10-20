//! Screen-capture exclusion for the overlay windows (G-011).
//!
//! The primary mode is WDA_EXCLUDEFROMCAPTURE (0x11, Windows 10 2004+): the
//! window stays visible on the physical display but is omitted from screen
//! shares, recordings and screenshots. On older Windows builds that reject
//! 0x11 we fall back to WDA_MONITOR (0x01), which captures as a black
//! rectangle instead of failing silently.
//!
//! Tauri's own contentProtected window config already maps to
//! WDA_EXCLUDEFROMCAPTURE through tao, but that call is fire-and-forget and
//! has no fallback. This module is the explicit path used by the
//! set_screen_protection command and re-applied whenever an overlay window
//! is created or re-shown. On non-Windows platforms it delegates to Tauri's
//! cross-platform set_content_protected so the same command works on macOS.

use tauri::WebviewWindow;

/// Window participates in captures (default OS behavior).
pub const WDA_NONE: u32 = 0x0000_0000;
/// Legacy fallback: the window appears as a black rectangle in captures.
pub const WDA_MONITOR: u32 = 0x0000_0001;
/// Windows 10 2004+: the window is excluded from capture output entirely.
pub const WDA_EXCLUDEFROMCAPTURE: u32 = 0x0000_0011;

/// Ordered affinity candidates for a requested protection state. The first
/// candidate accepted by the OS wins, so 0x11 is always attempted before 0x01.
pub fn affinity_candidates(protect: bool) -> &'static [u32] {
    if protect {
        &[WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR]
    } else {
        &[WDA_NONE]
    }
}

/// Human-readable name for logs and command results.
pub fn affinity_name(affinity: u32) -> &'static str {
    match affinity {
        WDA_NONE => "WDA_NONE",
        WDA_MONITOR => "WDA_MONITOR",
        WDA_EXCLUDEFROMCAPTURE => "WDA_EXCLUDEFROMCAPTURE",
        _ => "WDA_UNKNOWN",
    }
}

/// Apply the first affinity candidate accepted by apply.
///
/// Pure fallback policy so the 0x11 -> 0x01 downgrade is unit-testable without
/// a real window: the caller supplies the OS call as a closure.
pub fn apply_first_supported<F>(protect: bool, mut apply: F) -> Result<u32, String>
where
    F: FnMut(u32) -> Result<(), String>,
{
    let mut failures: Vec<String> = Vec::new();
    for candidate in affinity_candidates(protect) {
        match apply(*candidate) {
            Ok(()) => return Ok(*candidate),
            Err(error) => failures.push(format!(
                "0x{candidate:02X} ({}) rejected: {error}",
                affinity_name(*candidate)
            )),
        }
    }
    Err(format!(
        "SetWindowDisplayAffinity accepted no mode: {}",
        failures.join("; ")
    ))
}

#[cfg(target_os = "windows")]
fn set_affinity_raw(hwnd: isize, affinity: u32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WINDOW_DISPLAY_AFFINITY,
    };

    unsafe {
        SetWindowDisplayAffinity(
            HWND(hwnd as *mut core::ffi::c_void),
            WINDOW_DISPLAY_AFFINITY(affinity),
        )
        .map_err(|error| error.to_string())
    }
}

/// Apply capture protection to a raw Win32 window handle.
#[cfg(target_os = "windows")]
pub fn apply_affinity(hwnd: isize, protect: bool) -> Result<u32, String> {
    apply_first_supported(protect, |affinity| set_affinity_raw(hwnd, affinity))
}

/// Apply capture protection to a Tauri window.
///
/// Windows: explicit SetWindowDisplayAffinity with the 0x11 -> 0x01 fallback.
/// Other platforms: Tauri's cross-platform content protection.
pub fn apply_to_window(window: &WebviewWindow, protect: bool) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| format!("hwnd(): {error}"))?;
        // Tauri re-exports the windows 0.61 HWND, whose field is a raw pointer.
        apply_affinity(hwnd.0 as isize, protect)
    }
    #[cfg(not(target_os = "windows"))]
    {
        window
            .set_content_protected(protect)
            .map_err(|error| error.to_string())?;
        Ok(if protect { 1 } else { 0 })
    }
}

/// Best-effort protection applied when an overlay window is created/re-shown.
/// Never panics: a failure is logged and the window stays usable.
pub fn apply_on_create(window: &WebviewWindow) {
    match apply_to_window(window, true) {
        Ok(affinity) => {
            #[cfg(debug_assertions)]
            println!(
                "[screen_protect] {} protected with {} (0x{affinity:02X})",
                window.label(),
                affinity_name(affinity)
            );
        }
        Err(error) => {
            eprintln!(
                "[screen_protect] failed to protect {}: {error}",
                window.label()
            );
        }
    }
}

/// Tauri command: explicitly set or clear screen-capture exclusion.
///
/// Returns the applied mode, e.g. "WDA_EXCLUDEFROMCAPTURE (0x11)", so callers
/// can surface whether the OS had to downgrade to the legacy fallback.
#[tauri::command]
pub fn set_screen_protection(window: WebviewWindow, protect: bool) -> Result<String, String> {
    let affinity = apply_to_window(&window, protect)?;
    Ok(format!("{} (0x{affinity:02X})", affinity_name(affinity)))
}

#[cfg(test)]
mod tests {
    use super::{
        affinity_candidates, affinity_name, apply_first_supported, WDA_EXCLUDEFROMCAPTURE,
        WDA_MONITOR, WDA_NONE,
    };

    #[test]
    fn constants_match_the_windows_sdk() {
        assert_eq!(WDA_NONE, 0x0);
        assert_eq!(WDA_MONITOR, 0x1);
        assert_eq!(WDA_EXCLUDEFROMCAPTURE, 0x11);
    }

    #[test]
    fn names_are_stable_for_logs() {
        assert_eq!(affinity_name(WDA_NONE), "WDA_NONE");
        assert_eq!(affinity_name(WDA_MONITOR), "WDA_MONITOR");
        assert_eq!(
            affinity_name(WDA_EXCLUDEFROMCAPTURE),
            "WDA_EXCLUDEFROMCAPTURE"
        );
        assert_eq!(affinity_name(0x99), "WDA_UNKNOWN");
    }

    #[test]
    fn protection_prefers_exclude_from_capture_with_monitor_fallback() {
        assert_eq!(
            affinity_candidates(true),
            &[WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR]
        );
        assert_eq!(affinity_candidates(false), &[WDA_NONE]);
    }

    #[test]
    fn uses_exclude_from_capture_when_the_os_accepts_it() {
        let mut attempts: Vec<u32> = Vec::new();
        let applied = apply_first_supported(true, |affinity| {
            attempts.push(affinity);
            Ok(())
        })
        .expect("0x11 should be accepted");
        assert_eq!(applied, WDA_EXCLUDEFROMCAPTURE);
        assert_eq!(attempts, vec![WDA_EXCLUDEFROMCAPTURE]);
    }

    #[test]
    fn falls_back_to_monitor_when_exclude_from_capture_is_rejected() {
        let mut attempts: Vec<u32> = Vec::new();
        let applied = apply_first_supported(true, |affinity| {
            attempts.push(affinity);
            if affinity == WDA_EXCLUDEFROMCAPTURE {
                Err("not supported before Windows 10 2004".to_string())
            } else {
                Ok(())
            }
        })
        .expect("fallback should succeed");
        assert_eq!(applied, WDA_MONITOR);
        assert_eq!(attempts, vec![WDA_EXCLUDEFROMCAPTURE, WDA_MONITOR]);
    }

    #[test]
    fn reports_every_rejected_mode_when_no_fallback_works() {
        let error = apply_first_supported(true, |_| Err("denied".to_string()))
            .expect_err("all modes rejected");
        assert!(error.contains("WDA_EXCLUDEFROMCAPTURE"), "{error}");
        assert!(error.contains("WDA_MONITOR"), "{error}");
        assert!(error.contains("denied"), "{error}");
    }

    #[test]
    fn disabling_only_attempts_none() {
        let mut attempts: Vec<u32> = Vec::new();
        let applied = apply_first_supported(false, |affinity| {
            attempts.push(affinity);
            Ok(())
        })
        .expect("disable should succeed");
        assert_eq!(applied, WDA_NONE);
        assert_eq!(attempts, vec![WDA_NONE]);
    }
}
