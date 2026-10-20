import { describe, expect, it } from "vitest";
import request from "supertest";
import { createDemoApp } from "./demoServer.js";
import { TARGET_SSE_HEADERS } from "./targetContracts.js";

const DEMO_ENV = { DEMO_MODE: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv;
const PROD_ENV = { DEMO_MODE: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv;

const fastStream =
  (answer: string) =>
  async ({ onDelta }: { onDelta: (delta: string) => void }) => {
    for (const chunk of answer.match(/\s*\S+/g) ?? []) onDelta(chunk);
    return answer;
  };

describe("POST /api/chat (target SSE transport)", () => {
  it("streams the answer with the target SSE headers and DONE sentinel", async () => {
    const app = createDemoApp({
      env: DEMO_ENV,
      streamAnswer: fastStream("Redis rate limiter answer"),
    });
    const res = await request(app).post("/api/chat").send({ model: "gpt-5", messages: [] });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe(TARGET_SSE_HEADERS["Cache-Control"]);
    expect(res.headers["x-accel-buffering"]).toBe(TARGET_SSE_HEADERS["X-Accel-Buffering"]);
    expect(res.text).toContain('"type":"start"');
    expect(res.text).toContain('"type":"delta"');
    expect(res.text).toContain('"type":"done"');
    expect(res.text).toContain("data: [DONE]");

    // Reassemble the SSE deltas exactly as the overlay would.
    const deltas = res.text
      .split("\n\n")
      .filter((block) => block.startsWith("data: {"))
      .map((block) => JSON.parse(block.slice("data: ".length)) as { type: string; text?: string })
      .filter((event) => event.type === "delta")
      .map((event) => event.text ?? "");
    expect(deltas.join("")).toBe("Redis rate limiter answer");
    expect(res.text).toContain('"firstToken":true');
  });

  it("fails closed in production before any SSE bytes are written", async () => {
    const app = createDemoApp({ env: PROD_ENV, streamAnswer: fastStream("no") });
    const res = await request(app).post("/api/chat").send({ model: "gpt-5" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("demo_mode_disabled");
  });

  it("fails closed when DEMO_MODE is unset", async () => {
    const app = createDemoApp({ env: { NODE_ENV: "development" }, streamAnswer: fastStream("no") });
    const res = await request(app).post("/api/chat").send({});
    expect(res.status).toBe(403);
  });
});
