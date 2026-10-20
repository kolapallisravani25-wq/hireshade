import { describe, expect, it } from "vitest";
import type { DemoEvent } from "./events.js";
import { buildOverlayFrames, buildOverlayReplay } from "./overlayStream.js";

function ev(type: DemoEvent["type"], atMs: number, stream: DemoEvent["stream"], data: Record<string, unknown> = {}): DemoEvent {
  return { type, atMs, mediaMs: atMs, stream, data };
}

const EVENTS: DemoEvent[] = [
  ev("session.start", 0, null, {}),
  ev("stream.start", 0, "mic", {}),
  ev("stream.start", 0, "screen", {}),
  ev("vad.segment", 600, "screen", { segmentId: "screen:0" }),
  ev("asr.partial", 850, "screen", { text: "Can you explain how" }),
  ev("asr.final", 2_300, "screen", { text: "Can you explain how you would design a rate limiter using Redis?" }),
  ev("asr.end_of_utterance", 2_300, "screen", { segmentId: "screen:0" }),
  ev("asr.partial", 3_600, "mic", { text: "Okay" }),
  ev("asr.final", 4_450, "mic", { text: "Okay, got it." }),
  ev("question.detected", 2_310, "screen", {
    question: "explain how you would design a rate limiter using Redis",
    model: "gpt-5",
  }),
  ev("prompt.built", 2_312, "screen", { promptChars: 5_000 }),
  ev("answer.first_token", 2_830, "screen", { model: "gpt-5" }),
  ev("answer.delta", 2_835, "screen", { text: "Here's how " }),
  ev("answer.delta", 2_845, "screen", { text: "I'd answer that." }),
  ev("answer.final", 4_500, "screen", { answer: "Here's how I'd answer that.", questionToAnswerVisibleMs: 2_190 }),
  ev("session.end", 4_600, null, {}),
];

describe("buildOverlayFrames", () => {
  it("starts listening and ends complete with the full streamed answer", () => {
    const frames = buildOverlayFrames(EVENTS);
    expect(frames[0]).toMatchObject({ status: "listening", answer: "", question: "" });
    const last = frames[frames.length - 1]!;
    expect(last.status).toBe("complete");
    expect(last.answerComplete).toBe(true);
    expect(last.answer).toBe("Here's how I'd answer that.");
    expect(last.question).toContain("rate limiter");
    expect(last.model).toBe("gpt-5");
    expect(last.questionAtMs).toBe(2_310);
    expect(last.firstTokenAtMs).toBe(2_830);
    expect(last.completeAtMs).toBe(4_500);
  });

  it("tracks screen partials and mic partials on separate fields", () => {
    const frames = buildOverlayFrames(EVENTS);
    const partialFrame = frames.find((f) => f.partial === "Can you explain how");
    expect(partialFrame).toBeTruthy();
    const micFrame = frames.find((f) => f.micPartial === "Okay");
    expect(micFrame).toBeTruthy();
    // A final clears the corresponding partial.
    expect(frames.some((f) => f.partial === "Can you explain how" && f.status === "question")).toBe(false);
  });

  it("grows the answer cumulatively and keeps frames sorted by time", () => {
    const frames = buildOverlayFrames(EVENTS);
    const answerLengths = frames.map((f) => f.answer.length);
    for (let i = 1; i < answerLengths.length; i++) {
      expect(answerLengths[i]!).toBeGreaterThanOrEqual(answerLengths[i - 1]!);
    }
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.atMs).toBeGreaterThanOrEqual(frames[i - 1]!.atMs);
    }
    expect(frames.some((f) => f.status === "streaming")).toBe(true);
  });

  it("collapses redundant frames", () => {
    const frames = buildOverlayFrames([
      ev("session.start", 0, null, {}),
      ev("vad.segment", 100, "screen", {}),
      ev("vad.segment", 200, "screen", {}),
      ev("answer.delta", 300, "screen", { text: "a" }),
      ev("answer.delta", 400, "screen", { text: "" }), // no visible change
    ]);
    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({ answer: "a", atMs: 300 });
  });
});

describe("buildOverlayReplay", () => {
  it("computes replay metadata from the last frame", () => {
    const replay = buildOverlayReplay("session-1", EVENTS);
    expect(replay.meta).toEqual({
      sessionId: "session-1",
      questionCount: 1,
      answerChars: "Here's how I'd answer that.".length,
      answerVisibleMs: 2_190,
    });
    expect(replay.frames.length).toBeGreaterThan(2);
  });
});
