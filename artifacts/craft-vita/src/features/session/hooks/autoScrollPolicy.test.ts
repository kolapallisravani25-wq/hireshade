import { describe, expect, it } from "vitest";
import {
  decideAutoScrollOnAppend,
  nextResponseIndexOnToggle,
} from "./autoScrollPolicy";

describe("decideAutoScrollOnAppend", () => {
  it("does nothing when the response count is unchanged", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 3,
        currentIndex: 0,
        autoScroll: true,
      }),
    ).toEqual({ type: "none" });
  });

  it("does nothing when the list shrinks (reset/cleanup)", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 5,
        currLen: 2,
        currentIndex: 1,
        autoScroll: true,
      }),
    ).toEqual({ type: "none" });
  });

  it("does nothing when prevLen is 0 and currLen is 0", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 0,
        currLen: 0,
        currentIndex: 0,
        autoScroll: false,
      }),
    ).toEqual({ type: "none" });
  });

  it("jumps to index 0 on the first response, even with auto-scroll off", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 0,
        currLen: 1,
        currentIndex: 0,
        autoScroll: false,
      }),
    ).toEqual({ type: "first-arrived", index: 0 });
  });

  it("jumps to index 0 when several responses arrive at once from empty", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 0,
        currLen: 3,
        currentIndex: 0,
        autoScroll: false,
      }),
    ).toEqual({ type: "first-arrived", index: 0 });
  });

  it("always advances to the newest card when auto-scroll is on", () => {
    // User is browsing an old card (index 0) with 3 responses; a 4th arrives.
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 4,
        currentIndex: 0,
        autoScroll: true,
      }),
    ).toEqual({ type: "advance", index: 3 });
  });

  it("advances when auto-scroll is off but the user was already on the latest card", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 4,
        currentIndex: 2, // prevLen - 1
        autoScroll: false,
      }),
    ).toEqual({ type: "advance", index: 3 });
  });

  it("preserves manual browsing when auto-scroll is off and the user is on an older card", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 4,
        currentIndex: 1,
        autoScroll: false,
      }),
    ).toEqual({ type: "none" });
  });

  it("clamps the advance index to currLen - 1 even with a wildly stale currentIndex", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 4,
        currentIndex: 999,
        autoScroll: false,
      }),
    ).toEqual({ type: "advance", index: 3 });
  });

  it("preserves manual browsing for a negative currentIndex", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 3,
        currLen: 4,
        currentIndex: -1,
        autoScroll: false,
      }),
    ).toEqual({ type: "none" });
  });

  it("advances from a single-card state when auto-scroll is on", () => {
    expect(
      decideAutoScrollOnAppend({
        prevLen: 1,
        currLen: 2,
        currentIndex: 0,
        autoScroll: true,
      }),
    ).toEqual({ type: "advance", index: 1 });
  });
});

describe("nextResponseIndexOnToggle", () => {
  it("returns the latest index when enabling with responses present", () => {
    expect(nextResponseIndexOnToggle(true, 3)).toBe(2);
  });

  it("returns null when enabling with no responses yet", () => {
    expect(nextResponseIndexOnToggle(true, 0)).toBeNull();
  });

  it("returns null when disabling, regardless of response count", () => {
    expect(nextResponseIndexOnToggle(false, 5)).toBeNull();
    expect(nextResponseIndexOnToggle(false, 0)).toBeNull();
  });
});
