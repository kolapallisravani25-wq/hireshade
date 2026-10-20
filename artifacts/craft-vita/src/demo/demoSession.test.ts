import { describe, expect, it } from "vitest";
import { createDemoSessionCreate } from "../../../api-server/src/lib/mocks/targetContracts.js";
import {
  buildDemoPromptInputs,
  formatSessionPreferences,
  languageLabel,
} from "./demoSession.js";

describe("demoSession", () => {
  it("maps the target preference contract into the real system prompt", () => {
    const create = createDemoSessionCreate({
      language: "en",
      responseLength: "long",
      responseFormat: "code",
      responseTone: "formal",
      useStarMethod: true,
      systemInstructions: "Always mention the observability trade-off.",
    });
    const { prompt, answerMode } = buildDemoPromptInputs(create);
    expect(prompt).toContain("You are the HireShade interview answer engine.");
    expect(prompt).toContain("Session answer preferences");
    expect(prompt).toContain("- response length: long");
    expect(prompt).toContain("- response tone: formal");
    expect(prompt).toContain("- use STAR method: yes");
    expect(prompt).toContain("Always mention the observability trade-off.");
    expect(prompt).toContain("Demo Candidate - Senior Backend Engineer");
    // responseFormat=code maps onto the builder's code-required answer mode.
    expect(answerMode).toBe("code_required");
    expect(prompt).toContain("complete, working code solution");
  });

  it("maps language codes to prompt language labels", () => {
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("hi")).toBe("Hindi");
    expect(languageLabel("en:medical")).toBe("English");
    expect(languageLabel("xx")).toBe("xx");
    const { prompt } = buildDemoPromptInputs(createDemoSessionCreate({ language: "hi" }));
    // The shared language registry (G-021) renders the native spelling, so match
    // on the directive shape rather than an exact sentence.
    expect(prompt).toMatch(/Respond[^\n]*Hindi/);
  });

  it("uses the theory-only mode for bullet answers", () => {
    const { answerMode } = buildDemoPromptInputs(createDemoSessionCreate({ responseFormat: "bullets" }));
    expect(answerMode).toBe("theory_only");
  });

  it("formats every preference field", () => {
    const preferences = formatSessionPreferences(createDemoSessionCreate());
    for (const field of [
      "language",
      "response length",
      "response format",
      "response tone",
      "use STAR method",
      "use filler words",
      "auto answer",
      "save transcription",
    ]) {
      expect(preferences).toContain(field);
    }
  });
});
