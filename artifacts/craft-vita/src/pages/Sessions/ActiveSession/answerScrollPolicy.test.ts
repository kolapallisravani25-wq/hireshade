import { describe, expect, it } from "vitest";
import { isNearBottom, shouldForceScrollToBottom, NEAR_BOTTOM_TOLERANCE_PX } from "./answerScrollPolicy";

describe("isNearBottom", () => {
  it("is true when the container is scrolled exactly to the bottom", () => {
    expect(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
  });

  it("is true within the tolerance band", () => {
    expect(
      isNearBottom({ scrollTop: 800 - (NEAR_BOTTOM_TOLERANCE_PX - 1), scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(true);
  });

  it("is false once scrolled past the tolerance band (manual scroll-up)", () => {
    expect(
      isNearBottom({ scrollTop: 800 - NEAR_BOTTOM_TOLERANCE_PX - 1, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(false);
  });

  it("is false when scrolled far away to read earlier content", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 2000, clientHeight: 200 })).toBe(false);
  });
});

describe("shouldForceScrollToBottom — 1. streamed text growth follows to bottom while near it", () => {
  it("scrolls when the user is near bottom (mirrors a fresh token arriving)", () => {
    const nearBottom = isNearBottom({ scrollTop: 780, scrollHeight: 1000, clientHeight: 200 });
    expect(shouldForceScrollToBottom(nearBottom)).toBe(true);
  });
});

describe("shouldForceScrollToBottom — 2. rendered-height growth without text-length change", () => {
  it("uses the SAME gate as the text-growth path, so a ResizeObserver-triggered check behaves identically", () => {
    // Content grew (e.g. code-block syntax highlighting reflow, or the async
    // native-window auto-grow completing) with no new token — the metrics
    // still say "near bottom", and the decision must still be to follow.
    const nearBottomAfterLayoutGrowth = isNearBottom({
      scrollTop: 1180,
      scrollHeight: 1400, // grew from 1000 -> 1400 with no scrollTop change yet
      clientHeight: 200,
    });
    expect(shouldForceScrollToBottom(nearBottomAfterLayoutGrowth)).toBe(true);
  });
});

describe("shouldForceScrollToBottom — 3. manual scroll-up suppresses forced bottom", () => {
  it("does not scroll once the user has scrolled away from the bottom", () => {
    const scrolledAway = isNearBottom({ scrollTop: 100, scrollHeight: 2000, clientHeight: 200 });
    expect(shouldForceScrollToBottom(scrolledAway)).toBe(false);
  });

  it("stays suppressed even as the content keeps growing while scrolled up", () => {
    const scrolledAway = isNearBottom({ scrollTop: 100, scrollHeight: 3000, clientHeight: 200 });
    expect(shouldForceScrollToBottom(scrolledAway)).toBe(false);
  });
});

describe("shouldForceScrollToBottom — 4. new answer restores normal follow behavior", () => {
  it("resumes following once near-bottom is reset to true (what a new answer card does)", () => {
    // AnswerArea resets isNearBottomRef.current = true whenever
    // activeResponseId changes (a brand-new answer card started) — modeled
    // here as the near-bottom flag flipping back to true regardless of where
    // the user had scrolled on the PREVIOUS answer.
    const resetForNewAnswer = true;
    expect(shouldForceScrollToBottom(resetForNewAnswer)).toBe(true);
  });
});
