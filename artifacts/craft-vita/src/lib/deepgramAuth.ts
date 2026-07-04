import { getAuthHeaders } from "@/lib/globalAuth";

/**
 * Runtime Deepgram credential resolution.
 *
 * The ONLY source is a short-lived, per-user key minted by the backend
 * (`POST /api/auth/deepgram-token`). The long-lived master key is never read
 * in web code and therefore never baked into the shipped JS bundle — an
 * earlier build-time `VITE_DEEPGRAM_API_KEY` fallback did exactly that
 * (Vite inlines import.meta.env at build), leaking the master key into
 * dist/public/assets/*.js served by nginx. It has been removed.
 *
 * (The desktop app's Rust STT transport has its own key handling via
 * option_env! in src-tauri — that path is compiled into the binary and is
 * entirely separate from this web resolver.)
 *
 * The minted key is a normal Deepgram key, so it works everywhere the old key
 * did: browser WebSocket ["token", key] subprotocol and the Rust
 * `Authorization: Token <key>` header alike.
 */

interface MintedKey {
  key: string;
  /** epoch ms */
  expiresAt: number;
}

let cached: MintedKey | null = null;
let inflight: Promise<string | null> | null = null;

const REFRESH_MARGIN_MS = 5 * 60_000;

async function mintFromServer(): Promise<string | null> {
  const base = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/auth/deepgram-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    });
    if (!res.ok) {
      // 503 = server not configured for minting — expected in some envs.
      if (res.status !== 503) {
        console.warn("[deepgramAuth] mint failed", res.status);
      }
      return null;
    }
    const data = (await res.json()) as { key?: string; expiresAt?: string };
    if (!data.key) return null;
    cached = {
      key: data.key,
      expiresAt: data.expiresAt
        ? new Date(data.expiresAt).getTime()
        : Date.now() + 60 * 60_000,
    };
    return cached.key;
  } catch (err) {
    console.warn("[deepgramAuth] mint request errored", err);
    return null;
  }
}

/**
 * Resolve the Deepgram key to use for a NEW transcription connection.
 * Never throws — returns "" when the server can't mint one, so callers keep
 * their existing "missing key" error paths (which surface a clear
 * "check server Deepgram configuration" message).
 *
 * @param fallback optional caller-provided key. In web builds this is empty;
 *                 it exists only so non-web callers (or tests) can supply one.
 *                 It is NOT sourced from the bundle env anymore.
 */
export async function resolveDeepgramKey(fallback?: string): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return cached.key;
  }
  // Collapse concurrent callers (mic + system audio starting together) into
  // a single mint request.
  if (!inflight) {
    inflight = mintFromServer().finally(() => {
      inflight = null;
    });
  }
  const minted = await inflight;
  if (minted) return minted;
  return (fallback ?? "").trim();
}

/** Drop the cached minted key (e.g. after a 1008 auth failure) so the next
 * connection attempt mints a fresh one instead of retrying a dead credential. */
export function invalidateDeepgramKey(): void {
  cached = null;
}
