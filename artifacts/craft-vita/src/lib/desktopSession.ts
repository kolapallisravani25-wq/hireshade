import { openUrl } from "@tauri-apps/plugin-opener";
import { start, cancel } from "@fabianlars/tauri-plugin-oauth";

/**
 * Desktop session (external-browser auth, C1 part 3).
 *
 * The app never runs Clerk in the webview. Instead:
 *  1. `startDesktopLogin()` opens a loopback server + the system browser to the
 *     web /desktop-auth page. The user signs in there (production Clerk), which
 *     hands back an opaque REFRESH token via the loopback callback.
 *  2. We persist that refresh token in localStorage — which, unlike Clerk's
 *     third-party cookies, DOES survive restarts on the app's own origin.
 *  3. `getDesktopAccessToken()` exchanges the refresh token for a short-lived
 *     access token (cached in memory) via POST /api/desktop/token, refreshing
 *     when it's near expiry. That access token is what all API calls send.
 */

const REFRESH_KEY = "hireshade_desktop_refresh";
const BACKEND = import.meta.env.VITE_BACKEND_URL as string;

let accessToken: string | null = null;
let accessTokenExpiresAt = 0; // epoch ms
let inFlight: Promise<string | null> | null = null;

// ── refresh token persistence ────────────────────────────────────────────────
export function getStoredRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function storeRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* ignore */
  }
}

export function hasDesktopSession(): boolean {
  return Boolean(getStoredRefreshToken());
}

// ── access token exchange ────────────────────────────────────────────────────
/**
 * Return a valid desktop access token, refreshing via the backend when needed.
 * Returns null if there's no refresh token or the exchange fails (caller should
 * then treat the user as signed out).
 */
export async function getDesktopAccessToken(): Promise<string | null> {
  // Still valid for >30s? use the cached one.
  if (accessToken && Date.now() < accessTokenExpiresAt - 30_000) {
    return accessToken;
  }
  if (inFlight) return inFlight;

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  inFlight = (async () => {
    try {
      const res = await fetch(`${BACKEND}/api/desktop/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        // 401 => refresh token invalid/expired/revoked: drop it so the app
        // routes the user back to login.
        if (res.status === 401) clearDesktopSession();
        return null;
      }
      const data = (await res.json()) as {
        accessToken?: string;
        expiresInSeconds?: number;
      };
      if (!data.accessToken) return null;
      accessToken = data.accessToken;
      accessTokenExpiresAt =
        Date.now() + (data.expiresInSeconds ?? 15 * 60) * 1000;
      return accessToken;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// ── login (browser + loopback handoff) ───────────────────────────────────────
const LOGIN_PORTS = [10001, 10002, 10003, 10004];

/**
 * Open the system browser to the web handoff page and wait for the refresh token
 * to come back over the loopback. Resolves once the token is stored, or throws on
 * timeout/error/cancel.
 */
export async function startDesktopLogin(): Promise<void> {
  let port: number | undefined;
  try {
    port = await start({ ports: LOGIN_PORTS });

    const tokenPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Sign-in timed out. Please try again.")),
        5 * 60 * 1000,
      );

      // tauri-plugin-oauth emits the full callback URL on this event.
      import("@tauri-apps/api/event")
        .then(({ once }) =>
          once<string>("oauth://url", (event) => {
            clearTimeout(timeout);
            try {
              const url = new URL(event.payload);
              const refresh = url.searchParams.get("desktop_refresh");
              if (refresh) resolve(refresh);
              else reject(new Error("No token returned from sign-in."));
            } catch {
              reject(new Error("Malformed sign-in callback."));
            }
          }),
        )
        .catch(reject);
    });

    const appBase =
      (import.meta.env.VITE_APP_WEB_URL as string | undefined) ||
      "https://hireshade.com";
    await openUrl(`${appBase}/desktop-auth?port=${port}`);

    const refreshToken = await tokenPromise;
    storeRefreshToken(refreshToken);
    // Warm an access token immediately so the app is usable right away.
    await getDesktopAccessToken();
  } finally {
    if (port !== undefined) await cancel(port).catch(() => undefined);
  }
}

// ── logout ───────────────────────────────────────────────────────────────────
export async function clearDesktopSession(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  accessToken = null;
  accessTokenExpiresAt = 0;
  try {
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  if (refreshToken) {
    try {
      await fetch(`${BACKEND}/api/desktop/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      /* best effort */
    }
  }
}
