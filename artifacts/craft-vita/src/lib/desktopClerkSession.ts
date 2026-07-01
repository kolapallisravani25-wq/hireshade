const DESKTOP_CLERK_SESSION_KEY = "ss.desktop.clerk_session_id";

export function getDesktopClerkSessionId(): string | null {
  try {
    return localStorage.getItem(DESKTOP_CLERK_SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveDesktopClerkSessionId(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  try {
    localStorage.setItem(DESKTOP_CLERK_SESSION_KEY, sessionId);
  } catch {
    // Ignore storage errors (private mode / quota).
  }
}

export function clearDesktopClerkSessionId(): void {
  try {
    localStorage.removeItem(DESKTOP_CLERK_SESSION_KEY);
  } catch {
    // Ignore storage errors.
  }
}
