import { describe, expect, it } from "vitest";
import {
  RELOCK_DISTANCE_PX,
  UNLOCK_DISTANCE_PX,
  createAutoScrollState,
  distanceFromBottom,
  geometryFrom,
  keyboardTarget,
  parseSavedScrollPosition,
  reduceAutoScroll,
  scrollStorageKey,
  serializeScrollPosition,
  type AutoScrollState,
  type ScrollGeometry,
} from "./autoScrollMachine";

const VIEWPORT = 200;
/** Long answer: content far taller than the viewport. */
function longGeometry(offset: number, contentHeight = 1000): ScrollGeometry {
  return geometryFrom({ offset, contentHeight, viewportHeight: VIEWPORT });
}
function shortGeometry(offset = 0): ScrollGeometry {
  return geometryFrom({ offset, contentHeight: 120, viewportHeight: VIEWPORT });
}
function pinnedState(): AutoScrollState {
  return reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
    type: "session-opened",
    geometry: longGeometry(800),
    saved: null,
  }).state;
}
function unlockedState(offset = 600): AutoScrollState {
  const opened = pinnedState();
  return reduceAutoScroll(opened, { type: "user-scroll", geometry: longGeometry(offset) }).state;
}

describe("geometry helpers", () => {
  it("computes max offset and distance from bottom", () => {
    expect(longGeometry(0).maxOffset).toBe(800);
    expect(distanceFromBottom(longGeometry(800))).toBe(0);
    expect(distanceFromBottom(longGeometry(760))).toBe(40);
    expect(distanceFromBottom({ offset: 2000, maxOffset: 800, viewportHeight: 200, contentHeight: 1000 })).toBe(0);
  });

  it("treats content shorter than the viewport as no-overflow", () => {
    const geometry = shortGeometry();
    expect(geometry.maxOffset).toBe(0);
    expect(distanceFromBottom(geometry)).toBe(0);
  });
});

describe("sticky bottom while streaming", () => {
  it("snaps to the bottom on content growth while pinned", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "content-grew",
      geometry: longGeometry(0),
    });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.distanceFromBottom).toBe(0);
    expect(transition.commands).toEqual([{ type: "snap-bottom" }]);
  });

  it("stays pinned for a 200-token stream (200 growth events, always bottom)", () => {
    let state = createAutoScrollState({ sessionId: "s1" });
    let contentHeight = 300;
    for (let token = 0; token < 200; token++) {
      contentHeight += 14;
      const transition = reduceAutoScroll(state, {
        type: "content-grew",
        geometry: geometryFrom({ offset: contentHeight - VIEWPORT, contentHeight, viewportHeight: VIEWPORT }),
      });
      state = transition.state;
      expect(state.pinned).toBe(true);
      expect(state.distanceFromBottom).toBe(0);
      expect(transition.commands).toEqual([{ type: "snap-bottom" }]);
    }
    expect(state.maxOffset).toBe(200 * 14 + 100);
  });

  it("never scrolls or shows a pill for a short answer with no overflow", () => {
    const opened = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: shortGeometry(),
      saved: null,
    });
    expect(opened.commands).toEqual([]);
    const grown = reduceAutoScroll(opened.state, { type: "content-grew", geometry: shortGeometry() });
    expect(grown.state.pinned).toBe(true);
    expect(grown.state.pillVisible).toBe(false);
    expect(grown.commands).not.toContainEqual({ type: "snap-bottom" });
  });
});

describe("24px unlock hysteresis", () => {
  it("keeps following when the user scrolls up less than the unlock distance", () => {
    const transition = reduceAutoScroll(pinnedState(), {
      type: "user-scroll",
      geometry: longGeometry(800 - (UNLOCK_DISTANCE_PX - 1)),
    });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.pillVisible).toBe(false);
    expect(transition.commands).toEqual([]);
  });

  it("unlocks instantly past 24px without a snap-back command", () => {
    const transition = reduceAutoScroll(pinnedState(), {
      type: "user-scroll",
      geometry: longGeometry(800 - (UNLOCK_DISTANCE_PX + 1)),
    });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.pillVisible).toBe(true);
    expect(transition.state.distanceFromBottom).toBe(UNLOCK_DISTANCE_PX + 1);
    expect(transition.commands).toEqual([
      { type: "cancel-animation" },
      { type: "show-pill" },
    ]);
    expect(transition.commands.some((command) => command.type === "snap-bottom")).toBe(false);
  });

  it("does not snap back while unlocked as content keeps streaming", () => {
    let state = unlockedState(600);
    const offsetBefore = state.offset;
    for (let i = 0; i < 20; i++) {
      const transition = reduceAutoScroll(state, {
        type: "content-grew",
        geometry: { ...longGeometry(offsetBefore), contentHeight: 1000 + i * 20, maxOffset: 800 + i * 20 },
      });
      state = transition.state;
      expect(transition.commands.some((command) => command.type === "snap-bottom")).toBe(false);
      expect(state.pinned).toBe(false);
      expect(state.pillVisible).toBe(true);
      expect(state.offset).toBe(offsetBefore);
    }
  });

  it("stays unlocked through the hysteresis band (25..2 px)", () => {
    let state = unlockedState(700); // 100px from bottom
    state = reduceAutoScroll(state, { type: "user-scroll", geometry: longGeometry(770) }).state;
    expect(state.pinned).toBe(false);
    expect(state.pillVisible).toBe(true);
    expect(state.distanceFromBottom).toBe(30);
  });

  it("re-locks when the user manually returns within 2px of the bottom", () => {
    const transition = reduceAutoScroll(unlockedState(600), {
      type: "user-scroll",
      geometry: longGeometry(800 - RELOCK_DISTANCE_PX),
    });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.pillVisible).toBe(false);
    expect(transition.commands).toEqual([{ type: "snap-bottom" }, { type: "hide-pill" }]);
  });

  it("ignores programmatic scroll writes for mode changes", () => {
    const unlocked = unlockedState(600);
    const transition = reduceAutoScroll(unlocked, {
      type: "programmatic-scroll",
      geometry: longGeometry(800),
    });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.pillVisible).toBe(true);
    expect(transition.commands).toEqual([]);
  });
});

