import { describe, expect, it } from "vitest";
import {
  CODING_ANSWER_CONTRACT,
  CODING_ANSWER_MODE,
  codingGuidanceForAnswerMode,
} from "../src/lib/codingMode.js";
import { buildInterviewSystemPrompt } from "../src/lib/interviewPrompt.js";
import { CODING_ANSWER_CONTRACT as CLIENT_CONTRACT } from "../../craft-vita/src/features/coding/analyzeScreenCodingRoute";

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

describe("coding answer contract (server)", () => {
  it("matches the client contract verbatim", () => {
    expect(CODING_ANSWER_CONTRACT).toBe(CLIENT_CONTRACT);
  });

  it("requires the structured sections", () => {
    expect(CODING_ANSWER_CONTRACT).toContain("**Approach**");
    expect(CODING_ANSWER_CONTRACT).toContain("**Complexity**");
    expect(CODING_ANSWER_CONTRACT).toContain("**Edge cases**");
    expect(CODING_ANSWER_CONTRACT).toContain("Big-O");
  });

  it("only applies to code_required", () => {
    expect(codingGuidanceForAnswerMode("code_required")).toBe(CODING_ANSWER_CONTRACT);
    expect(codingGuidanceForAnswerMode(CODING_ANSWER_MODE)).toBe(CODING_ANSWER_CONTRACT);
    expect(codingGuidanceForAnswerMode("theory_only")).toBe("");
    expect(codingGuidanceForAnswerMode("auto")).toBe("");
    expect(codingGuidanceForAnswerMode(undefined)).toBe("");
  });

  it("is injected into the system prompt for a coding question", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession(),
      answerMode: "code_required",
    });
    expect(prompt).toContain("Provide a complete, working code solution");
    expect(prompt).toContain(CODING_ANSWER_CONTRACT);
  });

  it("is not injected for non-coding answer modes", () => {
    for (const answerMode of ["auto", "theory_only", "minimal_code", "system_design"]) {
      const prompt = buildInterviewSystemPrompt({
        session: makeSession(),
        answerMode,
      });
      expect(prompt, answerMode).not.toContain(CODING_ANSWER_CONTRACT);
    }
  });

  it("still gets the generic code_required guidance and the structured contract", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession(),
      answerMode: "code_required",
    });
    expect(prompt.indexOf("Provide a complete, working code solution")).toBeLessThan(
      prompt.indexOf(CODING_ANSWER_CONTRACT),
    );
  });
});
