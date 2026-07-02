import { getAuthHeaders } from "@/lib/globalAuth";

/**
 * Runtime Deepgram credential resolution.
 *
 * Order of preference:
 *  1. A short-lived key minted by the backend (`POST /api/auth/deepgram-token`).
 *     This makes transcription work regardless of whether VITE_DEEPGRAM_API_KEY
 *     was baked into the bundle at build time, and keeps the long-lived master
 *     key out of the shipped JS entirely.
 *  2. The build-time VITE_DEEPGRAM_API_KEY (legacy fallback, e.g. local dev
 *     with no backend configured).
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

function buildTimeFallback(): string {
  return (import.meta.env.VITE_DEEPGRAM_API_KEY as string | undefined) || "";
}

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
 * Never throws — returns "" when no credential is available anywhere, so
 * callers keep their existing "missing key" error paths.
 *
 * @param fallback caller-provided key (usually the legacy prop / env value);
 *                 used when the server can't mint one.
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
  return (fallback ?? "").trim() || buildTimeFallback();
}

/** Drop the cached minted key (e.g. after a 1008 auth failure) so the next
 * connection attempt mints a fresh one instead of retrying a dead credential. */
export function invalidateDeepgramKey(): void {
  cached = null;
}
