import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { JWTVerifyGetKey } from "jose";

/**
 * Clerk JWT verification — the trust boundary every authenticated route
 * depends on (req.userId is derived from the `sub` claim this returns).
 *
 * Design notes:
 * - Fail CLOSED, but DEFERRED. If the Clerk issuer domain can't be resolved we
 *   do NOT throw at module load (that would prevent the whole API from
 *   booting on a single bad env var). Instead resolution happens lazily on the
 *   first verification and, if it fails, every verify call rejects — so auth
 *   fails closed (401) with a clear logged reason rather than silently
 *   validating against a wrong/default JWKS. A prior incident traced live-auth
 *   failures to a corrupted publishable key encoding a misspelled domain; the
 *   old code fell back to `clerk.accounts.dev` and masked it.
 * - Pin algorithms to RS256 (Clerk's signing alg). jose already blocks alg
 *   confusion by matching the token alg to an asymmetric JWKS key, but pinning
 *   makes the intent explicit and rejects anything unexpected early.
 * - Allow a small clock tolerance so minor VPS/Clerk skew doesn't 401 valid
 *   tokens (Clerk access tokens are short-lived, so skew matters).
 * - Optionally enforce `azp` (authorized party) against a configured allowlist
 *   so a token minted for a different app on the same Clerk instance can't be
 *   replayed here. Off unless CLERK_AUTHORIZED_PARTIES is set.
 */

const CLOCK_TOLERANCE_SECONDS = 10;

/** Resolve the Clerk issuer domain, or throw with an actionable message. */
function resolveClerkDomain(): string {
  const explicit =
    process.env["CLERK_ISSUER_DOMAIN"] ?? process.env["CLERK_DOMAIN"];
  if (explicit && explicit.trim()) {
    return explicit.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  const pk = process.env["VITE_CLERK_PUBLISHABLE_KEY"] ?? "";
  if (pk.startsWith("pk_live_") || pk.startsWith("pk_test_")) {
    const base64Part = pk.split("_")[2];
    if (base64Part) {
      let decoded: string;
      try {
        decoded = Buffer.from(base64Part, "base64").toString("utf-8");
      } catch {
        throw new Error(
          "VITE_CLERK_PUBLISHABLE_KEY is malformed: domain segment is not valid base64. Set CLERK_ISSUER_DOMAIN explicitly.",
        );
      }
      const domain = decoded.replace(/\$+$/, "").trim();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        return domain;
      }
      throw new Error(
        `Decoded Clerk domain "${domain}" is not a valid hostname; the publishable key is likely corrupted. Set CLERK_ISSUER_DOMAIN explicitly.`,
      );
    }
  }

  throw new Error(
    "Cannot determine Clerk issuer domain. Set VITE_CLERK_PUBLISHABLE_KEY (pk_live_/pk_test_) or CLERK_ISSUER_DOMAIN.",
  );
}

/** Lazily-initialised verification context, built once on first use. */
let context: { issuer: string; jwks: JWTVerifyGetKey } | null = null;

function getContext(): { issuer: string; jwks: JWTVerifyGetKey } {
  if (context) return context;
  const domain = resolveClerkDomain(); // throws with an actionable message
  const issuer = `https://${domain}`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  context = { issuer, jwks };
  return context;
}

const AUTHORIZED_PARTIES: string[] = (
  process.env["CLERK_AUTHORIZED_PARTIES"] ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export interface ClerkTokenPayload extends JWTPayload {
  sub: string;
  azp?: string;
  email?: string;
  email_address?: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
}

export async function verifyClerkToken(token: string): Promise<ClerkTokenPayload> {
  const { issuer, jwks } = getContext();

  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    algorithms: ["RS256"],
    clockTolerance: CLOCK_TOLERANCE_SECONDS,
  });

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Token has no subject (sub) claim");
  }

  if (AUTHORIZED_PARTIES.length > 0) {
    const azp = payload["azp"];
    if (typeof azp === "string" && azp && !AUTHORIZED_PARTIES.includes(azp)) {
      throw new Error("Token authorized party (azp) is not allowed");
    }
  }

  return payload as ClerkTokenPayload;
}
