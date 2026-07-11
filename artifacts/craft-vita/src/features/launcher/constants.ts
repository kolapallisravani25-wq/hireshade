// ─── Launcher feature constants ───────────────────────────────────────────────
// Single source of truth for env-derived values and magic numbers used across
// the launcher feature tree.  Import from here — do NOT read import.meta.env
// directly inside components or hooks.

const _rawFrontendUrl: string =
  import.meta.env.VITE_FRONTEND_URL ?? "https://app.hireshade.org";

export const FRONTEND_URL = _rawFrontendUrl.startsWith("http")
  ? _rawFrontendUrl
  : `https://${_rawFrontendUrl}`;

export const BACKEND_URL: string =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:3200";

export const WIDGET_W = 460;
export const MORE_ACTIONS_POPOVER_W = 240;

/**
 * Estimated maximum height of the HeaderMenu in CSS px.
 * Used by usePopoverAnchor to decide whether to open downward or flip upward.
 *
 * Layout breakdown (approximate):
 *   email row        38px
 *   dashboard link   38px  + 1px sep
 *   opacity section  72px  + 1px sep
 *   zoom row         38px  + 1px sep
 *   private row      38px  + 1px sep
 *   logout row       38px  + 1px sep
 *   py-1 padding      8px
 *   total           ≈ 274px  → round up to 300px for safety
 */
export const HEADER_MENU_MAX_H = 300;

/**
 * Safe bottom clearance from the screen edge before flipping direction.
 * 80px accounts for the macOS Dock (≈60px) + a 20px breathing gap.
 * On multi-monitor setups the Dock may or may not appear, but the safety
 * margin ensures the menu never hugs the very bottom of the screen.
 */
export const MENU_FLIP_SAFE_BOTTOM = 80;
export const APP_NAME = "HireShade";

/** Fixed OAuth callback server port — does not need Clerk allowlist. */
export const TAURI_AUTH_PORT = 10002;

/** Minimum meaningful job description length for validation. */
export const JOB_DESCRIPTION_REGEX = /^.{2,}/im;

export const AI_MODELS_WIDGET = [
  { value: "anthropic/claude-haiku-4.5",          label: "Claude Haiku 4.5",       badge: "fast"      },
  { value: "anthropic/claude-sonnet-4.5",          label: "Claude Sonnet 4.5",      badge: "reasoning" },
  { value: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite"                      },
  { value: "openai/gpt-5",                          label: "GPT-5"                                      },
];

/** Static HTML served by the local OAuth callback server. */
export const AUTH_CALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>HireShade – Signed In</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f0f12;font-family:-apple-system,sans-serif;color:#e5e7eb}.card{background:#1a1a24;border:1px solid #2d2d3a;border-radius:16px;padding:40px 48px;text-align:center;max-width:400px;width:90%}.icon{width:56px;height:56px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}.icon svg{width:28px;height:28px}h1{font-size:1.4rem;font-weight:600;color:#f9fafb;margin-bottom:8px}p{font-size:.9rem;color:#9ca3af}</style>
</head>
<body><div class="card"><div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><h1>You're signed in!</h1><p>Switch back to the HireShade app to continue.</p></div></body>
</html>`;
