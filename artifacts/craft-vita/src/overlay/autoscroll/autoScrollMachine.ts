/**
 * overlay/autoscroll/autoScrollMachine — framework-free auto-scroll state machine.
 *
 * The overlay answer pane streams tokens while the user may be reading. This
 * module owns every decision (pin, unlock, pill, question reset, keyboard,
 * resize, drag guard, persistence), with no DOM access, so it is deterministic
 * and unit-testable in the node test environment. The DOM adapter
 * (overlayAutoScroll.ts) only executes the commands this machine emits.
 *
 * UX contract:
 *  - sticky bottom while streaming;
 *  - scrolling up more than UNLOCK_DISTANCE_PX unlocks instantly and we never
 *    snap back (no fighting the user);
 *  - while unlocked, a "jump to latest" pill is shown; clicking it — or
 *    manually returning within RELOCK_DISTANCE_PX of the bottom — re-locks;
 *  - a new question resets the answer viewport, puts the question in view and
 *    follows the new answer;
 *  - resize/drag events never re-lock or steal position while the user is
 *    interacting;
 *  - prefers-reduced-motion turns animations into instant snaps.
 */

/** Scrolling up beyond this many px unlocks follow mode (strictly greater). */
export const UNLOCK_DISTANCE_PX = 24;
/** Being within this many px of the bottom re-locks follow mode. */
export const RELOCK_DISTANCE_PX = 2;
/** PageUp/PageDown/Space move by this fraction of the viewport height. */
export const PAGE_SCROLL_FRACTION = 0.9;
/** Gap kept between the question and the top of the viewport on reset. */
export const QUESTION_TOP_GAP_PX = 10;

export interface ScrollGeometry {
  /** Current scroll offset in px (0 = top). */
  offset: number;
  /** Maximum possible offset (contentHeight - viewportHeight, >= 0). */
  maxOffset: number;
  viewportHeight: number;
  contentHeight: number;
}

export interface SavedScrollPosition {
  offset: number;
  pinned: boolean;
  updatedAt: number;
}

export interface AutoScrollState {
  sessionId: string | null;
  /** Follow-mode: new content keeps the bottom in view. */
  pinned: boolean;
  /** Jump-to-latest pill visibility. */
  pillVisible: boolean;
  hasOverflow: boolean;
  distanceFromBottom: number;
  offset: number;
  maxOffset: number;
  viewportHeight: number;
  contentHeight: number;
  /** True while the user drags or resizes the overlay window. */
  dragging: boolean;
  reducedMotion: boolean;
  /** Increments on every new question (used by tests/telemetry). */
  questionVersion: number;
  /** Last command type emitted (diagnostics). */
  lastCommand: AutoScrollCommand["type"] | null;
}

export type AutoScrollKey = "PageUp" | "PageDown" | "Home" | "End" | "Space" | "Shift+Space";

export type AutoScrollEvent =
  | { type: "content-grew"; geometry: ScrollGeometry }
  | { type: "content-shrank"; geometry: ScrollGeometry }
  | { type: "user-scroll"; geometry: ScrollGeometry }
  | { type: "programmatic-scroll"; geometry: ScrollGeometry }
  | { type: "question-changed"; geometry?: ScrollGeometry }
  | { type: "jump-to-latest"; geometry: ScrollGeometry }
  | { type: "keyboard"; key: AutoScrollKey; geometry: ScrollGeometry }
  | { type: "resize"; geometry: ScrollGeometry }
  | { type: "drag-start" }
  | { type: "drag-end"; geometry: ScrollGeometry }
  | { type: "reduced-motion"; reduced: boolean }
  | {
      type: "session-opened";
      geometry: ScrollGeometry;
      saved: SavedScrollPosition | null;
    };

export type AutoScrollCommand =
  /** Keep the bottom pinned (instant; used per content growth frame). */
  | { type: "snap-bottom" }
  /** Animate to the bottom (pill click / jump-to-latest). */
  | { type: "animate-to-bottom" }
  /** Animate to an absolute offset (keyboard navigation). */
  | { type: "animate-to-offset"; offset: number }
  /** Put the detected question near the top of the viewport (new question). */
  | { type: "scroll-question-into-view" }
  /** Make sure the (reset) answer start is visible after the question jump. */
  | { type: "reset-answer-viewport" }
  | { type: "cancel-animation" }
  | { type: "show-pill" }
  | { type: "hide-pill" }
  /** Restore a persisted position on reopen (adapter clamps the offset). */
  | { type: "restore"; position: SavedScrollPosition };

