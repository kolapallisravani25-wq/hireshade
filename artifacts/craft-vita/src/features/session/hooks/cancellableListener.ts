/**
 * StrictMode-safe async listener registration.
 *
 * Root cause fixed: React.StrictMode double-invokes effects in development
 * (mount → cleanup → mount again) to surface exactly this class of bug.
 * Tauri's `listen()` is async — the previous pattern
 * (`listen(...).then((fn) => { unlisten = fn; })`) had a race: if the
 * effect's cleanup ran BEFORE the promise resolved, `unlisten` was still
 * undefined at cleanup time, so the cleanup call was a no-op. The first
 * registration was then never unlistened and kept firing alongside the
 * second (post-remount) registration — duplicate event delivery.
 *
 * Extracted as a tiny generic helper (matching the autoScrollPolicy.ts /
 * autoGenQuestionSource.ts pattern used elsewhere in this codebase) so the
 * exact race — cleanup runs before the promise resolves, then the promise
 * resolves — is deterministically testable without React, Tauri, or a DOM
 * harness (none exist in this repo's "node" vitest environment).
 */

/**
 * Attach a listener whose registration is itself async (e.g. Tauri's
 * `listen()`), safely across an effect cleanup that may run before the
 * registration promise resolves.
 *
 * @param registerPromise a promise that resolves with the "unlisten"
 *   function once registration completes (e.g. `listen("event", handler)`).
 * @param invokeUnlisten how to call the resolved unlisten value (kept
 *   generic so this isn't coupled to Tauri's specific function shape).
 * @returns an object with `cancel()` — call from the effect's cleanup. If
 *   the registration promise hasn't resolved yet, this marks it cancelled so
 *   that when it DOES resolve, the just-registered listener is immediately
 *   unlistened instead of leaking. If it already resolved, unlistens now.
 */
export function attachCancellableListener<TUnlisten>(
  registerPromise: Promise<TUnlisten>,
  invokeUnlisten: (unlisten: TUnlisten) => void,
): { cancel: () => void } {
  let cancelled = false;
  let resolved: TUnlisten | undefined;

  registerPromise
    .then((unlisten) => {
      if (cancelled) {
        // Cleanup already ran before this resolved — undo the registration
        // immediately instead of leaking an orphaned listener.
        invokeUnlisten(unlisten);
        return;
      }
      resolved = unlisten;
    })
    .catch(() => {
      // Registration failed — nothing to unlisten.
    });

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      if (resolved !== undefined) {
        invokeUnlisten(resolved);
        resolved = undefined;
      }
    },
  };
}
