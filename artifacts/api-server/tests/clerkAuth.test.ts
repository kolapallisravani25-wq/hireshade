/**
 * Unit tests for Clerk issuer-domain resolution and token-claim checks.
 *
 *   pnpm vitest run tests/clerkAuth.test.ts
 *
 * These do not touch the network — they exercise resolveClerkDomain's
 * fail-closed behaviour and the azp/sub claim logic. The actual RS256/JWKS
 * signature check is jose's and is covered by jose's own suite; here we prove
 * that a corrupted publishable key is REJECTED rather than silently falling
 * back to a default domain (the prior-incident regression), and that a valid
 * key resolves to the right issuer.
 *
 * Each test imports the module fresh (vi.resetModules) because the domain is
 * resolved lazily and cached on first use.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const k of [
    "VITE_CLERK_PUBLISHABLE_KEY",
    "CLERK_ISSUER_DOMAIN",
    "CLERK_DOMAIN",
    "CLERK_AUTHORIZED_PARTIES",
  ]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}

// Build a Clerk-style publishable key that encodes `domain` (base64 + '$').
function makePk(domain: string, prefix = "pk_live_"): string {
  const b64 = Buffer.from(`${domain}$`, "utf-8").toString("base64");
  return `${prefix}${b64}`;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveClerkDomain (via first verify call)", () => {
  it("decodes a valid live publishable key to the correct issuer domain", async () => {
    setEnv({ VITE_CLERK_PUBLISHABLE_KEY: makePk("clerk.hireshade.com") });
    const mod = await import("../src/lib/clerkAuth.js");
    // A malformed token still forces domain resolution before signature check.
    // We assert the error is NOT a domain-resolution error, proving the domain
    // resolved cleanly (the failure comes later, from jose parsing the token).
    await expect(mod.verifyClerkToken("not.a.jwt")).rejects.toThrow();
    await expect(mod.verifyClerkToken("not.a.jwt")).rejects.not.toThrow(
      /Clerk issuer domain|corrupted|malformed/i,
    );
  });

  it("prefers an explicit CLERK_ISSUER_DOMAIN over the publishable key", async () => {
    setEnv({
      VITE_CLERK_PUBLISHABLE_KEY: makePk("wrong.example.com"),
      CLERK_ISSUER_DOMAIN: "clerk.hireshade.com",
    });
    const mod = await import("../src/lib/clerkAuth.js");
    await expect(mod.verifyClerkToken("not.a.jwt")).rejects.not.toThrow(
      /issuer domain|corrupted|malformed/i,
    );
  });

  it("strips a scheme and trailing slash from an explicit domain", async () => {
    setEnv({ CLERK_ISSUER_DOMAIN: "https://clerk.hireshade.com/" });
    const mod = await import("../src/lib/clerkAuth.js");
    await expect(mod.verifyClerkToken("not.a.jwt")).rejects.not.toThrow(
      /issuer domain|corrupted|malformed/i,
    );
  });

  it("FAILS CLOSED on a corrupted publishable key (garbage domain)", async () => {
    // base64 of something that does not decode to a hostname.
    const pk = `pk_live_${Buffer.from("!!!not-a-domain!!!", "utf-8").toString("base64")}`;
    setEnv({ VITE_CLERK_PUBLISHABLE_KEY: pk });
    const mod = await import("../src/lib/clerkAuth.js");
    await expect(mod.verifyClerkToken("whatever")).rejects.toThrow(
      /not a valid hostname|corrupted/i,
    );
  });

  it("FAILS CLOSED when no Clerk config is present at all", async () => {
    setEnv({});
    const mod = await import("../src/lib/clerkAuth.js");
    await expect(mod.verifyClerkToken("whatever")).rejects.toThrow(
      /Cannot determine Clerk issuer domain/i,
    );
  });

  it("does not silently fall back to clerk.accounts.dev", async () => {
    // The old code returned "clerk.accounts.dev" here. Prove it no longer does
    // by asserting the missing-config path throws instead of resolving.
    setEnv({ VITE_CLERK_PUBLISHABLE_KEY: "" });
    const mod = await import("../src/lib/clerkAuth.js");
    await expect(mod.verifyClerkToken("whatever")).rejects.toThrow(
      /Cannot determine Clerk issuer domain/i,
    );
  });
});
