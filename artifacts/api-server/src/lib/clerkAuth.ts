import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const PUBLISHABLE_KEY = process.env["VITE_CLERK_PUBLISHABLE_KEY"] ?? "";

function getClerkDomain(): string {
  if (PUBLISHABLE_KEY.startsWith("pk_live_") || PUBLISHABLE_KEY.startsWith("pk_test_")) {
    const base64Part = PUBLISHABLE_KEY.split("_")[2];
    if (base64Part) {
      try {
        const decoded = Buffer.from(base64Part, "base64").toString("utf-8");
        return decoded.replace(/\$$/, "");
      } catch {
        // fallback
      }
    }
  }
  return "clerk.accounts.dev";
}

const clerkDomain = getClerkDomain();
const JWKS_URL = `https://${clerkDomain}/.well-known/jwks.json`;

const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export interface ClerkTokenPayload extends JWTPayload {
  sub: string;
  email?: string;
  email_address?: string;
  first_name?: string;
  last_name?: string;
  image_url?: string;
}

export async function verifyClerkToken(token: string): Promise<ClerkTokenPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://${clerkDomain}`,
  });
  return payload as ClerkTokenPayload;
}
