import { describe, it, expect } from "vitest";
import { normalizeSpeakerType } from "./ai-answer";

// -------------------------------------------------------------------------
// Issue 3 — interviewer speech must never be classified/stored/passed as the
// "system" role. Every real sender/role spelling that flows through the
// transcript → adaptive-context → ai-answer pipeline must map to a real
// speaker; only genuinely unknown input may fall through to "system".
// -------------------------------------------------------------------------

describe("normalizeSpeakerType", () => {
  it("maps interviewer/remote spellings to interviewer (never system)", () => {
    for (const input of [
      "interviewer",
      "Interviewer",
      "INTERVIEWER",
      " Interviewer ",
      "remote",
      "REMOTE",
    ]) {
      expect(normalizeSpeakerType(input)).toBe("interviewer");
    }
  });

  it("maps candidate/user spellings to candidate", () => {
    for (const input of ["candidate", "user", "User", "USER", "me", "self"]) {
      expect(normalizeSpeakerType(input)).toBe("candidate");
    }
  });

  it("maps assistant/ai spellings to assistant", () => {
    for (const input of [
      "assistant",
      "ai",
      "AI",
      "ai_assistant",
      "AI_ASSISTANT",
      "ai-assistant",
    ]) {
      expect(normalizeSpeakerType(input)).toBe("assistant");
    }
  });

  it("only falls through to system for genuinely unknown input", () => {
    expect(normalizeSpeakerType("system")).toBe("system");
    expect(normalizeSpeakerType("")).toBe("system");
    expect(normalizeSpeakerType("unknown")).toBe("system");
  });
});
