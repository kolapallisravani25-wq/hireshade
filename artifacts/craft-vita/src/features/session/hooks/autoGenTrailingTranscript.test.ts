import { describe, expect, it } from "vitest";
import { computeTrailingInterviewerMessages } from "./autoGenTrailingTranscript";

describe("computeTrailingInterviewerMessages — Mini-Phase 3 baseline boundary", () => {
  it("11. a first (baseline-advanced) answered interviewer question does not leak into the second, even with no candidate mic message in between", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "Explain how race conditions can occur?" },
      // No "User" sender message here — candidate never audibly responded
      // before the interviewer asked the next question.
      { id: "q2", sender: "Interviewer" as const, text: "How would you detect and prevent them?" },
    ];

    // Baseline was advanced to "q1" the moment the first question was
    // accepted for generation (simulating the autoGenFireRef fix).
    const trailing = computeTrailingInterviewerMessages(messages, "q1");

    expect(trailing).toHaveLength(1);
    expect(trailing[0]!.id).toBe("q2");
    expect(trailing[0]!.text).toBe("How would you detect and prevent them?");
    // The already-answered first question's text must not appear anywhere.
    expect(trailing.some((m) => m.text.includes("race conditions"))).toBe(false);
  });

  it("12. a simulated generation failure still leaves the next turn's boundary clean (baseline advances at accept-time, not success-time)", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "Explain race conditions?" },
      { id: "q2", sender: "Interviewer" as const, text: "What about deadlocks?" },
    ];
    // The baseline is advanced by useFloatingSession.ts's autoGenFireRef
    // immediately after shouldTriggerGeneration accepts — BEFORE the network
    // call runs, so a failed generation for q1 still leaves the baseline at
    // "q1". The next feed correctly starts from q2 regardless of whether q1's
    // generation succeeded or failed.
    const trailing = computeTrailingInterviewerMessages(messages, "q1");
    expect(trailing.map((m) => m.id)).toEqual(["q2"]);
  });

  it("stops at the first User-sender message (a real candidate response marks a genuine new turn)", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "Tell me about yourself?" },
      { id: "a1", sender: "User" as const, text: "Sure, I have five years of experience." },
      { id: "q2", sender: "Interviewer" as const, text: "What is your greatest strength?" },
    ];
    const trailing = computeTrailingInterviewerMessages(messages, null);
    expect(trailing.map((m) => m.id)).toEqual(["q2"]);
  });

  it("with no baseline set (null) and no User message, includes every prior Interviewer message (first-observation seed case)", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "First question?" },
      { id: "q2", sender: "Interviewer" as const, text: "Second question?" },
    ];
    const trailing = computeTrailingInterviewerMessages(messages, null);
    expect(trailing.map((m) => m.id)).toEqual(["q1", "q2"]);
  });

  it("skips empty/whitespace-only Interviewer messages", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "Real question?" },
      { id: "empty", sender: "Interviewer" as const, text: "   " },
      { id: "q2", sender: "Interviewer" as const, text: "Follow-up?" },
    ];
    const trailing = computeTrailingInterviewerMessages(messages, null);
    expect(trailing.map((m) => m.id)).toEqual(["q1", "q2"]);
  });

  it("returns an empty array when everything is at or before the baseline", () => {
    const messages = [
      { id: "q1", sender: "Interviewer" as const, text: "Already consumed?" },
    ];
    const trailing = computeTrailingInterviewerMessages(messages, "q1");
    expect(trailing).toHaveLength(0);
  });
});