describe("jump-to-latest pill", () => {
  it("re-locks and animates to the bottom", () => {
    const transition = reduceAutoScroll(unlockedState(600), {
      type: "jump-to-latest",
      geometry: longGeometry(600),
    });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.pillVisible).toBe(false);
    expect(transition.commands).toEqual([
      { type: "animate-to-bottom" },
      { type: "hide-pill" },
    ]);
  });
});

describe("new question", () => {
  it("scrolls the question into view, resets the answer pane and follows", () => {
    const unlocked = unlockedState(200);
    const transition = reduceAutoScroll(unlocked, {
      type: "question-changed",
      geometry: longGeometry(200),
    });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.pillVisible).toBe(false);
    expect(transition.state.questionVersion).toBe(1);
    expect(transition.commands).toEqual([
      { type: "cancel-animation" },
      { type: "scroll-question-into-view" },
      { type: "reset-answer-viewport" },
      { type: "hide-pill" },
    ]);
    // The following answer growth keeps the new answer pinned to the bottom.
    const grown = reduceAutoScroll(transition.state, {
      type: "content-grew",
      geometry: longGeometry(900, 1100),
    });
    expect(grown.commands).toEqual([{ type: "snap-bottom" }]);
  });
});

describe("keyboard", () => {
  it("maps keys to the correct target offsets", () => {
    expect(keyboardTarget("PageUp", longGeometry(800))).toEqual({ handled: true, offset: 620 });
    expect(keyboardTarget("PageDown", longGeometry(800))).toEqual({ handled: true, offset: 800 });
    expect(keyboardTarget("PageDown", longGeometry(0))).toEqual({ handled: true, offset: 180 });
    expect(keyboardTarget("Home", longGeometry(800))).toEqual({ handled: true, offset: 0 });
    expect(keyboardTarget("End", longGeometry(100))).toEqual({ handled: true, offset: 800 });
    expect(keyboardTarget("Space", longGeometry(0))).toEqual({ handled: true, offset: 180 });
    expect(keyboardTarget("Shift+Space", longGeometry(800))).toEqual({ handled: true, offset: 620 });
  });

  it("PageUp unlocks and shows the pill", () => {
    const transition = reduceAutoScroll(pinnedState(), { type: "keyboard", key: "PageUp", geometry: longGeometry(800) });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.pillVisible).toBe(true);
    expect(transition.commands).toContainEqual({ type: "animate-to-offset", offset: 620 });
    expect(transition.commands).toContainEqual({ type: "show-pill" });
  });

  it("End re-locks and hides the pill", () => {
    const transition = reduceAutoScroll(unlockedState(300), { type: "keyboard", key: "End", geometry: longGeometry(300) });
    expect(transition.state.pinned).toBe(true);
    expect(transition.state.pillVisible).toBe(false);
    expect(transition.commands).toContainEqual({ type: "animate-to-offset", offset: 800 });
    expect(transition.commands).toContainEqual({ type: "hide-pill" });
  });

  it("Home unlocks only when the content overflows", () => {
    const long = reduceAutoScroll(pinnedState(), { type: "keyboard", key: "Home", geometry: longGeometry(800) });
    expect(long.state.pinned).toBe(false);
    expect(long.state.pillVisible).toBe(true);
    const short = reduceAutoScroll(pinnedState(), { type: "keyboard", key: "Home", geometry: shortGeometry() });
    expect(short.state.pinned).toBe(true);
    expect(short.state.pillVisible).toBe(false);
  });

  it("PageDown / Space from a mid position keeps browsing until the bottom", () => {
    const mid = unlockedState(200);
    const pageDown = reduceAutoScroll(mid, { type: "keyboard", key: "PageDown", geometry: longGeometry(200) });
    expect(pageDown.state.pinned).toBe(false);
    expect(pageDown.state.pillVisible).toBe(true);
    const space = reduceAutoScroll(mid, { type: "keyboard", key: "Space", geometry: longGeometry(200) });
    expect(space.state.offset).toBe(380);
  });
});

