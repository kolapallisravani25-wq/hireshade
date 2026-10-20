/**
 * overlay/autoscroll/overlayAutoScroll — DOM adapter for the auto-scroll machine.
 *
 * Framework-free (no React/Vue), dependency-free, and written against a narrow
 * slice of the DOM so it can be unit-tested with a fake DOM and instrumented
 * through Electron/CDP.
 *
 * Responsibilities:
 *  - own the transform-based virtual scroll (viewport overflow hidden + content
 *    translated with translate3d, so animation never fights native smooth
 *    scrolling or user input);
 *  - use ResizeObserver only (no polling) to detect content/viewport changes;
 *  - execute the machine's commands (snap/animate/pill/question restore);
 *  - persist per-session position in storage and restore on reopen;
 *  - set answer-pane ARIA live semantics (role=log, aria-live=polite);
 *  - never call focus() and never move content while a drag/resize is active;
 *  - honour prefers-reduced-motion (instant snaps, no animation frames);
 *  - instrument per-frame update cost and rAF intervals for the frame budget.
 */
import {
  QUESTION_TOP_GAP_PX,
  RELOCK_DISTANCE_PX,
  createAutoScrollState,
  distanceFromBottom,
  geometryFrom,
  parseSavedScrollPosition,
  reduceAutoScroll,
  scrollStorageKey,
  serializeScrollPosition,
  type AutoScrollCommand,
  type AutoScrollEvent,
  type AutoScrollKey,
  type AutoScrollState,
  type SavedScrollPosition,
  type ScrollGeometry,
} from "./autoScrollMachine";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ResizeObserverLike {
  observe(target: unknown): void;
  disconnect(): void;
}

export interface AutoScrollElements {
  /** Clipping element (overflow hidden). */
  viewport: HTMLElement;
  /** Translated content element inside the viewport. */
  content: HTMLElement;
  /** Detected-question element inside content (optional). */
  question?: HTMLElement | null;
  /** Answer element inside content; receives ARIA live semantics. */
  answer?: HTMLElement | null;
  /** Jump-to-latest control (button). */
  pill: HTMLElement;
}

export interface OverlayAutoScrollOptions {
  sessionId: string;
  elements: AutoScrollElements;
  /** localStorage/sessionStorage-like; defaults to window.localStorage when available. */
  storage?: StorageLike | null;
  document?: Document;
  window?: Window;
  /** Override the media query (tests). */
  reducedMotion?: boolean;
  animationMs?: number;
  now?: () => number;
  raf?: (callback: FrameRequestCallback) => number;
  caf?: (handle: number) => void;
  resizeObserverFactory?: (callback: ResizeObserverCallback) => ResizeObserverLike;
  questionTopGapPx?: number;
  onFrame?: (stats: FrameStats) => void;
}

export interface FrameStats {
  /** Number of applied scroll updates. */
  frames: number;
  /** Max wall time of one update (measure + transform write), ms. */
  maxUpdateMs: number;
  /** Max rAF interval between applied updates, ms. */
  maxFrameIntervalMs: number;
  lastUpdateMs: number;
  lastFrameIntervalMs: number;
}

export interface OverlayAutoScrollSnapshot extends AutoScrollState {
  offset: number;
  maxOffset: number;
  distanceFromBottom: number;
}

export interface OverlayAutoScroll {
  readonly sessionId: string;
  notifyContentChanged(): void;
  notifyQuestionChanged(): void;
  jumpToLatest(): void;
  scrollBy(delta: number): void;
  scrollTo(offset: number): void;
  setDragging(dragging: boolean): void;
  handleKey(key: AutoScrollKey): boolean;
  getSnapshot(): OverlayAutoScrollSnapshot;
  getFrameStats(): FrameStats;
  getOffset(): number;
  getSaveCount(): number;
  destroy(): void;
}

