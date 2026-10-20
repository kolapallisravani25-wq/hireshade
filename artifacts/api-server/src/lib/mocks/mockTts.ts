/**
 * Mock TTS adapter (G-001).
 *
 * No real TTS backend exists in this repo, so the demo uses this adapter. It
 * returns deterministic silence PCM plus word timings (enough for an overlay
 * captions/voice-sync surface) and never touches a provider key.
 */
import type { TtsProvider, TtsRequest, TtsResult, TtsWordTiming } from "./types.js";

export interface MockTtsProviderOptions {
  id?: string;
  sampleRate?: number;
  /** Per-word duration used for word timings (default 260 ms). */
  wordDurationMs?: number;
  /** Gap between words (default 40 ms). */
  wordGapMs?: number;
}

export function buildWordTimings(
  text: string,
  wordDurationMs: number,
  wordGapMs: number,
): TtsWordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const timings: TtsWordTiming[] = [];
  let cursor = 0;
  for (const word of words) {
    timings.push({ word, startMs: cursor, endMs: cursor + wordDurationMs });
    cursor += wordDurationMs + wordGapMs;
  }
  return timings;
}

export function createMockTtsProvider(opts: MockTtsProviderOptions = {}): TtsProvider {
  const sampleRate = opts.sampleRate ?? 16_000;
  const wordDurationMs = opts.wordDurationMs ?? 260;
  const wordGapMs = opts.wordGapMs ?? 40;

  return {
    id: opts.id ?? "mock-tts",
    kind: "mock",
    isConfigured: () => true,
    async synthesize(req: TtsRequest): Promise<TtsResult> {
      if (req.signal?.aborted) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      const rate = req.sampleRate ?? sampleRate;
      const wordTimings = buildWordTimings(req.text, wordDurationMs, wordGapMs);
      const durationMs =
        wordTimings.length > 0
          ? wordTimings[wordTimings.length - 1]!.endMs
          : 0;
      const sampleCount = Math.round((durationMs / 1000) * rate);
      // Deterministic silent PCM (16-bit mono little-endian = zeros).
      const audio = new Uint8Array(sampleCount * 2);
      return {
        audio,
        format: "pcm_s16le",
        sampleRate: rate,
        durationMs,
        wordTimings,
        providerId: "mock-tts",
      };
    },
  };
}
