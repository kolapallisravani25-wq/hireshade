import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { registerGetToken } from "@/lib/globalAuth";
import {
  getDesktopAccessToken,
  startDesktopLogin,
  clearDesktopSession,
  hasDesktopSession,
} from "@/lib/desktopSession";

export interface DesktopUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
}

interface DesktopAuthValue {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: DesktopUser | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DesktopAuthContext = createContext<DesktopAuthValue | null>(null);

const BACKEND = import.meta.env.VITE_BACKEND_URL as string;

/**
 * Provides desktop (external-browser) auth state to the Tauri windows. Replaces
 * Clerk's useUser/useAuth for gating: the app is "signed in" when it holds a
 * valid desktop session token. Also registers the desktop access token with
 * globalAuth so getAuthToken()/getAuthHeaders() — used across the session flow —
 * return it automatically.
 */
export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [user, setUser] = useState<DesktopUser | null>(null);

  // Route all token requests in this window to the desktop access token.
  useEffect(() => {
    registerGetToken(getDesktopAccessToken);
  }, []);

  const hydrate = useCallback(async () => {
    if (!hasDesktopSession()) {
      setIsSignedIn(false);
      setUser(null);
      setIsLoaded(true);
      return;
    }
    const token = await getDesktopAccessToken();
    if (!token) {
      setIsSignedIn(false);
      setUser(null);
      setIsLoaded(true);
      return;
    }
    try {
      const res = await fetch(`${BACKEND}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const u = (await res.json()) as DesktopUser;
        setUser(u);
        setIsSignedIn(true);
        // Mirror useSyncUser (web): pickers/guards read the internal id from
        // localStorage and react to the 'userSynced' event.
        try {
          localStorage.setItem("userId", u.id);
          window.dispatchEvent(new Event("userSynced"));
        } catch {
          /* ignore */
        }
      } else {
        setIsSignedIn(true); // token is valid even if /me hiccups
        setUser(null);
      }
    } catch {
      setIsSignedIn(true);
      setUser(null);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const signIn = useCallback(async () => {
    await startDesktopLogin();
    await hydrate();
  }, [hydrate]);

  const signOut = useCallback(async () => {
    await clearDesktopSession();
    setIsSignedIn(false);
    setUser(null);
  }, []);

  return (
    <DesktopAuthContext.Provider
      value={{ isLoaded, isSignedIn, user, signIn, signOut, refresh: hydrate }}
    >
      {children}
    </DesktopAuthContext.Provider>
  );
}

export function useDesktopAuth(): DesktopAuthValue {
  const ctx = useContext(DesktopAuthContext);
  if (!ctx) {
    throw new Error("useDesktopAuth must be used within a DesktopAuthProvider");
  }
  return ctx;
}
