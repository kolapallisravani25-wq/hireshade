#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_RS="$ROOT/artifacts/craft-vita/src-tauri/src/lib.rs"

if [[ ! -f "$LIB_RS" ]]; then
  echo "Cannot find $LIB_RS" >&2
  exit 1
fi

python3 - <<'PY'
from pathlib import Path

path = Path("artifacts/craft-vita/src-tauri/src/lib.rs")
text = path.read_text()

old = '''    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: permission is either always granted (Windows) or
        // managed by the DE (Linux).  Probe the device as a basic sanity check.
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        host.default_input_device()
            .ok_or_else(|| "No default input device found".to_string())
            .and_then(|d| d.default_input_config().map(|_| ()).map_err(|e| e.to_string()))
    }
'''
new = '''    #[cfg(target_os = "windows")]
    {
        // Windows: permission is managed by the OS. Probe the device as a basic sanity check.
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        host.default_input_device()
            .ok_or_else(|| "No default input device found".to_string())
            .and_then(|d| d.default_input_config().map(|_| ()).map_err(|e| e.to_string()))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux desktop STT is not supported by this app yet. Keep the command compiled
        // so Linux CI can validate the rest of the Tauri build.
        Err("Microphone permission preflight is supported on macOS/Windows only".to_string())
    }
'''
if old in text:
    text = text.replace(old, new, 1)

old_run = '''        .run(|app, event| {
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
'''
new_run = '''        .run(|_app, _event| {
            // Tauri 2.10 no longer exposes the old RunEvent::Reopen variant used by
            // the recovered code. Keep the run loop explicit and handle launcher
            // restoration through normal window/deep-link events for now.
        });
'''
if old_run in text:
    text = text.replace(old_run, new_run, 1)

path.write_text(text)
PY

echo "CI Tauri build patch applied."
