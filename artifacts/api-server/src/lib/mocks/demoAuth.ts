/**
 * Demo auth + mock Deepgram credentials (G-001).
 *
 * The real app cannot start a session without Clerk (frontend throws without a
 * publishable key) and cannot mint transcription credentials without a Deepgram
 * master key (auth.ts returns 503). In DEMO_MODE we supply both without any
 * key or network call:
 *   - a fixed demo user (no database, no Clerk),
 *   - a fake, clearly-labelled short-lived Deepgram token.
 *
 * Everything here is gated by assertDemoModeSafe(), so production fails closed.
 */
import type { NextFunction, Request, Response } from "express";
import { assertDemoModeSafe, isProduction } from "./demoMode.js";

export interface DemoUser {
  id: string;
  clerkUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  createdAt: string;
}

/** Stable demo identity. IDs are obviously fake so they cannot collide with real rows. */
export const DEMO_USER: DemoUser = {
  id: "demo-user-00000000-0000-4000-8000-000000000001",
  clerkUserId: "demo_clerk_user_harness",
  email: "demo@hireshade.local",
  firstName: "Demo",
  lastName: "Candidate",
  imageUrl: "",
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const DEMO_DEEPGRAM_TOKEN_PREFIX = "dg_demo_mock_";

export interface DemoDeepgramToken {
  key: string;
  expiresAt: string;
  ttlSeconds: number;
  mocked: true;
  provider: "mock";
}

/** A token that looks like a Deepgram key to type/length checks but is not one. */
export function createDemoDeepgramToken(opts: {
  userId?: string;
  now?: () => number;
  ttlSeconds?: number;
} = {}): DemoDeepgramToken {
  const now = opts.now ?? (() => Date.now());
  const ttlSeconds = opts.ttlSeconds ?? 7_200;
  const issuedAt = now();
  const userId = opts.userId ?? DEMO_USER.id;
  return {
    key: `${DEMO_DEEPGRAM_TOKEN_PREFIX}${userId}`,
    expiresAt: new Date(issuedAt + ttlSeconds * 1000).toISOString(),
    ttlSeconds,
    mocked: true,
    provider: "mock",
  };
}

/**
 * Express middleware that authenticates every request as the demo user when
 * (and only when) DEMO_MODE is safe. Production or non-demo deployments get a
 * 403 and never reach a handler.
 */
export function demoAuthMiddleware(
  env: NodeJS.ProcessEnv = process.env,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      assertDemoModeSafe(env);
    } catch (err) {
      res.status(403).json({
        error: "demo_mode_disabled",
        message: err instanceof Error ? err.message : String(err),
        production: isProduction(env),
      });
      return;
    }
    // The api-server global Express augmentation lives in middlewares/requireAuth.
    // Declare the shape locally so this module typechecks in any package that
    // imports it (e.g. the craft-vita demo harness).
    (req as Request & { userId?: string }).userId = DEMO_USER.id;
    next();
  };
}
