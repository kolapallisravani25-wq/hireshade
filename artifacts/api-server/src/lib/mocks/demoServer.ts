/**
 * Standalone demo API app (G-001).
 *
 * A tiny Express app that serves the demo auth user + mocked Deepgram token with
 * zero keys, zero database and zero Clerk. Used by the demo harness to prove the
 * auth surface live over HTTP (the real app still mounts routes through
 * routes/index.ts).
 */
import express, { type Express } from "express";
import { createDemoRouter, type DemoRouterOptions } from "./demoRoutes.js";
import { createDemoChatRouter } from "./demoChat.js";
import { describeDemoMode } from "./demoMode.js";

export interface DemoAppOptions extends DemoRouterOptions {
  /** Extra express configuration used by tests. */
  enableCors?: boolean;
  /** Inject the answer stream used by POST /api/chat (tests need it fast). */
  streamAnswer?: import("./demoChat.js").DemoSseStreamOptions["streamAnswer"];
}

export function createDemoApp(opts: DemoAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  if (opts.enableCors) {
    app.use((_req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });
  }
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      demo: describeDemoMode(opts.env ?? process.env).safe,
      nodeEnv: (opts.env ?? process.env)["NODE_ENV"] ?? null,
    });
  });
  // T-10 target transport: POST /api/chat (SSE). Mounted before the demo
  // router so its fail-closed catch-all never swallows it.
  app.use(createDemoChatRouter({ env: opts.env, streamAnswer: opts.streamAnswer }));
  app.use(createDemoRouter(opts));
  return app;
}

export interface RunningDemoServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Starts the demo app on an ephemeral (or requested) port. */
export async function startDemoServer(
  opts: DemoAppOptions & { port?: number; host?: string } = {},
): Promise<RunningDemoServer> {
  const app = createDemoApp(opts);
  const host = opts.host ?? "127.0.0.1";
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const s = app.listen(opts.port ?? 0, host, () => resolve(s));
    s.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("demo server: could not resolve listening port");
  }
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
