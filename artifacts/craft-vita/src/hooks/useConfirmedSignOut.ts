import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/clerk-react";
import { isTauri } from "@/lib/utils";

const SIGN_OUT_GRACE_MS = 1500;

export interface ConfirmedSignOut {
  isLoaded: boolean;
  isSignedIn: boolean;
  /**
   * True only once a signed-out state has been *confirmed* — i.e. Clerk has
   * reported `isSignedIn === false` for the full grace window AND a fresh
   * getToken() could not produce a token. Until then a transient false is
   * treated as a token-refresh blip, not a real sign-out.
   */
  signedOutConfirmed: boolean;
}

/**
 * In the Tauri webview Clerk's `isSignedIn` can momentarily flip to false
 * during a background token refresh. Redirecting to /sign-in (or swapping in the
 * launcher's AuthScreen) on that raw value bounces the user out of whatever
 * they were doing — e.g. mid session-creation, "right when I click on the
 * company name field". v0.1.11 debounced the *cross-window broadcast* in
 * DesktopAuthHydrator but the per-window redirect guards still reacted to the
 * raw `!isSignedIn` with no grace, so the bounce persisted.
 *
 * This hook debounces the signed-out state consistently for every window: it
 * only confirms a sign-out after `isSignedIn` has stayed false for the grace
 * window, and does a final getToken() retry first (a live token proves the
 * session is actually valid, so no sign-out is reported). On web there is no
 * blip, so the confirmation is immediate.
 */
export function useConfirmedSignOut(): ConfirmedSignOut {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();

  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [signedOutConfirmed, setSignedOutConfirmed] = useState<boolean>(
    () => !isTauri(),
  );

  useEffect(() => {
    if (!isTauri()) {
      setSignedOutConfirmed(true);
      return;
    }
    if (!isLoaded) return;

    if (isSignedIn) {
      setSignedOutConfirmed(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        let token: string | null = null;
        try {
          token = await getTokenRef.current();
        } catch {
          token = null;
        }
        if (!cancelled && !token) setSignedOutConfirmed(true);
      })();
    }, SIGN_OUT_GRACE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoaded, isSignedIn]);

  return { isLoaded, isSignedIn: isSignedIn ?? false, signedOutConfirmed };
}
