import { describe, expect, it } from "vitest";
import { createMockAsrProvider } from "./mockAsr.js";
import type { AsrEvent, TranscriptUtterance } from "./types.js";

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 160; // 10 ms

const UTTERANCE: TranscriptUtterance = {
  id: "u1",
  startMs: 600,
  endMs: 1_600,
  text: "Can you explain how you would design a rate limiter using Redis?",
  partials: [
    { atMs: 250, text: "Can you explain how" },
    { atMs: 500, text: "Can you explain how you would design" },
  ],
};

/**
 * Pushes 10 ms of audio at a time. The fake wall clock advances 10 ms per push
 * so event wall times are deterministic (and equal the media time at the end of
 * the chunk that crosses the scheduled event).
 */
function replay(stream: ReturnType<ReturnType<typeof createMockAsrProvider>["openStream"]>, chunks: number, clock: { wall: number }) {
  const events: AsrEvent[] = [];
  for (let i = 0; i < chunks; i++) {
    const chunk = new Int16Array(FRAME_SAMPLES);
    clock.wall += 10;
    events.push(...stream.pushAudio(chunk));
  }
  return events;
}

describe("createMockAsrProvider", () => {
  it("emits partials while speaking and a final one silence window after speech", () => {
    const clock = { wall: 0 };
    const provider = createMockAsrProvider({ clock: () => clock.wall });
    const stream = provider.openStream({
      sampleRate: SAMPLE_RATE,
      script: [UTTERANCE],
      endpointSilenceMs: 700,
    });
    const events = replay(stream, 250, clock); // 2.5 s of audio
    // atMs equals the fake wall clock when the crossing chunk was pushed; the
    // 10 ms chunking means it lands exactly on the scheduled media boundary here.
    expect(events.map((e) => ({ type: e.type, mediaMs: e.mediaMs, atMs: e.atMs }))).toEqual([
      { type: "partial", mediaMs: 850, atMs: 850 },
      { type: "partial", mediaMs: 1_100, atMs: 1_100 },
      { type: "final", mediaMs: 2_300, atMs: 2_300 },
    ]);
    expect(events[0]!.text).toBe("Can you explain how");
    expect(events[2]!.text).toBe(UTTERANCE.text);
    expect(events[2]!.isFinal).toBe(true);
  });

  it("does not emit the final before the endpoint silence has elapsed", () => {
    const clock = { wall: 0 };
    const provider = createMockAsrProvider({ clock: () => clock.wall });
    const stream = provider.openStream({
      sampleRate: SAMPLE_RATE,
      script: [UTTERANCE],
      endpointSilenceMs: 700,
    });
    // Push 2.0 s: speech ended at 1.6 s but 700 ms of silence only completes at 2.3 s.
    const events = replay(stream, 200, clock);
    expect(events.some((e) => e.isFinal)).toBe(false);
    expect(events).toHaveLength(2);

    const flushed = stream.endAudio();
    expect(flushed.some((e) => e.isFinal)).toBe(true);
  });

  it("flushes pending finals on endAudio and ignores later audio", () => {
    const clock = { wall: 0 };
    const provider = createMockAsrProvider({ clock: () => clock.wall });
    const stream = provider.openStream({ sampleRate: SAMPLE_RATE, script: [UTTERANCE] });
    replay(stream, 50, clock);
    const flushed = stream.endAudio();
    expect(flushed.map((e) => e.type)).toEqual(["partial", "partial", "final"]);
    expect(stream.pushAudio(new Int16Array(FRAME_SAMPLES))).toEqual([]);
  });

  it("derives a default first partial when the fixture has none", () => {
    const clock = { wall: 0 };
    const provider = createMockAsrProvider({ clock: () => clock.wall, firstPartialDelayMs: 250 });
    const stream = provider.openStream({
      sampleRate: SAMPLE_RATE,
      script: [{ ...UTTERANCE, partials: undefined, text: "one two three four" }],
    });
    const events = replay(stream, 250, clock);
    const partial = events.find((e) => e.type === "partial")!;
    expect(partial.text).toBe("one two");
    expect(partial.mediaMs).toBe(850);
  });

  it("keeps multiple utterances ordered by media time and notifies onEvent", () => {
    const clock = { wall: 0 };
    const seen: AsrEvent[] = [];
    const provider = createMockAsrProvider({ clock: () => clock.wall });
    const stream = provider.openStream({
      sampleRate: SAMPLE_RATE,
      script: [
        { id: "a", startMs: 100, endMs: 500, text: "first question", partials: [{ atMs: 100, text: "first" }] },
        { id: "b", startMs: 1_300, endMs: 1_700, text: "second question", partials: [{ atMs: 100, text: "second" }] },
      ],
      onEvent: (e) => seen.push(e),
    });
    const events = replay(stream, 300, clock);
    expect(events.map((e) => `${e.segmentId}:${e.type}`)).toEqual([
      "a:partial",
      "a:final",
      "b:partial",
      "b:final",
    ]);
    expect(events.map((e) => e.mediaMs)).toEqual([200, 1_200, 1_400, 2_400]);
    expect(seen).toHaveLength(events.length);
  });

  it("rejects an invalid sample rate", () => {
    const provider = createMockAsrProvider();
    expect(() => provider.openStream({ sampleRate: 0, script: [] })).toThrow(/sampleRate/);
  });
});
