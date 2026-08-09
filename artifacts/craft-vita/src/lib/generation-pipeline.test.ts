import { describe, expect, it } from "vitest";
import { segmentQuestions } from "./generation-pipeline";

describe("segmentQuestions — regression: exact runtime failure", () => {
  it("keeps a single compound question as ONE segment even when Deepgram smart_format inserted a spurious '?' at the mid-question pause", () => {
    // Root cause: smart_format can punctuate a natural pause mid-question
    // ("...in object-oriented programming?" <pause> "And give a practical
    // example..."), and the OLD naive '?'-boundary split treated this as two
    // independent questions, producing a second generation with no context
    // for "each" (observed Windows runtime failure).
    const stt =
      "Can you explain the difference between an interface and an abstract class in object-oriented programming? " +
      "And give a practical example of when you would use each?";
    expect(segmentQuestions(stt)).toEqual([
      "Can you explain the difference between an interface and an abstract class in object-oriented programming? And give a practical example of when you would use each?",
    ]);
  });
});

describe("segmentQuestions — legitimate multi-question turns still split", () => {
  it("splits two genuinely independent questions", () => {
    expect(segmentQuestions("What's your name? Where are you from?")).toEqual([
      "What's your name?",
      "Where are you from?",
    ]);
  });

  it("splits three genuinely independent questions", () => {
    expect(
      segmentQuestions("What's your name? Where are you from? What do you do?"),
    ).toEqual(["What's your name?", "Where are you from?", "What do you do?"]);
  });
});

describe("segmentQuestions — continuation beginning with a coordinating conjunction stays grouped", () => {
  it('merges a segment starting with "And"', () => {
    const text = "Tell me about your last project? And what was the biggest challenge?";
    expect(segmentQuestions(text)).toEqual([
      "Tell me about your last project? And what was the biggest challenge?",
    ]);
  });

  it('merges a segment starting with "Or"', () => {
    const text = "Would you use Kafka for this? Or would you prefer something simpler?";
    expect(segmentQuestions(text)).toEqual([
      "Would you use Kafka for this? Or would you prefer something simpler?",
    ]);
  });

  it('merges a segment starting with "But"', () => {
    const text = "Is that approach scalable? But what happens under heavy write load?";
    expect(segmentQuestions(text)).toEqual([
      "Is that approach scalable? But what happens under heavy write load?",
    ]);
  });

  it('merges a segment starting with "So"', () => {
    const text = "You mentioned microservices? So how do you handle distributed transactions?";
    expect(segmentQuestions(text)).toEqual([
      "You mentioned microservices? So how do you handle distributed transactions?",
    ]);
  });

  it("chains three conjunction-led continuations into one segment", () => {
    const text =
      "Can you walk me through your architecture? And what about the database layer? " +
      "Or did you use a cache? So how does that affect consistency?";
    expect(segmentQuestions(text)).toEqual([
      "Can you walk me through your architecture? And what about the database layer? Or did you use a cache? So how does that affect consistency?",
    ]);
  });
});

describe("segmentQuestions — does not over-merge genuinely new questions", () => {
  it("does NOT merge a new question that merely starts with a filler word, not a conjunction", () => {
    // "Okay" is a filler, not one of and/or/but/so — must still split.
    expect(
      segmentQuestions("What's your favorite language? Okay, what's your biggest weakness?"),
    ).toEqual([
      "What's your favorite language?",
      "Okay, what's your biggest weakness?",
    ]);
  });

  it("does not merge when the second question's subject clearly changes topic and doesn't start with a conjunction", () => {
    expect(
      segmentQuestions("Where did you go to school? What was your first job?"),
    ).toEqual(["Where did you go to school?", "What was your first job?"]);
  });
});

describe("segmentQuestions — single question / no-question edge cases", () => {
  it("returns a single-element array for one question with no split boundary (caller falls back to grouped generation since length < 2)", () => {
    expect(segmentQuestions("What's your name?")).toEqual(["What's your name?"]);
  });

  it("returns [] for empty input", () => {
    expect(segmentQuestions("")).toEqual([]);
  });

  it("returns [] when there is no '?' and no numbered list to split on", () => {
    expect(segmentQuestions("tell me about yourself")).toEqual([]);
  });
});
