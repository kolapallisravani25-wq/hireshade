import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Desktop (Tauri) authentication tokens.
 *
 * Two-token model that sidesteps Clerk-in-webview entirely:
 *  - REFRESH token: a long-lived opaque random string. Only its SHA-256 hash is
 *    stored (in desktop_sessions); the plaintext is returned once at link time
 *    and kept by the app in the OS keychain. Exchanged for access tokens.
 *  - ACCESS token: a short-lived HS256 JWT (sub = clerkUserId, typ =
 *    "desktop_access") signed with DESKTOP_TOKEN_SECRET. Sent as the Bearer
 *    token on API calls; requireAuth verifies it just like a Clerk token.
 *
 * DESKTOP_TOKEN_SECRET must be set in the API environment. If it's missing,
 * verifyDesktopAccessToken fails closed (returns null) so Clerk auth is
 * unaffected, and the /link and /token endpoints return a clear error.
 */

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_DAYS = 60;

export const DESKTOP_ACCESS_TTL_SECONDS = ACCESS_TTL_SECONDS;

function getSecret(): Uint8Array {
  const s = process.env["DESKTOP_TOKEN_SECRET"]?.trim();
  if (!s || s.length < 16) {
    throw new Error(
      "DESKTOP_TOKEN_SECRET is not set (needs >= 16 chars). Desktop auth is disabled until it is configured.",
    );
  }
  return new TextEncoder().encode(s);
}

/** True when DESKTOP_TOKEN_SECRET is configured (used to gate /link, /token). */
export function isDesktopAuthConfigured(): boolean {
  const s = process.env["DESKTOP_TOKEN_SECRET"]?.trim();
  return Boolean(s && s.length >= 16);
}

/** A new opaque refresh token (returned to the app once, never stored raw). */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a refresh token — what we persist and look up by. */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Expiry Date for a newly minted refresh token. */
export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Sign a short-lived desktop access token for a Clerk user. */
export async function signDesktopAccessToken(
  clerkUserId: string,
): Promise<string> {
  return await new SignJWT({ typ: "desktop_access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(clerkUserId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verify a bearer token AS a desktop access token. Returns { sub } on success,
 * or null for anything that isn't a valid desktop access token — including
 * Clerk RS256 tokens (alg mismatch) and the case where the secret isn't set —
 * so the caller can safely fall through to Clerk verification.
 */
export async function verifyDesktopAccessToken(
  token: string,
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (payload["typ"] !== "desktop_access") return null;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
