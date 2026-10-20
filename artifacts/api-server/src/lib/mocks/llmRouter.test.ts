import { describe, expect, it } from "vitest";
import { createLlmRouter } from "./llmRouter.js";
import { createMockLlmProvider } from "./mockLlm.js";
import type { LlmProvider, LlmStreamRequest } from "./types.js";

const noopSleep = async () => {};

function unconfigured(provider: LlmProvider): LlmProvider {
  return { ...provider, isConfigured: () => false };
}

/** Provider that never settles until its signal aborts (timeout tests). */
function hangingProvider(id: string): LlmProvider {
  return {
    id,
    kind: "mock",
    isConfigured: () => true,
    stream(req: LlmStreamRequest): Promise<string> {
      return new Promise((_resolve, reject) => {
        req.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    },
  };
}

describe("createLlmRouter", () => {
  it("fails over to the next provider before the first token", async () => {
    const deltas: string[] = [];
    const router = createLlmRouter({
      providers: [
        createMockLlmProvider({ id: "bad", sleep: noopSleep, failWith: new Error("upstream 500") }),
        createMockLlmProvider({ id: "good", sleep: noopSleep, answer: "recovered answer" }),
      ],
      clock: () => 0,
    });
    const result = await router.stream({ messages: [] }, (d) => deltas.push(d));
    expect(result.providerId).toBe("good");
    expect(result.text).toBe("recovered answer");
    expect(result.failovers).toBe(1);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ providerId: "bad", ok: false, emitted: false });
    expect(result.attempts[0]!.error).toContain("upstream 500");
    expect(deltas.join("")).toBe("recovered answer");
  });

  it("skips unconfigured providers instead of treating them as a fallback", async () => {
    const bad = unconfigured(createMockLlmProvider({ id: "no-key", sleep: noopSleep, failWith: new Error("should not run") }));
    const router = createLlmRouter({
      providers: [bad, createMockLlmProvider({ id: "good", sleep: noopSleep, answer: "ok" })],
    });
    const result = await router.stream({ messages: [] }, () => {});
    expect(result.providerId).toBe("good");
    expect(result.attempts.map((a) => a.providerId)).toEqual(["good"]);
  });

  it("times out a hanging provider and fails over", async () => {
    const router = createLlmRouter({
      providers: [hangingProvider("slow"), createMockLlmProvider({ id: "fast", sleep: noopSleep, answer: "fast answer" })],
      timeoutMs: 25,
    });
    const result = await router.stream({ messages: [] }, () => {});
    expect(result.providerId).toBe("fast");
    expect(result.attempts[0]).toMatchObject({ providerId: "slow", ok: false });
    expect(result.attempts[0]!.error).toMatch(/timeout/);
  });

  it("refuses to fail over after tokens were already emitted", async () => {
    const crasher: LlmProvider = {
      id: "crasher",
      kind: "mock",
      isConfigured: () => true,
      async stream(_req, onDelta) {
        onDelta("partial ");
        throw new Error("socket closed");
      },
    };
    const router = createLlmRouter({
      providers: [crasher, createMockLlmProvider({ id: "good", sleep: noopSleep, answer: "never used" })],
    });
    await expect(router.stream({ messages: [] }, () => {})).rejects.toThrow(/mid-answer/);
  });

  it("throws a keyless-demo hint when no provider is configured", async () => {
    const router = createLlmRouter({ providers: [unconfigured(hangingProvider("none"))] });
    await expect(router.stream({ messages: [] }, () => {})).rejects.toThrow(/DEMO_MODE/);
  });

  it("reports first-token latency from router entry", async () => {
    let now = 100;
    const router = createLlmRouter({
      providers: [
        createMockLlmProvider({
          answer: "one two three four",
          sleep: async () => {
            now += 120;
          },
        }),
      ],
      clock: () => now,
    });
    const result = await router.stream({ messages: [] }, () => {});
    expect(result.firstTokenLatencyMs).toBe(120);
  });
});
