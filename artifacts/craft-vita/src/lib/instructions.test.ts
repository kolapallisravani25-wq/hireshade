import { describe, expect, it } from "vitest";
import {
  INSTRUCTIONS_WARN_AT_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  countInstructionsChars,
  instructionsCounterLabel,
  isInstructionsNearLimit,
  isInstructionsValid,
  validateInstructions,
} from "./instructions";

describe("instructions limit", () => {
  it("caps instructions at 20,000 characters", () => {
    expect(MAX_INSTRUCTIONS_CHARS).toBe(20_000);
  });

  it("accepts an empty value", () => {
    expect(validateInstructions("")).toEqual({ ok: true, length: 0, remaining: 20_000 });
    expect(validateInstructions(null).ok).toBe(true);
    expect(validateInstructions(undefined).ok).toBe(true);
  });

  it("accepts exactly 20,000 characters", () => {
    const atLimit = "a".repeat(MAX_INSTRUCTIONS_CHARS);
    expect(validateInstructions(atLimit)).toEqual({
      ok: true,
      length: MAX_INSTRUCTIONS_CHARS,
      remaining: 0,
    });
  });

  it("rejects 20,001 characters and reports the overshoot", () => {
    const overLimit = "a".repeat(MAX_INSTRUCTIONS_CHARS + 1);
    const result = validateInstructions(overLimit);
    expect(result.ok).toBe(false);
    expect(result.length).toBe(20_001);
    expect(result.remaining).toBe(0);
    expect(result.error).toContain("20,001");
    expect(result.error).toContain("1 characters");
  });

  it("counts unicode code units the same way the textarea and server do", () => {
    expect(countInstructionsChars("héllo")).toBe(5);
    expect(countInstructionsChars("日本語")).toBe(3);
    expect(countInstructionsChars("🙂")).toBe(2);
  });

  it("formats the counter label with thousands separators", () => {
    expect(instructionsCounterLabel("")).toBe("0 / 20,000");
    expect(instructionsCounterLabel("a".repeat(1234))).toBe("1,234 / 20,000");
  });

  it("flags the warning zone at 18,000 characters", () => {
    expect(isInstructionsNearLimit("a".repeat(INSTRUCTIONS_WARN_AT_CHARS - 1))).toBe(false);
    expect(isInstructionsNearLimit("a".repeat(INSTRUCTIONS_WARN_AT_CHARS))).toBe(true);
    expect(isInstructionsNearLimit("a".repeat(MAX_INSTRUCTIONS_CHARS))).toBe(true);
  });

  it("exposes a submit guard", () => {
    expect(isInstructionsValid("a".repeat(MAX_INSTRUCTIONS_CHARS))).toBe(true);
    expect(isInstructionsValid("a".repeat(MAX_INSTRUCTIONS_CHARS + 1))).toBe(false);
  });
});
