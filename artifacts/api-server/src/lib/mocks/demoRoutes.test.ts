import { describe, expect, it } from "vitest";
import request from "supertest";
import { createDemoApp, startDemoServer } from "./demoServer.js";
import { DEMO_DEEPGRAM_TOKEN_PREFIX, DEMO_USER } from "./demoAuth.js";

const DEMO_ENV = { DEMO_MODE: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv;
const PROD_ENV = { DEMO_MODE: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("demo routes", () => {
  it("serves the demo user without Clerk or a database", async () => {
    const app = createDemoApp({ env: DEMO_ENV });
    const res = await request(app)
      .get("/auth/me")
      .set("authorization", "Bearer demo-token");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: DEMO_USER.id, email: DEMO_USER.email, demo: true });
  });

  it("mints a mocked Deepgram token without any Deepgram key", async () => {
    const app = createDemoApp({ env: DEMO_ENV, now: () => 1_000, ttlSeconds: 100 });
    const res = await request(app)
      .post("/auth/deepgram-token")
      .set("authorization", "Bearer demo-token");
    expect(res.status).toBe(200);
    expect(res.body.mocked).toBe(true);
    expect(res.body.provider).toBe("mock");
    expect(res.body.key.startsWith(DEMO_DEEPGRAM_TOKEN_PREFIX)).toBe(true);
    expect(res.body.key).toContain(DEMO_USER.id);
    expect(res.body.expiresAt).toBe(new Date(1_000 + 100_000).toISOString());
  });

  it("reports demo provider status", async () => {
    const app = createDemoApp({ env: DEMO_ENV });
    const res = await request(app).get("/demo/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ keysRequired: false });
    expect(res.body.demoMode.mode).toBe("mock");
    expect(res.body.providers.llm).toBe("mock-llm");
  });

  it("fails closed in production even with DEMO_MODE=1", async () => {
    const app = createDemoApp({ env: PROD_ENV });
    for (const path of ["/auth/me", "/demo/status"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("demo_mode_disabled");
      expect(res.body.production).toBe(true);
    }
    const token = await request(app).post("/auth/deepgram-token");
    expect(token.status).toBe(403);
    expect(token.body.key).toBeUndefined();
  });

  it("fails closed when DEMO_MODE is not set", async () => {
    const app = createDemoApp({ env: { NODE_ENV: "development" } });
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("demo_mode_disabled");
  });

  it("starts a real HTTP demo server for live probes", async () => {
    const server = await startDemoServer({ env: DEMO_ENV });
    try {
      const health = await fetch(`${server.url}/health`).then((r) => r.json());
      expect(health).toMatchObject({ ok: true, demo: true });
      const token = await fetch(`${server.url}/auth/deepgram-token`, { method: "POST" }).then(
        (r) => r.json() as Promise<{ mocked: boolean; key: string }>,
      );
      expect(token.mocked).toBe(true);
      expect(token.key.startsWith(DEMO_DEEPGRAM_TOKEN_PREFIX)).toBe(true);
    } finally {
      await server.close();
    }
  });
});
