import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("sensitive frontend logging", () => {
  it("does not log AI request bodies or query text", () => {
    const aiChat = source("hooks/useAIChat.ts");
    for (const marker of [
      "Raw input request:",
      "Base sanitized payload:",
      "Resolved query before normalization:",
      "Final normalized payload before routing:",
      "POST /ai-answer body:",
      "Raw manual query:",
      "Authoritative manual query:",
      "with body:",
    ]) {
      expect(aiChat).not.toContain(marker);
    }
  });

  it("does not log transcript or resolved-question content", () => {
    const floating = source("features/session/hooks/useFloatingSession.ts");
    for (const marker of [
      "original: intent.originalTranscript",
      "cleaned: intent.cleanedQuestion",
      "Resolved question from",
      "preQuestion:",
      "postQuestion:",
      "Continuation detected, merged:",
    ]) {
      expect(floating).not.toContain(marker);
    }
  });

  it("does not log live-session transcript or question text", () => {
    const activeSession = source("pages/Sessions/ActiveSession/page.tsx");
    for (const marker of [
      "[Transcript Final Input]",
      "Skipped filler-only interviewer chunk:",
      "Question content:",
      "initiated for question:",
      "Using meaningful user message instead:",
      "Suppressed replay from",
      "Suppressed echo from",
      "Continuation detected, merged:",
    ]) {
      expect(activeSession).not.toContain(marker);
    }
  });
});
