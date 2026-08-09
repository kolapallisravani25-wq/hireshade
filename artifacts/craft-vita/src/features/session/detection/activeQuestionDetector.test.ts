import { describe, expect, it } from "vitest";
import { detectActiveQuestion } from "./activeQuestionDetector";

/**
 * Mini-Phase B relies on detectActiveQuestion behaving correctly when fed
 * the STABILIZED snapshot as liveInterimText (instead of raw, possibly
 * still-forming live component state). These tests validate that premise —
 * they do not exercise handleAiAnswerClick's actual wiring, which cannot be
 * unit-tested in this repo's "node" vitest environment (no DOM/hook
 * rendering harness exists anywhere in this codebase). Confirming the
 * wiring itself requires the Windows runtime reproduction.
 */

const COMPOUND_QUESTION =
  "Explain how race conditions can occur in an asynchronous JavaScript/Node.js application. " +
  "How would you detect and prevent them, and can you give a practical example involving two " +
  "concurrent API requests updating the same database record?";

describe("detectActiveQuestion — pure-function contract Mini-Phase B depends on", () => {
  it("1. fed the full, correct stabilized compound question, resolves to that exact text (not a truncated variant)", () => {
    const result = detectActiveQuestion({
      liveInterimText: COMPOUND_QUESTION,
      allMessages: [],
      cutoffTimestamp: 0,
    });
    expect(result.source).toBe("live_interim");
    expect(result.cleanedQuestion).toContain("race conditions");
    expect(result.cleanedQuestion).toContain(
      "two concurrent API requests updating the same database record",
    );
  });

  it("2. documents the pre-existing gap: a truncated live fragment is selected via live_interim with no rejection (this is exactly why Mini-Phase B never feeds raw live state to the auto path anymore)", () => {
    const truncatedFragment = "And can you give a";
    const result = detectActiveQuestion({
      liveInterimText: truncatedFragment,
      allMessages: [],
      cutoffTimestamp: 0,
    });
    // Not rejected outright — detectActiveQuestion has no completeness gate
    // on the live_interim branch. This is the mechanism Mini-Phase B routes
    // around (by never supplying a raw, unstabilized fragment as input for
    // origin === "auto"), not a bug fixed inside this function.
    expect(result.source).toBe("live_interim");
    expect(result.ignoredNoise).toBe(false);
  });

  it("3. answered-key suppression still works when the stabilized text matches an already-answered key", () => {
    const result = detectActiveQuestion({
      liveInterimText: COMPOUND_QUESTION,
      allMessages: [],
      cutoffTimestamp: 0,
      answeredQuestionKeys: [COMPOUND_QUESTION],
    });
    expect(result.ignoredNoise).toBe(true);
    // alreadyAnswered applies a flat -0.5 confidence penalty (build()'s
    // scoring in activeQuestionDetector.ts) — landing at or below 0.5,
    // not necessarily strictly below it depending on base confidence.
    expect(result.confidenceScore).toBeLessThanOrEqual(0.5);
  });

  it("4. a second, genuinely new stabilized question (not in answeredQuestionKeys) resolves normally, not suppressed", () => {
    const firstQuestion = "What's your name?";
    const secondQuestion = "Where are you from?";
    const result = detectActiveQuestion({
      liveInterimText: secondQuestion,
      allMessages: [],
      cutoffTimestamp: 0,
      answeredQuestionKeys: [firstQuestion],
    });
    expect(result.ignoredNoise).toBe(false);
    expect(result.cleanedQuestion.toLowerCase()).toContain("where are you from");
  });
});