const DEFAULT_ANIMATION_MS = 140;
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const KEY_MAP: Record<string, AutoScrollKey> = {
  PageUp: "PageUp",
  PageDown: "PageDown",
  Home: "Home",
  End: "End",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number): number {
  const p = clamp(t, 0, 1);
  return 1 - Math.pow(1 - p, 3);
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element !== "object") return false;
  if (element.isContentEditable) return true;
  const tag = (element.tagName ?? "").toUpperCase();
  if (EDITABLE_TAGS.has(tag)) return true;
  const role = element.getAttribute?.("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

function defaultReducedMotion(win: Window | undefined): boolean {
  try {
    return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
}

export function createOverlayAutoScroll(
  options: OverlayAutoScrollOptions,
): OverlayAutoScroll {
  const { viewport, content, question, answer, pill } = options.elements;
  const doc = options.document ?? viewport.ownerDocument;
  const win = options.window ?? doc?.defaultView ?? undefined;
  const now = options.now ?? (() => (win?.performance ?? performance).now());
  const raf =
    options.raf ??
    ((callback: FrameRequestCallback) => (win?.requestAnimationFrame ?? requestAnimationFrame)(callback));
  const caf =
    options.caf ??
    ((handle: number) => (win?.cancelAnimationFrame ?? cancelAnimationFrame)(handle));
  const animationMs = options.animationMs ?? DEFAULT_ANIMATION_MS;
  const questionTopGapPx = options.questionTopGapPx ?? QUESTION_TOP_GAP_PX;
  const storage: StorageLike | null =
    options.storage !== undefined
      ? options.storage
      : (() => {
          try {
            return win?.localStorage ?? null;
          } catch {
            return null;
          }
        })();
  const storageKey = scrollStorageKey(options.sessionId);

  const frameStats: FrameStats = {
    frames: 0,
    maxUpdateMs: 0,
    maxFrameIntervalMs: 0,
    lastUpdateMs: 0,
    lastFrameIntervalMs: 0,
  };

  let destroyed = false;
  let state: AutoScrollState = createAutoScrollState({
    sessionId: options.sessionId,
    reducedMotion: options.reducedMotion ?? defaultReducedMotion(win),
  });
  let offset = 0;
  let contentHeight = 0;
  let viewportHeight = 0;
  let savedPosition: SavedScrollPosition | null = readSaved();
  let opened = false;
  // When a session reopens before its transcript re-renders, remember the saved
  // offset and re-apply it as content arrives (clamped to the current geometry).
  let pendingRestoreOffset: number | null = null;
  let animationHandle: number | null = null;
  let animationStart = 0;
  let animationFrom = 0;
  let animationTo = 0;
  let animationActive = false;
  let lastFrameAt = 0;
  let saveCount = 0;
  // -Infinity so the very first position (usually the opener) is persisted
  // immediately instead of being swallowed by the 150 ms throttle window.
  let lastSavedAt = Number.NEGATIVE_INFINITY;
  let pendingSave = false;

  // ── DOM setup ──────────────────────────────────────────────────────────────
  viewport.setAttribute("data-autoscroll-viewport", "");
  content.setAttribute("data-autoscroll-content", "");
  viewport.style.overflow = "hidden";
  viewport.style.position = viewport.style.position || "relative";
  content.style.willChange = "transform";
  content.style.transformOrigin = "top left";
  if (answer) {
    answer.setAttribute("role", "log");
    answer.setAttribute("aria-live", "polite");
    answer.setAttribute("aria-atomic", "false");
    answer.setAttribute("aria-relevant", "additions text");
  }
  pill.setAttribute("role", "button");
  pill.setAttribute("aria-label", "Jump to latest answer");
  pill.setAttribute("tabindex", "0");
  setPillVisible(false);

  function readSaved(): SavedScrollPosition | null {
    try {
      return parseSavedScrollPosition(storage?.getItem(storageKey) ?? null);
    } catch {
      return null;
    }
  }

  function maxOffset(): number {
    return Math.max(0, contentHeight - viewportHeight);
  }

  function geometry(): ScrollGeometry {
    return geometryFrom({ offset, contentHeight, viewportHeight });
  }

  function snapshotGeometry(): ScrollGeometry {
    return { ...geometry(), offset: clamp(offset, 0, maxOffset()) };
  }

  function measure(): { contentChanged: boolean; viewportChanged: boolean; geometry: ScrollGeometry } {
    const previousContent = contentHeight;
    const previousViewport = viewportHeight;
    viewportHeight = Math.max(
      0,
      viewport.clientHeight || viewport.getBoundingClientRect?.().height || 0,
    );
    contentHeight = Math.max(
      0,
      content.scrollHeight ||
        content.getBoundingClientRect?.().height ||
        content.offsetHeight ||
        0,
    );
    return {
      contentChanged: contentHeight !== previousContent,
      viewportChanged: viewportHeight !== previousViewport,
      geometry: geometry(),
    };
  }

  function recordFrame(updateStartedAt: number): void {
    const at = now();
    const updateMs = at - updateStartedAt;
    const frameInterval = lastFrameAt > 0 ? at - lastFrameAt : updateMs;
    lastFrameAt = at;
    frameStats.frames += 1;
    frameStats.lastUpdateMs = updateMs;
    frameStats.lastFrameIntervalMs = frameInterval;
    if (updateMs > frameStats.maxUpdateMs) frameStats.maxUpdateMs = updateMs;
    if (frameInterval > frameStats.maxFrameIntervalMs) frameStats.maxFrameIntervalMs = frameInterval;
    options.onFrame?.(frameStats);
  }

  function writeTransform(nextOffset: number, countFrame: boolean): void {
    const startedAt = now();
    offset = clamp(nextOffset, 0, maxOffset());
    content.style.transform = "translate3d(0px, " + -offset + "px, 0px)";
    if (countFrame) recordFrame(startedAt);
  }

  function dispatchEvent(event: AutoScrollEvent): void {
    if (destroyed) return;
    const transition = reduceAutoScroll(state, event);
    state = transition.state;
    executeCommands(transition.commands);
    // User-driven state changes are persisted immediately: a trailing throttle
    // window would otherwise lose the final "scrolled up" position when the
    // user stops interacting (nothing would schedule the flush).
    switch (event.type) {
      case "user-scroll":
      case "jump-to-latest":
      case "question-changed":
      case "drag-end":
      case "session-opened":
        forcePersist();
        break;
      case "content-grew":
      case "content-shrank":
        if (state.pinned && state.hasOverflow) schedulePersist();
        break;
      default:
        break;
    }
  }

  function schedulePersist(): void {
    if (!storage || pendingSave) return;
    const at = now();
    // Coalesce rapid streaming scroll events; keep at most ~6 writes/second.
    if (at - lastSavedAt < 150) return;
    lastSavedAt = at;
    pendingSave = true;
    raf(() => {
      pendingSave = false;
      if (destroyed) return;
      try {
        storage.setItem(storageKey, JSON.stringify(serializeScrollPosition(state, now())));
        saveCount += 1;
      } catch {
        /* quota/unavailable — persistence is best-effort */
      }
    });
  }

  function forcePersist(): void {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(serializeScrollPosition(state, now())));
      saveCount += 1;
      lastSavedAt = now();
    } catch {
      /* best effort */
    }
  }

  function setPillVisible(visible: boolean): void {
    pill.hidden = !visible;
    pill.setAttribute("aria-hidden", visible ? "false" : "true");
    pill.setAttribute("data-visible", visible ? "true" : "false");
  }

  function cancelAnimation(): void {
    animationActive = false;
    if (animationHandle !== null) {
      caf(animationHandle);
      animationHandle = null;
    }
  }

  function animateTo(target: number): void {
    const clamped = clamp(target, 0, maxOffset());
    if (!state.hasOverflow && maxOffset() === 0) {
      writeTransform(0, true);
      return;
    }
    if (state.reducedMotion || animationMs <= 0 || Math.abs(clamped - offset) < 0.5) {
      cancelAnimation();
      writeTransform(clamped, true);
      return;
    }
    cancelAnimation();
    animationActive = true;
    animationFrom = offset;
    animationTo = clamped;
    animationStart = now();
    const step = () => {
      if (!animationActive || destroyed) return;
      const elapsed = now() - animationStart;
      const t = animationMs <= 0 ? 1 : elapsed / animationMs;
      const next = animationFrom + (animationTo - animationFrom) * easeOutCubic(t);
      writeTransform(next, true);
      if (t >= 1) {
        animationActive = false;
        animationHandle = null;
        writeTransform(animationTo, false);
        forcePersist();
        return;
      }
      animationHandle = raf(step);
    };
    animationHandle = raf(step);
  }

  function scrollByUser(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    pendingRestoreOffset = null;
    cancelAnimation();
    writeTransform(offset + delta, true);
    dispatchEvent({ type: "user-scroll", geometry: geometry() });
  }

  function scrollQuestionIntoView(): void {
    if (!question) return;
    try {
      const viewportRect = viewport.getBoundingClientRect();
      const questionRect = question.getBoundingClientRect();
      const delta = questionRect.top - viewportRect.top - questionTopGapPx;
      if (Math.abs(delta) < 1) return;
      animateTo(offset + delta);
    } catch {
      /* layout not ready */
    }
  }

  function resetAnswerViewport(): void {
    if (!answer) return;
    try {
      const viewportRect = viewport.getBoundingClientRect();
      const answerRect = answer.getBoundingClientRect();
      // Keep the start of the new answer visible: if the answer top is below the
      // viewport bottom, lift the content so it sits at ~55% of the viewport.
      if (answerRect.top > viewportRect.top + viewportRect.height) {
        const target =
          offset + (answerRect.top - viewportRect.top) - viewportRect.height * 0.55;
        writeTransform(target, true);
      }
    } catch {
      /* layout not ready */
    }
  }

  function applyPendingRestore(): void {
    if (pendingRestoreOffset === null) return;
    const target = pendingRestoreOffset;
    if (maxOffset() <= 0) return;
    writeTransform(target, true);
    // Only clear once the content is tall enough to honour the saved offset.
    // Early growth frames clamp to a small maxOffset; clearing there would
    // freeze the panel near the top and lose the restored position.
    if (maxOffset() >= target - 0.5) {
      pendingRestoreOffset = null;
    }
  }

  function restorePosition(position: SavedScrollPosition): void {
    cancelAnimation();
    if (position.pinned) {
      pendingRestoreOffset = null;
      writeTransform(maxOffset(), true);
      return;
    }
    pendingRestoreOffset = position.offset > 0 ? position.offset : null;
    writeTransform(position.offset, true);
        // Content may already be tall enough to honour the saved offset.
    if (pendingRestoreOffset !== null && maxOffset() > 0 && Math.abs(offset - pendingRestoreOffset) <= 0.5) {
      pendingRestoreOffset = null;
    }
  }

  function executeCommands(commands: AutoScrollCommand[]): void {
    for (const command of commands) {
      switch (command.type) {
        case "snap-bottom":
          cancelAnimation();
          writeTransform(maxOffset(), true);
          break;
        case "animate-to-bottom":
          animateTo(maxOffset());
          break;
        case "animate-to-offset":
          animateTo(command.offset);
          break;
        case "scroll-question-into-view":
          scrollQuestionIntoView();
          break;
        case "reset-answer-viewport":
          resetAnswerViewport();
          break;
        case "cancel-animation":
          cancelAnimation();
          break;
        case "show-pill":
          setPillVisible(true);
          break;
        case "hide-pill":
          setPillVisible(false);
          break;
        case "restore":
          restorePosition(command.position);
          break;
        default:
          break;
      }
    }
    // Late-rendered transcript: re-apply a restored offset as soon as the
    // content is tall enough to honour it.
    applyPendingRestore();
  }

  function handleResize(): void {
    if (destroyed) return;
    const measured = measure();
    if (!opened) {
      opened = true;
      dispatchEvent({ type: "session-opened", geometry: measured.geometry, saved: savedPosition });
      return;
    }
    if (measured.contentChanged) {
      const event: AutoScrollEvent =
        measured.geometry.contentHeight >= (state.contentHeight || 0)
          ? { type: "content-grew", geometry: measured.geometry }
          : { type: "content-shrank", geometry: measured.geometry };
      dispatchEvent(event);
    }
    if (measured.viewportChanged) {
      dispatchEvent({ type: "resize", geometry: geometry() });
    }
  }

  function notifyContentChanged(): void {
    if (destroyed) return;
    const measured = measure();
    dispatchEvent({
      type:
        measured.geometry.contentHeight >= (state.contentHeight || 0)
          ? "content-grew"
          : "content-shrank",
      geometry: measured.geometry,
    });
  }

  function notifyQuestionChanged(): void {
    if (destroyed) return;
    pendingRestoreOffset = null;
    measure();
    dispatchEvent({ type: "question-changed", geometry: geometry() });
    forcePersist();
  }

  function jumpToLatest(): void {
    if (destroyed) return;
    pendingRestoreOffset = null;
    measure();
    dispatchEvent({ type: "jump-to-latest", geometry: geometry() });
    forcePersist();
  }

  function setDragging(dragging: boolean): void {
    if (destroyed) return;
    if (dragging) dispatchEvent({ type: "drag-start" });
    else {
      measure();
      dispatchEvent({ type: "drag-end", geometry: geometry() });
      forcePersist();
    }
  }

  function handleKey(key: AutoScrollKey): boolean {
    if (destroyed) return false;
    pendingRestoreOffset = null;
    measure();
    dispatchEvent({ type: "keyboard", key, geometry: geometry() });
    forcePersist();
    return true;
  }

  // ── Listeners ─────────────────────────────────────────────────────────────
  const onWheel = (event: WheelEvent) => {
    const deltaMode = event.deltaMode ?? 0;
    const delta =
      deltaMode === 1
        ? event.deltaY * 16
        : deltaMode === 2
          ? event.deltaY * viewportHeight
          : event.deltaY;
    if (!delta) return;
    scrollByUser(delta);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isEditableTarget(event.target)) return;
    let key: AutoScrollKey | null = null;
    if (event.key === " " || event.key === "Spacebar") {
      key = event.shiftKey ? "Shift+Space" : "Space";
    } else if (KEY_MAP[event.key]) {
      key = KEY_MAP[event.key]!;
    }
    if (!key) return;
    event.preventDefault();
    handleKey(key);
  };
  const onPillClick = (event: Event) => {
    event.preventDefault();
    jumpToLatest();
  };
  const onDragStart = () => setDragging(true);
  const onDragEnd = () => setDragging(false);

  viewport.addEventListener("wheel", onWheel as EventListener, { passive: true });
  pill.addEventListener("click", onPillClick);
  if (doc) doc.addEventListener("keydown", onKeyDown as EventListener, true);
  win?.addEventListener?.("overlay:drag-start", onDragStart);
  win?.addEventListener?.("overlay:drag-end", onDragEnd);

  let resizeObserver: ResizeObserverLike | null = null;
  if (options.resizeObserverFactory || typeof ResizeObserver !== "undefined") {
    const factory =
      options.resizeObserverFactory ??
      ((callback: ResizeObserverCallback) => new ResizeObserver(callback));
    resizeObserver = factory(() => handleResize());
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
  }
  // First measurement/restore runs synchronously when layout is already
  // available, otherwise the ResizeObserver's first callback performs it.
  if (typeof viewport.clientHeight === "number" && viewport.clientHeight > 0) {
    handleResize();
  }

  const api: OverlayAutoScroll = {
    sessionId: options.sessionId,
    notifyContentChanged,
    notifyQuestionChanged,
    jumpToLatest,
    scrollBy: scrollByUser,
    scrollTo: (nextOffset: number) => {
      cancelAnimation();
      writeTransform(nextOffset, true);
      dispatchEvent({ type: "user-scroll", geometry: geometry() });
    },
    setDragging,
    handleKey,
    getSnapshot: () => ({
      ...state,
      offset,
      maxOffset: maxOffset(),
      distanceFromBottom: distanceFromBottom(geometry()),
    }),
    getFrameStats: () => ({ ...frameStats }),
    getOffset: () => offset,
    getSaveCount: () => saveCount,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      cancelAnimation();
      resizeObserver?.disconnect();
      viewport.removeEventListener("wheel", onWheel as EventListener);
      pill.removeEventListener("click", onPillClick);
      if (doc) doc.removeEventListener("keydown", onKeyDown as EventListener, true);
      win?.removeEventListener?.("overlay:drag-start", onDragStart);
      win?.removeEventListener?.("overlay:drag-end", onDragEnd);
    },
  };
  return api;
}
