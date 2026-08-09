import { describe, expect, it } from "vitest";
import { resolveEffectiveLiveInterimText } from "./autoGenQuestionSource";

describe("resolveEffectiveLiveInterimText — pure input-selection rule (Mini-Phase B)", () => {
  describe("origin === 'auto'", () => {
    it("uses the supplied stabilized snapshot, not live interim text", () => {
      const result = resolveEffectiveLiveInterimText(
        "auto",
        "Explain how race conditions can occur... and can you give a practical example involving two concurrent API requests updating the same database record?",
        "And can you give a", // a newer, still-forming live fragment that must NOT win
      );
      expect(result).toBe(
        "Explain how race conditions can occur... and can you give a practical example involving two concurrent API requests updating the same database record?",
      );
    });

    it("trims the stabilized snapshot", () => {
      const result = resolveEffectiveLiveInterimText(
        "auto",
        "  What's your name?  ",
        "irrelevant live text",
      );
      expect(result).toBe("What's your name?");
    });

    it("INVARIANT: a newer live interim value can never override the stabilized snapshot, even when live text looks more 'current'", () => {
      const stabilized = "How would you detect and prevent them, and can you give a practical example?";
      const racedAheadLiveText = "And can you give a";
      const result = resolveEffectiveLiveInterimText("auto", stabilized, racedAheadLiveText);
      expect(result).toBe(stabilized);
      expect(result).not.toContain("And can you give a");
    });

    it("returns null (invariant violation, caller must skip generation) when stabilizedQuestion is undefined", () => {
      const result = resolveEffectiveLiveInterimText("auto", undefined, "some live text");
      expect(result).toBeNull();
    });

    it("returns null when stabilizedQuestion is an empty string", () => {
      const result = resolveEffectiveLiveInterimText("auto", "", "some live text");
      expect(result).toBeNull();
    });

    it("returns null when stabilizedQuestion is whitespace-only", () => {
      const result = resolveEffectiveLiveInterimText("auto", "   ", "some live text");
      expect(result).toBeNull();
    });

    it("never falls back to live interim text on invariant violation, even when live text is a complete-looking question", () => {
      // This is the exact regression this fix prevents: even if live text
      // LOOKS like a valid, complete question, the auto path must not use it
      // when the invariant (a supplied stabilized snapshot) is violated.
      const result = resolveEffectiveLiveInterimText(
        "auto",
        undefined,
        "What's your name?",
      );
      expect(result).toBeNull();
    });
  });

  describe("origin === 'overlay_click' / 'manual_click' (manual origins, unchanged behavior)", () => {
    it("overlay_click resolves from live interim text exactly as before, ignoring any stabilizedQuestion", () => {
      const result = resolveEffectiveLiveInterimText(
        "overlay_click",
        "some stabilized text that should be ignored",
        "What the user is currently seeing live",
      );
      expect(result).toBe("What the user is currently seeing live");
    });

    it("manual_click resolves from live interim text exactly as before", () => {
      const result = resolveEffectiveLiveInterimText(
        "manual_click",
        undefined,
        "  live interim with padding  ",
      );
      expect(result).toBe("live interim with padding");
    });

    it("manual origins never return null, even with empty live text (matches pre-existing behavior — downstream code handles empty strings, not null)", () => {
      const result = resolveEffectiveLiveInterimText("overlay_click", undefined, "");
      expect(result).toBe("");
      expect(result).not.toBeNull();
    });
  });
});
