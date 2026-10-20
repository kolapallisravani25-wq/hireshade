import { describe, expect, it } from "vitest";
import {
  INSTRUCTIONS_TOO_LONG_CODE,
  MAX_INSTRUCTIONS_CHARS,
  countInstructionsChars,
  instructionsTooLongPayload,
  validateInstructions,
} from "../src/lib/instructions.js";
import { buildInterviewSystemPrompt } from "../src/lib/interviewPrompt.js";

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    userId: "u1",
    companyName: "",
    round: null,
    jobDescription: "",
    language: "English",
    simpleLanguage: false,
    extraContext: "",
    instructions: "",
    aiModel: null,
    resumeId: null,
    documentId: null,
    projectIds: [],
    primaryProjectId: null,
    ...overrides,
  } as never;
}

describe("instructions limit (server-side enforcement)", () => {
  it("cap matches the client contract", () => {
    expect(MAX_INSTRUCTIONS_CHARS).toBe(20_000);
  });

  it("accepts a value exactly at the cap", () => {
    const value = "x".repeat(MAX_INSTRUCTIONS_CHARS);
    expect(validateInstructions(value).ok).toBe(true);
    expect(countInstructionsChars(value)).toBe(MAX_INSTRUCTIONS_CHARS);
  });

  it("rejects a value one character over the cap", () => {
    const value = "x".repeat(MAX_INSTRUCTIONS_CHARS + 1);
    const result = validateInstructions(value);
    expect(result.ok).toBe(false);
    expect(result.length).toBe(MAX_INSTRUCTIONS_CHARS + 1);
    expect(result.remaining).toBe(0);
    expect(result.error).toContain("20000");
  });

  it("builds the 400 payload the routes return", () => {
    const payload = instructionsTooLongPayload("x".repeat(20_500));
    expect(payload.code).toBe(INSTRUCTIONS_TOO_LONG_CODE);
    expect(payload.maxChars).toBe(MAX_INSTRUCTIONS_CHARS);
    expect(payload.length).toBe(20_500);
    expect(payload.error).toBe(payload.message);
  });

  it("does not flag empty/absent instructions", () => {
    expect(validateInstructions("").ok).toBe(true);
    expect(validateInstructions(null).ok).toBe(true);
    expect(validateInstructions(undefined).ok).toBe(true);
  });
});

describe("instructions are included in the prompt", () => {
  it("injects the full 20,000-char instruction verbatim", () => {
    const instructions = "Follow these rules. ".repeat(1000).slice(0, MAX_INSTRUCTIONS_CHARS);
    expect(instructions.length).toBe(MAX_INSTRUCTIONS_CHARS);
    const prompt = buildInterviewSystemPrompt({ session: makeSession({ instructions }) });
    expect(prompt).toContain(instructions);
    expect(prompt).toContain("Custom session instructions from the user:");
  });

  it("keeps extraContext separate from instructions", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession({ instructions: "Be concise", extraContext: "Pitch a data platform" }),
    });
    expect(prompt).toContain("Custom session instructions from the user:\nBe concise");
    expect(prompt).toContain("Extra session context:\nPitch a data platform");
  });
});
