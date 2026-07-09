import { isTauri } from "@/lib/utils";

/**
 * Clerk options that MUST be applied to every ClerkProvider mounted inside the
 * Tauri desktop webview (main, launcher/widget, and floating/mini windows).
 *
 * In the webview, Clerk's default "standard browser" mode maintains the session
 * with cross-origin Secure cookies on clerk.hireshade.com. The webview
 * (tauri.localhost) cannot reliably persist/send those cookies, so sign-in
 * succeeds but the session evaporates on the first background sync: clerk-js's
 * on-focus "touch" ping comes back unauthenticated, `isSignedIn` flips to false,
 * and the window bounces to the login screen (the recurring "clicking the
 * company-name field kicks me back to login" bug). Loading clerk-js with
 * `standardBrowser:false` switches it to JWT-based session syncing (the mode
 * built for webview environments like Capacitor — no cookies involved, session
 * persisted via the localStorage client JWT which survives app restarts), and
 * `touchSession:false` disables the focus ping that was the immediate trigger.
 *
 * v0.1.10 introduced this for the main window (main.tsx) only. The launcher and
 * floating windows kept the cookie-based default, so the session-creation UI —
 * which lives in the launcher window — still bounced. This helper makes the
 * mode identical across every desktop window. Web builds get `{}` (unaffected).
 */
export function getDesktopClerkOptions(): {
  standardBrowser?: boolean;
  touchSession?: boolean;
} {
  return isTauri() ? { standardBrowser: false, touchSession: false } : {};
}
