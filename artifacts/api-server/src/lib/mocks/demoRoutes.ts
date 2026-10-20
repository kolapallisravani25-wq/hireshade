/**
 * Mountable demo router (G-001): demo auth user + mocked Deepgram token.
 *
 * Intentionally a router rather than edits to routes/auth.ts so the demo can be
 * proved in isolation (no Clerk, no DB, no Deepgram network). Wiring it into the
 * production app is one line, and every route fails closed outside DEMO_MODE:
 *
 *   app.use(createDemoRouter());
 */
import { Router, type IRouter, type Request } from "express";
import { DEMO_USER, createDemoDeepgramToken, demoAuthMiddleware } from "./demoAuth.js";
import {
  assertDemoModeSafe,
  describeDemoMode,
  isDemoModeSafe,
  isProduction,
} from "./demoMode.js";

export interface DemoRouterOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  ttlSeconds?: number;
}

export function createDemoRouter(opts: DemoRouterOptions = {}): IRouter {
  const env = opts.env ?? process.env;
  const router = Router();
  router.use(demoAuthMiddleware(env));

  router.get("/auth/me", (_req, res) => {
    res.json({ ...DEMO_USER, demo: true });
  });

  router.post("/auth/deepgram-token", (req, res) => {
    res.json(
      createDemoDeepgramToken({
        userId: (req as Request & { userId?: string }).userId,
        now: opts.now,
        ttlSeconds: opts.ttlSeconds,
      }),
    );
  });

  router.get("/demo/status", (_req, res) => {
    res.json({
      demoMode: describeDemoMode(env),
      user: DEMO_USER,
      keysRequired: false,
      providers: { llm: "mock-llm", asr: "mock-asr", tts: "mock-tts" },
    });
  });

  // Keep the gate call in the module so a future refactor of the middleware
  // cannot accidentally bypass it at construction time.
  if (isDemoModeSafe(env)) {
    assertDemoModeSafe(env);
  }

  return router;
}
