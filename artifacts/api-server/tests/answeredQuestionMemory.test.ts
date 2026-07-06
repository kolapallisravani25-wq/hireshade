import { describe, it, expect } from "vitest";
import {
  normalizeQuestionKey,
  significantTokens,
  questionSimilarity,
  isAlreadyAnswered,
} from "../src/lib/answeredQuestionMemory.js";

describe("normalizeQuestionKey", () => {
  it("collapses casing, punctuation and filler lead-ins to one key", () => {
    const a = normalizeQuestionKey("So, okay — Can you introduce yourself?");
    const b = normalizeQuestionKey("can you introduce yourself");
    expect(a).toBe(b);
  });

  it("strips stacked leading fillers", () => {
    expect(normalizeQuestionKey("Um, well, and so what is your role"))
      .toBe("what is your role");
  });

  it("returns empty for pure whitespace", () => {
    expect(normalizeQuestionKey("   ")).toBe("");
  });
});

describe("questionSimilarity", () => {
  it("is 1 for token-identical questions ignoring order/filler", () => {
    expect(questionSimilarity("explain the Spark architecture", "the architecture of Spark"))
      .toBeGreaterThan(0.9);
  });

  it("is low for questions on different topics", () => {
    expect(questionSimilarity("introduce yourself", "how would you scale a Postgres write path"))
      .toBeLessThan(0.2);
  });

  it("ignores stopwords when building the token set", () => {
    expect(significantTokens("what is the role").has("the")).toBe(false);
  });
});

describe("isAlreadyAnswered", () => {
  const intro = "Can you introduce yourself and walk me through your recent project?";

  it("blocks an exact re-run of an already answered question (filler/punctuation aside)", () => {
    const r = isAlreadyAnswered(
      "So, can you introduce yourself and walk me through your recent project???",
      [intro],
    );
    expect(r.answered).toBe(true);
    expect(r.reason).toBe("exact_normalized_match");
  });

  it("blocks a near-duplicate above the similarity threshold", () => {
    const r = isAlreadyAnswered(
      "walk me through your most recent project and introduce yourself",
      [intro],
    );
    expect(r.answered).toBe(true);
    expect(r.reason).toBe("high_similarity");
  });

  it("ALLOWS a genuinely new scenario question (the reported bug)", () => {
    // The exact reported failure: a NEW scenario question must NOT be treated
    // as the already-answered self-introduction.
    const r = isAlreadyAnswered(
      "Your pipeline suddenly starts failing in production — how would you debug it?",
      [intro],
    );
    expect(r.answered).toBe(false);
  });

  it("never blocks a follow-up", () => {
    const r = isAlreadyAnswered(intro, [intro], { isFollowUp: true });
    expect(r.answered).toBe(false);
    expect(r.reason).toBe("follow_up_exempt");
  });

  it("never blocks a short deictic follow-up like 'why?'", () => {
    const r = isAlreadyAnswered("why?", ["why did you choose Spark over Hadoop"]);
    expect(r.answered).toBe(false);
  });

  it("returns not-answered when there is no prior history", () => {
    const r = isAlreadyAnswered(intro, []);
    expect(r.answered).toBe(false);
    expect(r.reason).toBe("no_prior_questions");
  });

  it("handles empty/undefined prior questions safely", () => {
    const r = isAlreadyAnswered(intro, [undefined, "", null]);
    expect(r.answered).toBe(false);
    expect(r.reason).toBe("no_prior_questions");
  });
});
