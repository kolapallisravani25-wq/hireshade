import { describe, it, expect } from "vitest";
import {
  buildInterviewSystemPrompt,
  computeContextPresence,
  type BuildPromptOpts,
} from "../src/lib/interviewPrompt.js";

// Minimal session stand-in. computeContextPresence/buildInterviewSystemPrompt
// only read a handful of string/boolean fields, so a cast keeps the test free
// of a real DB row while exercising the real code paths.
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
  } as unknown as BuildPromptOpts["session"];
}

describe("computeContextPresence", () => {
  it("reports thinContext=true when no resume/project/document/JD is present", () => {
    const p = computeContextPresence({ session: makeSession() });
    expect(p.resumeLoaded).toBe(false);
    expect(p.projectLoaded).toBe(false);
    expect(p.documentsLoaded).toBe(false);
    expect(p.jdLoaded).toBe(false);
    expect(p.thinContext).toBe(true);
    expect(p.groundingSourceCount).toBe(0);
  });

  it("treats whitespace-only context as absent", () => {
    const p = computeContextPresence({
      session: makeSession(),
      resumeContext: "   \n  ",
      projectContext: "",
    });
    expect(p.resumeLoaded).toBe(false);
    expect(p.thinContext).toBe(true);
  });

  it("reports the right booleans when each source is present", () => {
    const p = computeContextPresence({
      session: makeSession({ jobDescription: "Data Engineer role", instructions: "Be concise" }),
      resumeContext: "Senior Data Engineer, 6 years, Spark/Databricks",
      projectContext: "Project: retail analytics platform",
      documentContext: 'Document "notes.txt": migration plan',
    });
    expect(p.resumeLoaded).toBe(true);
    expect(p.projectLoaded).toBe(true);
    expect(p.documentsLoaded).toBe(true);
    expect(p.jdLoaded).toBe(true);
    expect(p.sessionPromptLoaded).toBe(true);
    expect(p.candidateHistoryGrounded).toBe(true);
    expect(p.thinContext).toBe(false);
    expect(p.groundingSourceCount).toBe(4);
  });

  it("JD alone does NOT ground candidate history (still thin)", () => {
    const p = computeContextPresence({
      session: makeSession({ jobDescription: "We want a Spark expert" }),
    });
    expect(p.jdLoaded).toBe(true);
    expect(p.candidateHistoryGrounded).toBe(false);
    expect(p.thinContext).toBe(true);
  });
});

describe("buildInterviewSystemPrompt — generic mode when context is thin", () => {
  it("injects the prominent GENERIC MODE block and forbids invented specifics", () => {
    const prompt = buildInterviewSystemPrompt({ session: makeSession() });
    expect(prompt).toMatch(/GROUNDING CONTEXT IS THIN OR ABSENT/i);
    expect(prompt).toMatch(/GENERIC MODE/i);
    // Forbids the exact fabrication classes seen in the production transcript.
    expect(prompt).toMatch(/hospitality client/i);
    expect(prompt).toMatch(/1TB\+/i);
    expect(prompt).toMatch(/20\+ PySpark transformations/i);
    expect(prompt).toMatch(/reduced query time by 30%/i);
    // The generic block should appear near the very top so it dominates.
    const idx = prompt.indexOf("GROUNDING CONTEXT IS THIN OR ABSENT");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(400);
  });

  it("does NOT inject the generic block when the candidate is grounded", () => {
    const prompt = buildInterviewSystemPrompt({
      session: makeSession(),
      resumeContext: "Senior Data Engineer at Acme, built Spark pipelines for 4 years.",
    });
    expect(prompt).not.toMatch(/GROUNDING CONTEXT IS THIN OR ABSENT/i);
    // But the always-on hard rules against fabrication remain.
    expect(prompt).toMatch(/NEVER invent quantitative metrics/i);
    expect(prompt).toMatch(/NEVER invent a client's INDUSTRY or DOMAIN/i);
  });

  it("always forbids invented industries and artifact counts regardless of mode", () => {
    const grounded = buildInterviewSystemPrompt({
      session: makeSession(),
      resumeContext: "Backend engineer building payment services.",
    });
    expect(grounded).toMatch(/specific artifact counts/i);
    expect(grounded).toMatch(/hospitality client|healthcare client/i);
  });
});
