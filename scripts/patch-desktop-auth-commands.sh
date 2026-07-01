#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_RS="$ROOT/artifacts/craft-vita/src-tauri/src/lib.rs"

if [[ ! -f "$LIB_RS" ]]; then
  echo "Cannot find $LIB_RS" >&2
  exit 1
fi

if grep -q "fn auth_get_persisted_session" "$LIB_RS"; then
  echo "Native auth commands already appear to exist. Skipping insertion."
else
  python3 - <<'PY'
from pathlib import Path

path = Path("artifacts/craft-vita/src-tauri/src/lib.rs")
text = path.read_text()

insert = r'''
// ── Desktop auth persistence and cross-window sync ───────────────────────────
// Clerk session IDs are persisted natively for Tauri desktop windows so the
// launcher/main/mini webviews can restore and synchronize auth state reliably.
// The frontend still keeps a localStorage fallback, but these commands are the
// preferred desktop path.
const DESKTOP_AUTH_SESSION_KEY: &str = "hireshade.desktop.clerk_session_id";

#[tauri::command]
fn auth_get_persisted_session(app: AppHandle) -> Result<Option<String>, String> {
    let store = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = store.join("auth_session.txt");

    match std::fs::read_to_string(file) {
        Ok(value) => {
            let session = value.trim().to_string();
            if session.is_empty() { Ok(None) } else { Ok(Some(session)) }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn auth_set_persisted_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("auth_session.txt"), session_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn auth_clear_persisted_session(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = dir.join("auth_session.txt");
    match std::fs::remove_file(file) {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[derive(Clone, serde::Serialize)]
struct DesktopAuthStateChangedPayload {
    source: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    #[serde(rename = "signedIn")]
    signed_in: bool,
    #[serde(rename = "emittedAt")]
    emitted_at: String,
}

#[tauri::command]
fn auth_emit_state_changed(
    app: AppHandle,
    source: String,
    session_id: Option<String>,
    signed_in: bool,
) -> Result<(), String> {
    let payload = DesktopAuthStateChangedPayload {
        source,
        session_id,
        signed_in,
        emitted_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_else(|_| "0".to_string()),
    };
    app.emit("auth:state-changed", payload).map_err(|e| e.to_string())
}
'''

marker = "#[command]\nfn set_session_active"
if marker not in text:
    raise SystemExit("Could not find insertion marker for auth commands")
text = text.replace(marker, insert + "\n" + marker, 1)
path.write_text(text)
PY
fi

# Register the commands in Tauri's invoke handler if not already registered.
python3 - <<'PY'
from pathlib import Path
path = Path("artifacts/craft-vita/src-tauri/src/lib.rs")
text = path.read_text()
needle = "ensure_microphone_permission,\n            set_session_active"
replacement = "ensure_microphone_permission,\n            auth_get_persisted_session, auth_set_persisted_session,\n            auth_clear_persisted_session, auth_emit_state_changed,\n            set_session_active"
if needle in text and "auth_get_persisted_session" not in text[text.index("tauri::generate_handler!"):]:
    text = text.replace(needle, replacement, 1)
path.write_text(text)
PY

# Clean remaining visible desktop branding in Rust titles.
perl -pi -e 's/ScribeShade Floating Screen/HireShade Floating Screen/g; s/\.title\("ScribeShade"\)/.title("HireShade")/g' "$LIB_RS"

# Rename the fallback localStorage key without breaking native persistence.
perl -pi -e 's/ss\.desktop\.clerk_session_id/hireshade.desktop.clerk_session_id/g' "$ROOT/artifacts/craft-vita/src/lib/desktopClerkSession.ts"

echo "Patch applied. Review with:"
echo "  git diff -- artifacts/craft-vita/src-tauri/src/lib.rs artifacts/craft-vita/src/lib/desktopClerkSession.ts"