describe("resize / drag guards", () => {
  it("keeps the bottom pinned on resize", () => {
    const transition = reduceAutoScroll(pinnedState(), { type: "resize", geometry: longGeometry(800, 1200) });
    expect(transition.commands).toEqual([{ type: "snap-bottom" }]);
    expect(transition.state.pinned).toBe(true);
  });

  it("keeps pill visible for an unlocked viewport on resize", () => {
    const transition = reduceAutoScroll(unlockedState(600), { type: "resize", geometry: longGeometry(600, 1200) });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.pillVisible).toBe(true);
  });

  it("does not snap content while the window is being dragged", () => {
    const dragging = reduceAutoScroll(pinnedState(), { type: "drag-start" });
    const growth = reduceAutoScroll(dragging.state, { type: "content-grew", geometry: longGeometry(400, 1000) });
    expect(growth.commands).toEqual([]);
    expect(growth.state.dragging).toBe(true);
    expect(growth.state.pinned).toBe(true);
    const resized = reduceAutoScroll(dragging.state, { type: "resize", geometry: longGeometry(400, 1000) });
    expect(resized.commands).toEqual([]);
    const ended = reduceAutoScroll(dragging.state, { type: "drag-end", geometry: longGeometry(800, 1000) });
    expect(ended.state.dragging).toBe(false);
    expect(ended.commands).toEqual([{ type: "snap-bottom" }]);
  });
});

describe("reduced motion", () => {
  it("tracks the preference for the adapter to use", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "reduced-motion",
      reduced: true,
    });
    expect(transition.state.reducedMotion).toBe(true);
    const question = reduceAutoScroll(transition.state, {
      type: "question-changed",
      geometry: longGeometry(300),
    });
    // The machine never emits animation-flag commands; the adapter collapses
    // them to instant writes when reducedMotion is set.
    expect(question.commands).toContainEqual({ type: "scroll-question-into-view" });
  });
});

describe("per-session persistence", () => {
  it("restores a pinned session at the bottom", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: longGeometry(0),
      saved: { offset: 0, pinned: true, updatedAt: 1 },
    });
    expect(transition.commands).toEqual([{ type: "snap-bottom" }]);
    expect(transition.state.pinned).toBe(true);
  });

  it("restores an unlocked offset and shows the pill", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: longGeometry(0),
      saved: { offset: 300, pinned: false, updatedAt: 1 },
    });
    expect(transition.commands[0]).toEqual({
      type: "restore",
      position: { offset: 300, pinned: false, updatedAt: 1 },
    });
    expect(transition.commands).toContainEqual({ type: "show-pill" });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.offset).toBe(300);
    expect(transition.state.pillVisible).toBe(true);
  });

  it("clamps state but forwards the raw saved offset for late content", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: longGeometry(0),
      saved: { offset: 99_999, pinned: false, updatedAt: 1 },
    });
    const restore = transition.commands.find((command) => command.type === "restore");
    // The adapter clamps to its current geometry; forwarding the raw value lets
    // it re-apply the position if the transcript renders later and grows.
    expect(restore).toEqual({ type: "restore", position: { offset: 99_999, pinned: false, updatedAt: 1 } });
    expect(transition.state.offset).toBe(800);
  });

  it("keeps the saved unlocked mode when a reopened session has no content yet", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: { offset: 0, maxOffset: 0, viewportHeight: 200, contentHeight: 120 },
      saved: { offset: 500, pinned: false, updatedAt: 1 },
    });
    expect(transition.state.pinned).toBe(false);
    expect(transition.state.offset).toBe(0);
    expect(transition.commands[0]).toEqual({
      type: "restore",
      position: { offset: 500, pinned: false, updatedAt: 1 },
    });
  });

  it("treats a saved position within 2px as pinned", () => {
    const transition = reduceAutoScroll(createAutoScrollState({ sessionId: "s1" }), {
      type: "session-opened",
      geometry: longGeometry(0),
      saved: { offset: 799, pinned: false, updatedAt: 1 },
    });
    expect(transition.state.pinned).toBe(true);
  });

  it("serializes and namespaces the storage key", () => {
    const state = unlockedState(600);
    expect(serializeScrollPosition(state, 42)).toEqual({ offset: 600, pinned: false, updatedAt: 42 });
    expect(scrollStorageKey("abc")).toBe("hireshade.overlay.scroll.v1:abc");
  });

  it("parses stored payloads defensively", () => {
    expect(parseSavedScrollPosition(null)).toBeNull();
    expect(parseSavedScrollPosition("not json")).toBeNull();
    expect(parseSavedScrollPosition('{"offset":"10","pinned":true}')).toBeNull();
    expect(parseSavedScrollPosition('{"offset":-5,"pinned":true,"updatedAt":7}')).toEqual({
      offset: 0,
      pinned: true,
      updatedAt: 7,
    });
    expect(parseSavedScrollPosition('{"offset":42,"pinned":false}')).toEqual({
      offset: 42,
      pinned: false,
      updatedAt: 0,
    });
  });
});
