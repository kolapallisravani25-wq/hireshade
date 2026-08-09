/**
 * Per-session in-flight generation lock.
 *
 * Root incident this addresses (Q&A pipeline audit — "duplicate answers" /
 * "Manual Ask AI race"): the desktop app runs TWO independent windows (main
 * browser window + floating Tauri overlay), each with its own JS heap and its
 * own client-side "is a generation already running" guard. Those guards
 * cannot see each other, so an auto-fired answer in one window and a
 * manual-click answer in the other can both reach the model concurrently for
 * the same session, producing duplicate answer cards.
 *
 * This backend endpoint is the one place every trigger source (auto/manual/
 * floating/main/screen-analysis) already converges, so it's the correct place
 * to enforce "at most one generation in flight per session" — no frontend
 * change, no cross-window IPC needed.
 *
 * Deliberately a simple in-memory per-process Set, not a distributed lock:
 * api-server runs as a single Node process (no cluster.fork/pm2 multi-instance
 * found in this codebase). If that changes, this needs to move to a shared
 * store (e.g. Redis) — see NEEDS MANUAL VERIFICATION note in the audit.
 */

const inFlightSessions = new Set<string>();

/**
 * Attempt to acquire the generation lock for a session.
 * Returns true if acquired (caller may proceed), false if another generation
 * is already in flight for this session (caller must reject the request).
 */
export function acquireGenerationLock(sessionId: string): boolean {
  if (inFlightSessions.has(sessionId)) return false;
  inFlightSessions.add(sessionId);
  return true;
}

/** Release the lock. Safe to call even if the session was never locked. */
export function releaseGenerationLock(sessionId: string): void {
  inFlightSessions.delete(sessionId);
}

/** Test/debug helper — is a generation currently in flight for this session? */
export function isGenerationLocked(sessionId: string): boolean {
  return inFlightSessions.has(sessionId);
}
