import React from "react";
import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import {
  clearPersistedDesktopSession,
  emitDesktopAuthStateChanged,
  listenDesktopAuthStateChanged,
  persistDesktopSession,
  readPersistedDesktopSession,
} from "@/lib/desktopAuthSession";
import { isTauri } from "@/lib/utils";
import { registerGetToken } from "@/lib/globalAuth";

interface DesktopAuthHydratorProps {
  children: React.ReactNode;
  source: string;
  loadingFallback?: React.ReactNode;
}

export function DesktopAuthHydrator({ children, source, loadingFallback }: DesktopAuthHydratorProps) {
  const { isLoaded, isSignedIn } = useUser();
  const { sessionId, getToken } = useAuth();
  const { setActive, signOut } = useClerk();

  // Every window mounts this component but only the main window runs
  // useSyncUser(). Register the Clerk token provider here so that ALL windows
  // (launcher, floating, mini) attach a Bearer token to their API calls via
  // getAuthHeaders(). Without this, calls from secondary windows go out
  // unauthenticated, 401, and a route guard can misread that as "signed out".
  const getTokenRef = React.useRef(getToken);
  React.useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  React.useEffect(() => {
    registerGetToken(() => getTokenRef.current());
  }, []);

  const [hydrationState, setHydrationState] = React.useState<'idle' | 'restoring' | 'completed'>('idle');
  const [hydrated, setHydrated] = React.useState<boolean>(() => !isTauri());

  const isSignedInRef = React.useRef(isSignedIn);
  React.useEffect(() => {
    isSignedInRef.current = isSignedIn;
  }, [isSignedIn]);

  React.useEffect(() => {
    if (!isTauri()) {
      setHydrationState('completed');
      setHydrated(true);
      return;
    }
    if (!isLoaded || hydrationState !== 'idle') return;

    setHydrationState('restoring');
    let cancelled = false;

    (async () => {
      try {
        const persistedSessionId = await readPersistedDesktopSession();
        console.info("[auth/hydrator] restore attempt", {
          source,
          hasPersistedSession: !!persistedSessionId,
          isSignedIn,
        });

        if (!isSignedIn && persistedSessionId) {
          await setActive({ session: persistedSessionId });
          console.info("[auth/hydrator] setActive completed", { source });

          // Wait for Clerk's React state to reflect the sign-in status (max 3 seconds)
          let checks = 0;
          while (checks < 30 && !cancelled) {
            if (isSignedInRef.current) {
              console.info("[auth/hydrator] Clerk state reflected signed-in status", { source });
              break;
            }
            await new Promise<void>((r) => setTimeout(r, 100));
            checks++;
          }
        }
      } catch (error) {
        console.warn("[auth/hydrator] session restore failed", { source, error });
        await clearPersistedDesktopSession().catch(() => {});
      } finally {
        if (!cancelled) {
          setHydrationState('completed');
          setHydrated(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isLoaded, setActive, source]);

  React.useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    listenDesktopAuthStateChanged(async (payload) => {
      if (payload.source === source || !isLoaded) return;

      console.info("[auth/sync] inbound", {
        source,
        from: payload.source,
        signedIn: payload.signedIn,
        hasSession: !!payload.sessionId,
      });

      try {
        if (payload.sessionId && !isSignedIn) {
          await setActive({ session: payload.sessionId });
        } else if (!payload.sessionId && isSignedIn) {
          await signOut();
        }
      } catch (error) {
        console.warn("[auth/sync] inbound apply failed", { source, error });
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error) => {
        console.warn("[auth/sync] listener setup failed", { source, error });
      });

    return () => unlisten?.();
  }, [isLoaded, isSignedIn, setActive, signOut, source]);

  React.useEffect(() => {
    if (!isTauri() || !isLoaded || hydrationState !== 'completed') return;

    if (sessionId) {
      (async () => {
        try {
          await persistDesktopSession(sessionId);
          await emitDesktopAuthStateChanged({ source, sessionId, signedIn: true });
          console.info("[auth/persist] saved", { source });
        } catch (error) {
          console.warn("[auth/persist] update failed", { source, error });
        }
      })();
      return;
    }

    if (!hydrated || isSignedIn) return;

    // isSignedIn is false with no sessionId. In a Tauri webview this can be a
    // transient token-refresh blip rather than a real sign-out. Broadcasting a
    // sign-out immediately would cascade to every other window and bounce the
    // user back to the login screen (the reported "company name field kicks me
    // to login" bug). Wait a short grace period; if Clerk reports signed-in
    // again within that window, this effect re-runs and the cleanup cancels the
    // pending broadcast.
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        if (cancelled) return;
        try {
          await clearPersistedDesktopSession();
          await emitDesktopAuthStateChanged({ source, sessionId: null, signedIn: false });
          console.info("[auth/persist] cleared", { source });
        } catch (error) {
          console.warn("[auth/persist] update failed", { source, error });
        }
      })();
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrationState, hydrated, isLoaded, isSignedIn, sessionId, source]);

  if (!isLoaded || !hydrated) {
    return (
      <>
        {loadingFallback ?? (
          <div className="min-h-screen bg-white flex items-center justify-center p-4">
            <div className="animate-pulse flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
              <p className="text-slate-600 text-sm font-medium">Restoring your session...</p>
            </div>
          </div>
        )}
      </>
    );
  }

  return <>{children}</>;
}
