import { describe, expect, it } from "vitest";
import { buildWordTimings, createMockTtsProvider } from "./mockTts.js";

describe("buildWordTimings", () => {
  it("spaces words with the configured duration and gap", () => {
    expect(buildWordTimings("one two three", 260, 40)).toEqual([
      { word: "one", startMs: 0, endMs: 260 },
      { word: "two", startMs: 300, endMs: 560 },
      { word: "three", startMs: 600, endMs: 860 },
    ]);
  });

  it("returns no timings for blank text", () => {
    expect(buildWordTimings("   ", 260, 40)).toEqual([]);
  });
});

describe("createMockTtsProvider", () => {
  it("synthesises deterministic silence PCM sized to the word timings", async () => {
    const provider = createMockTtsProvider({ sampleRate: 16_000 });
    const result = await provider.synthesize({ text: "hello demo world" });
    expect(result.format).toBe("pcm_s16le");
    expect(result.sampleRate).toBe(16_000);
    expect(result.durationMs).toBe(860);
    expect(result.wordTimings).toHaveLength(3);
    expect(result.audio).toHaveLength(Math.round((860 / 1000) * 16_000) * 2);
    expect(result.audio.every((b) => b === 0)).toBe(true);
    expect(result.providerId).toBe("mock-tts");
    expect(provider.isConfigured()).toBe(true);
  });

  it("rejects when the request is already aborted", async () => {
    const provider = createMockTtsProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.synthesize({ text: "hello", signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
  });
});
