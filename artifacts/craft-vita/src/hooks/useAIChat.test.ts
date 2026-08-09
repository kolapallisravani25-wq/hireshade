import { describe, expect, it } from "vitest";
import { parseAnswerContent } from "./useAIChat";

// The backend (sessions.ts) always writes this exact literal prefix as the
// FIRST bytes of a stream, before the model has produced a single token:
//   res.write(`**QUESTION:** ${question}\n**ANSWER:** `)
// FloatingApp's AnswerArea used to re-parse this raw text with its own,
// independently-implemented regex instead of this shared, documented
// "single source of truth" — this file locks down the exact payload shapes
// that bug depended on getting wrong.

describe("parseAnswerContent — 1. prefix only, no model token yet", () => {
  it("returns the question with an EMPTY answer (not undefined, not the prefix itself)", () => {
    const raw = "**QUESTION:** What's your name?\n**ANSWER:** ";
    const { question, answer } = parseAnswerContent(raw);
    expect(question).toBe("What's your name?");
    expect(answer).toBe("");
  });
});

describe("parseAnswerContent — 2. prefix + partial answer (mid-stream)", () => {
  it("returns the growing partial answer text as-is", () => {
    const raw = "**QUESTION:** What's your name?\n**ANSWER:** My name is Sar";
    const { question, answer } = parseAnswerContent(raw);
    expect(question).toBe("What's your name?");
    expect(answer).toBe("My name is Sar");
  });
});

describe("parseAnswerContent — 3. full answer", () => {
  it("returns the complete question and answer once streaming finishes", () => {
    const raw =
      "**QUESTION:** What's your name?\n**ANSWER:** My name is Sarah, and I'm a backend engineer with 5 years of experience.";
    const { question, answer } = parseAnswerContent(raw);
    expect(question).toBe("What's your name?");
    expect(answer).toBe(
      "My name is Sarah, and I'm a backend engineer with 5 years of experience.",
    );
  });

  it("handles multi-line markdown answers (headings, lists) without truncation", () => {
    const raw =
      "**QUESTION:** Walk me through your architecture.\n**ANSWER:** ## Overview\n\n- Kafka for ingestion\n- Postgres for storage\n\nScales horizontally.";
    const { answer } = parseAnswerContent(raw);
    expect(answer).toContain("## Overview");
    expect(answer).toContain("Scales horizontally.");
  });
});

describe("parseAnswerContent — 4. true empty / error case", () => {
  it("returns an empty answer for a genuinely empty string, falling back to the supplied question", () => {
    const { question, answer } = parseAnswerContent("", "What's your name?");
    expect(question).toBe("What's your name?");
    expect(answer).toBe("");
  });

  it("returns an empty answer for whitespace-only text", () => {
    const { answer } = parseAnswerContent("   \n  ");
    expect(answer).toBe("");
  });

  it("treats a plain error/fallback message (no QUESTION/ANSWER markers) as the answer body itself", () => {
    // This is what useAIChat.ts's own fallback text looks like on a genuinely
    // empty model response — must render as visible text, not vanish.
    const raw = "I couldn't generate an answer from the current transcript. Please try regenerate.";
    const { answer } = parseAnswerContent(raw, "What's your name?");
    expect(answer).toBe(raw);
  });

  it("treats a mid-stream error tail appended after headers were already sent as visible answer text", () => {
    const raw =
      "**QUESTION:** What's your name?\n**ANSWER:** My name is\n\n**ERROR:** Answer generation failed mid-stream — please retry.";
    const { answer } = parseAnswerContent(raw);
    expect(answer).toContain("**ERROR:**");
    expect(answer).not.toBe("");
  });
});

describe("parseAnswerContent — 5. edge case identified during audit: unanchored regex vs. generated text containing the words question/answer", () => {
  it("does not re-split on 'question'/'answer' occurring naturally INSIDE the generated answer body", () => {
    // The backend's marker is only ever written once, as the literal prefix.
    // parseAnswerContent's structured-match is non-greedy on the QUESTION
    // capture and greedy on everything after the first ANSWER marker, so a
    // model response that itself discusses "the interview question" or says
    // "in answer to that" must not get mis-split into a second, wrong
    // question/answer pair.
    const raw =
      "**QUESTION:** How do you approach ambiguous requirements?\n" +
      "**ANSWER:** I first clarify the actual question being asked, then form " +
      "my answer around the highest-confidence interpretation, and validate it " +
      "with the interviewer before going deeper.";
    const { question, answer } = parseAnswerContent(raw);
    expect(question).toBe("How do you approach ambiguous requirements?");
    expect(answer).toBe(
      "I first clarify the actual question being asked, then form my answer around the highest-confidence interpretation, and validate it with the interviewer before going deeper.",
    );
  });

  it("degrades gracefully if only the QUESTION half has arrived (fragmented stream read, no ANSWER marker yet)", () => {
    const raw = "**QUESTION:** What's your na";
    const { question, answer } = parseAnswerContent(raw);
    expect(question).toBe("What's your na");
    expect(answer).toBe("");
  });
});
