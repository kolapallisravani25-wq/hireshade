import { describe, it, expect } from "vitest";
import { assessQuestionReadiness } from "../src/lib/questionReadiness.js";

describe("assessQuestionReadiness", () => {
  it("rejects empty", () => {
    expect(assessQuestionReadiness("").ready).toBe(false);
    expect(assessQuestionReadiness("   ").ready).toBe(false);
  });

  it("rejects the real production LEAD-IN fragment (no complete question yet)", () => {
    // This exact fragment reached the model and produced "I don't see the
    // actual interview question". No '?', short, ends on dangling word.
    const r = assessQuestionReadiness(
      "Can you introduce yourself and walk me through your",
    );
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/dangling_word/);
  });

  it("ACCEPTS a substantial utterance that already contains a complete question even if it trails off", () => {
    // Regression: the guard wrongly rejected this real question because the
    // snapshot ended on "and", surfacing "Sorry, I couldn't generate an answer".
    const r = assessQuestionReadiness(
      "one. Self introduction. Can you introduce yourself? And walk me through your experience as a data engineer? Please cover your total experience, current role, and",
    );
    expect(r.ready).toBe(true);
  });

  it("rejects short dangling-conjunction fragments", () => {
    expect(assessQuestionReadiness("Write a Dockerfile to containerize a").ready).toBe(false);
    expect(assessQuestionReadiness("Tell me about your experience and").ready).toBe(false);
  });

  it("rejects too-short stubs", () => {
    expect(assessQuestionReadiness("Self introduction").ready).toBe(false);
    expect(assessQuestionReadiness("Question one").ready).toBe(false);
  });

  it("rejects blobs with no question signal", () => {
    expect(assessQuestionReadiness("the production database server cluster").ready).toBe(false);
  });

  it("accepts complete questions", () => {
    expect(assessQuestionReadiness("Can you introduce yourself and walk me through your experience?").ready).toBe(true);
    expect(assessQuestionReadiness("Write a Dockerfile to containerize a Node.js app using a multi-stage build.").ready).toBe(true);
    expect(assessQuestionReadiness("How would you design a CI/CD pipeline for microservices?").ready).toBe(true);
    expect(assessQuestionReadiness("Tell me about a time you handled a production incident.").ready).toBe(true);
  });

  it("accepts short questions that terminate with '?'", () => {
    expect(assessQuestionReadiness("Why Spark?").ready).toBe(true);
  });

  it("forces through on explicit manual click regardless of shape", () => {
    // Desktop overlay click / manual click: user deliberately asked.
    expect(
      assessQuestionReadiness("Write a Dockerfile to containerize a", { force: true }).ready,
    ).toBe(true);
    // Desktop (sourcePlatform tauri) always forces — it already gated the question.
    expect(
      assessQuestionReadiness("Self introduction", { force: true }).ready,
    ).toBe(true);
    // but still rejects genuinely empty even when forced
    expect(assessQuestionReadiness("", { force: true }).ready).toBe(false);
  });
});
