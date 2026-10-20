import { describe, expect, it } from "vitest";
import {
  DEMO_LLM_ANSWER,
  createMockLlmProvider,
  splitAnswerIntoChunks,
} from "./mockLlm.js";

const noopSleep = async () => {};

describe("splitAnswerIntoChunks", () => {
  it("preserves the exact answer text when concatenated", () => {
    const answer = "one two  three\n- four five six seven";
    const chunks = splitAnswerIntoChunks(answer, 3);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(answer);
  });

  it("returns an empty list for an empty answer", () => {
    expect(splitAnswerIntoChunks("")).toEqual([]);
  });
});

describe("createMockLlmProvider", () => {
  it("emits a structured answer in chunks with a configurable first-token delay", async () => {
    const waits: number[] = [];
    const deltas: string[] = [];
    const provider = createMockLlmProvider({
      answer: "alpha beta gamma delta epsilon",
      wordsPerChunk: 2,
      firstTokenDelayMs: 620,
      chunkDelayMs: 45,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const full = await provider.stream(
      { messages: [{ role: "user", content: "q" }] },
      (d) => deltas.push(d),
    );
    expect(waits[0]).toBe(620);
    expect(waits.slice(1).every((w) => w === 45)).toBe(true);
    expect(deltas).toHaveLength(3);
    expect(deltas.join("")).toBe("alpha beta gamma delta epsilon");
    expect(full).toBe("alpha beta gamma delta epsilon");
  });

  it("uses the default structured demo answer", async () => {
    const provider = createMockLlmProvider({ sleep: noopSleep });
    const text = await provider.stream({ messages: [] }, () => {});
    expect(text).toBe(DEMO_LLM_ANSWER);
    expect(text).toContain("**Redis-backed rate limiter**");
    expect(text).toContain("- **Trade-off:**");
  });

  it("honours answerFor and passes the request through", async () => {
    const provider = createMockLlmProvider({
      sleep: noopSleep,
      answerFor: (req) => `answer to: ${req.messages.at(-1)?.content ?? ""}`,
    });
    const text = await provider.stream(
      { messages: [{ role: "user", content: "why redis" }] },
      () => {},
    );
    expect(text).toBe("answer to: why redis");
    expect(provider.lastRequest?.messages).toHaveLength(1);
    expect(provider.streamCalls).toBe(1);
  });

  it("aborts before the first token when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createMockLlmProvider({ sleep: noopSleep });
    await expect(
      provider.stream({ messages: [], signal: controller.signal }, () => {}),
    ).rejects.toThrow(/abort/i);
  });

  it("propagates configured failures (failover tests) and mid-stream crashes", async () => {
    const failing = createMockLlmProvider({ sleep: noopSleep, failWith: new Error("boom") });
    await expect(failing.stream({ messages: [] }, () => {})).rejects.toThrow("boom");

    const midStream = createMockLlmProvider({
      sleep: noopSleep,
      answer: "one two three four five six",
      wordsPerChunk: 1,
      failAfterDeltas: 2,
    });
    const seen: string[] = [];
    await expect(
      midStream.stream({ messages: [] }, (d) => seen.push(d)),
    ).rejects.toThrow(/mid-stream/);
    expect(seen).toHaveLength(2);
  });

  it("is always configured (no key required)", () => {
    const provider = createMockLlmProvider({ sleep: noopSleep });
    expect(provider.isConfigured()).toBe(true);
    expect(provider.kind).toBe("mock");
  });
});