export interface AutoScrollTransition {
  state: AutoScrollState;
  commands: AutoScrollCommand[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeGeometry(geometry: ScrollGeometry): ScrollGeometry {
  const maxOffset = Math.max(0, geometry.maxOffset);
  const offset = clamp(geometry.offset, 0, maxOffset);
  return {
    offset,
    maxOffset,
    viewportHeight: Math.max(0, geometry.viewportHeight),
    contentHeight: Math.max(0, geometry.contentHeight),
  };
}

export function distanceFromBottom(geometry: ScrollGeometry): number {
  const normalized = normalizeGeometry(geometry);
  return Math.max(0, normalized.maxOffset - normalized.offset);
}

export function hasOverflow(geometry: ScrollGeometry): boolean {
  return normalizeGeometry(geometry).maxOffset > 0;
}

/** Pure geometry of the scroll host, shared by the adapter and tests. */
export function geometryFrom(input: {
  offset: number;
  contentHeight: number;
  viewportHeight: number;
}): ScrollGeometry {
  return {
    offset: input.offset,
    maxOffset: Math.max(0, input.contentHeight - input.viewportHeight),
    viewportHeight: input.viewportHeight,
    contentHeight: input.contentHeight,
  };
}

export function createAutoScrollState(
  init: {
    sessionId?: string | null;
    pinned?: boolean;
    reducedMotion?: boolean;
  } = {},
): AutoScrollState {
  return {
    sessionId: init.sessionId ?? null,
    pinned: init.pinned ?? true,
    pillVisible: false,
    hasOverflow: false,
    distanceFromBottom: 0,
    offset: 0,
    maxOffset: 0,
    viewportHeight: 0,
    contentHeight: 0,
    dragging: false,
    reducedMotion: init.reducedMotion ?? false,
    questionVersion: 0,
    lastCommand: null,
  };
}

function withGeometry(state: AutoScrollState, geometry: ScrollGeometry): AutoScrollState {
  const normalized = normalizeGeometry(geometry);
  return {
    ...state,
    offset: normalized.offset,
    maxOffset: normalized.maxOffset,
    viewportHeight: normalized.viewportHeight,
    contentHeight: normalized.contentHeight,
    hasOverflow: normalized.maxOffset > 0,
    distanceFromBottom: Math.max(0, normalized.maxOffset - normalized.offset),
  };
}

function pinnedPillState(state: AutoScrollState): { pinned: boolean; pillVisible: boolean } {
  const pinned = state.pinned;
  return { pinned, pillVisible: !pinned && state.hasOverflow };
}

/**
 * Applies a command's *target* to the machine state. This keeps the machine
 * snapshot equal to the intended post-command position (the adapter performs
 * the real DOM write), so tests and telemetry never observe a stale offset.
 */
function applyCommandTarget(
  state: AutoScrollState,
  command: AutoScrollCommand,
): AutoScrollState {
  switch (command.type) {
    case "snap-bottom":
    case "animate-to-bottom":
      return { ...state, offset: state.maxOffset, distanceFromBottom: 0 };
    case "animate-to-offset": {
      const offset = clamp(command.offset, 0, state.maxOffset);
      return {
        ...state,
        offset,
        distanceFromBottom: Math.max(0, state.maxOffset - offset),
      };
    }
    case "restore": {
      const offset = command.position.pinned
        ? state.maxOffset
        : clamp(command.position.offset, 0, state.maxOffset);
      return {
        ...state,
        offset,
        distanceFromBottom: Math.max(0, state.maxOffset - offset),
      };
    }
    default:
      return state;
  }
}

function transition(
  state: AutoScrollState,
  next: AutoScrollState,
  commands: AutoScrollCommand[] = [],
): AutoScrollTransition {
  let finalState = { ...next };
  for (const command of commands) finalState = applyCommandTarget(finalState, command);
  finalState.lastCommand = commands.length
    ? commands[commands.length - 1]!.type
    : (state.lastCommand ?? null);
  return { state: finalState, commands };
}

function targetForPage(
  geometry: ScrollGeometry,
  direction: 1 | -1,
  fraction = PAGE_SCROLL_FRACTION,
): number {
  const normalized = normalizeGeometry(geometry);
  const delta = Math.max(1, Math.round(normalized.viewportHeight * fraction));
  return clamp(normalized.offset + delta * direction, 0, normalized.maxOffset);
}

/**
 * Apply the keyboard contract. Returns the target offset and whether the key is
 * handled at all (unknown keys are left to the browser/app).
 */
export function keyboardTarget(
  key: AutoScrollKey,
  geometry: ScrollGeometry,
): { handled: boolean; offset: number } {
  switch (key) {
    case "PageUp":
      return { handled: true, offset: targetForPage(geometry, -1) };
    case "PageDown":
    case "Space":
      return { handled: true, offset: targetForPage(geometry, 1) };
    case "Shift+Space":
      return { handled: true, offset: targetForPage(geometry, -1) };
    case "Home":
      return { handled: true, offset: 0 };
    case "End":
      return { handled: true, offset: Math.max(0, normalizeGeometry(geometry).maxOffset) };
    default:
      return { handled: false, offset: normalizeGeometry(geometry).offset };
  }
}

/**
 * The single reducer. Every user/environment event goes through here and the
 * adapter executes the returned commands in order.
 */
export function reduceAutoScroll(
  state: AutoScrollState,
  event: AutoScrollEvent,
): AutoScrollTransition {
  switch (event.type) {
    case "content-grew":
    case "content-shrank": {
      const next = withGeometry(state, event.geometry);
      if (event.type === "content-shrank") {
        // Reset/shrink never moves the viewport unless it was pinned.
        if (!next.hasOverflow) {
          // Keep the user's mode: a reopened/unlocked session renders its
          // transcript progressively and must not be silently re-pinned while
          // intermediate content is still shorter than the viewport.
          return transition(next, { ...next, offset: 0, distanceFromBottom: 0, pillVisible: false }, [
            { type: "cancel-animation" },
            { type: "hide-pill" },
          ]);
        }
        if (next.pinned) {
          return transition(next, { ...next }, [{ type: "snap-bottom" }]);
        }
        const { pillVisible } = pinnedPillState(next);
        return transition(next, { ...next, pillVisible }, pillVisible ? [{ type: "show-pill" }] : []);
      }

      if (!next.hasOverflow) {
        // Short answer: nothing to follow and no pill (no jump). Preserve the
        // current mode so progressive transcript rendering on reopen does not
        // clobber a restored unlocked position before the content overflows.
        return transition(
          next,
          {
            ...next,
            offset: 0,
            distanceFromBottom: 0,
            pillVisible: false,
            pinned: state.pinned,
          },
          next.pillVisible ? [{ type: "hide-pill" }] : [],
        );
      }
      if (next.dragging) {
        // Window drag/resize in progress: never move the content under the user.
        return transition(next, { ...next, pillVisible: !next.pinned });
      }
      if (next.pinned) {
        return transition(next, { ...next, pillVisible: false }, [{ type: "snap-bottom" }]);
      }
      const pillVisible = next.hasOverflow;
      return transition(
        next,
        { ...next, pillVisible },
        pillVisible && !state.pillVisible ? [{ type: "show-pill" }] : [],
      );
    }

    case "user-scroll": {
      const next = withGeometry(state, event.geometry);
      const distance = next.distanceFromBottom;
      if (distance > UNLOCK_DISTANCE_PX) {
        // Unlock instantly; no snap-back command.
        return transition(
          next,
          { ...next, pinned: false, pillVisible: next.hasOverflow },
          [{ type: "cancel-animation" }, ...(next.hasOverflow ? [{ type: "show-pill" as const }] : [])],
        );
      }
      if (distance <= RELOCK_DISTANCE_PX) {
        // Manual return to the bottom re-locks and snaps the final sub-pixel.
        return transition(
          next,
          { ...next, pinned: true, pillVisible: false },
          [{ type: "snap-bottom" }, { type: "hide-pill" }],
        );
      }
      // Inside the hysteresis band: keep current mode but refresh pill state.
      const pillVisible = !next.pinned && next.hasOverflow;
      return transition(next, { ...next, pillVisible });
    }

    case "programmatic-scroll": {
      // Our own writes never change the mode.
      const next = withGeometry(state, event.geometry);
      return transition(next, next, []);
    }

    case "question-changed": {
      const base = event.geometry ? withGeometry(state, event.geometry) : state;
      const next: AutoScrollState = {
        ...base,
        pinned: true,
        pillVisible: false,
        questionVersion: state.questionVersion + 1,
      };
      return transition(next, next, [
        { type: "cancel-animation" },
        { type: "scroll-question-into-view" },
        { type: "reset-answer-viewport" },
        { type: "hide-pill" },
      ]);
    }

    case "jump-to-latest": {
      const next = withGeometry(state, event.geometry);
      return transition(
        { ...next, pinned: true, pillVisible: false },
        { ...next, pinned: true, pillVisible: false },
        [{ type: "animate-to-bottom" }, { type: "hide-pill" }],
      );
    }

    case "keyboard": {
      const next = withGeometry(state, event.geometry);
      const target = keyboardTarget(event.key, event.geometry);
      if (!target.handled) return transition(next, next, []);
      const distance = Math.max(0, next.maxOffset - target.offset);
      const atBottom = distance <= RELOCK_DISTANCE_PX;
      const unlock = distance > UNLOCK_DISTANCE_PX;
      const pinned = atBottom ? true : unlock ? false : next.pinned;
      const pillVisible = !pinned && next.hasOverflow;
      const commands: AutoScrollCommand[] = [
        { type: "cancel-animation" },
        { type: "animate-to-offset", offset: target.offset },
        ...(atBottom ? [{ type: "hide-pill" as const }] : []),
        ...(pillVisible ? [{ type: "show-pill" as const }] : []),
      ];
      return transition(next, { ...next, pinned, pillVisible }, commands);
    }

    case "resize": {
      const next = withGeometry(state, event.geometry);
      if (!next.hasOverflow) {
        return transition(
          next,
          { ...next, offset: 0, distanceFromBottom: 0, pinned: true, pillVisible: false },
          [{ type: "cancel-animation" }, { type: "hide-pill" }],
        );
      }
      if (next.dragging) {
        return transition(next, { ...next, pillVisible: !next.pinned });
      }
      if (next.pinned) {
        return transition(next, { ...next, pillVisible: false }, [{ type: "snap-bottom" }]);
      }
      return transition(
        next,
        { ...next, pillVisible: true },
        next.pillVisible ? [] : [{ type: "show-pill" }],
      );
    }

    case "drag-start":
      return transition({ ...state, dragging: true }, { ...state, dragging: true }, [
        { type: "cancel-animation" },
      ]);

    case "drag-end": {
      const next = withGeometry(state, event.geometry);
      const pinned = next.pinned;
      const pillVisible = !pinned && next.hasOverflow;
      return transition(
        { ...next, dragging: false, pillVisible },
        { ...next, dragging: false, pillVisible },
        next.pinned && next.hasOverflow ? [{ type: "snap-bottom" }] : [],
      );
    }

    case "reduced-motion":
      return transition({ ...state, reducedMotion: event.reduced }, { ...state, reducedMotion: event.reduced }, []);

    case "session-opened": {
      const next = withGeometry(state, event.geometry);
      const saved = event.saved;
      if (!saved) {
        return transition(
          { ...next, sessionId: state.sessionId, pinned: true, pillVisible: false },
          { ...next, sessionId: state.sessionId, pinned: true, pillVisible: false },
          next.hasOverflow ? [{ type: "snap-bottom" }] : [],
        );
      }
      if (saved.pinned) {
        return transition(
          { ...next, pinned: true, pillVisible: false },
          { ...next, pinned: true, pillVisible: false },
          next.hasOverflow ? [{ type: "snap-bottom" }] : [],
        );
      }
      const restoredOffset = clamp(saved.offset, 0, next.maxOffset);
      const distance = Math.max(0, next.maxOffset - restoredOffset);
      // A reopened session may render its transcript AFTER the controller is
      // constructed; with no content yet there is no geometry to trust, so keep
      // the saved unlocked mode and let the adapter apply the offset as content
      // arrives (instead of silently pinning to an empty pane).
      const laidOut = next.maxOffset > 0;
      const pinned = laidOut ? distance <= RELOCK_DISTANCE_PX : false;
      const pillVisible = !pinned && next.hasOverflow;
      // The command keeps the RAW saved offset: when a reopened transcript has
      // not rendered yet (`next.maxOffset === 0`) the adapter must remember the
      // saved position and re-apply it once content arrives.
      return transition(next, { ...next, offset: restoredOffset, pinned, pillVisible }, [
        { type: "restore", position: saved },
        ...(pillVisible ? [{ type: "show-pill" as const }] : [{ type: "hide-pill" as const }]),
      ]);
    }

    default:
      return transition(state, state, []);
  }
}

/** Position to persist for the current state. */
export function serializeScrollPosition(
  state: AutoScrollState,
  now: number,
): SavedScrollPosition {
  return {
    offset: Math.round(state.offset),
    pinned: state.pinned,
    updatedAt: now,
  };
}

export const SCROLL_STORAGE_PREFIX = "hireshade.overlay.scroll.v1";

export function scrollStorageKey(sessionId: string): string {
  return SCROLL_STORAGE_PREFIX + ":" + sessionId;
}

/** Parses a persisted payload defensively (storage may be missing/corrupt). */
export function parseSavedScrollPosition(raw: string | null): SavedScrollPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedScrollPosition>;
    if (
      typeof value.offset !== "number" ||
      !Number.isFinite(value.offset) ||
      typeof value.pinned !== "boolean"
    ) {
      return null;
    }
    return {
      offset: Math.max(0, value.offset),
      pinned: value.pinned,
      updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    };
  } catch {
    return null;
  }
}
