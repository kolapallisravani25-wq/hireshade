import { describe, expect, it } from "vitest";
import {
  createOverlayAutoScroll,
  type OverlayAutoScroll,
  type ResizeObserverLike,
  type StorageLike,
} from "./overlayAutoScroll";

/* ──────────────────────────────────────────────────────────────────────────
 * Minimal fake DOM: exactly the surface the adapter touches, so the adapter
 * can be exercised deterministically in the node test environment (the real
 * Chromium behaviour is covered by the Electron/CDP scenario suite).
 * ────────────────────────────────────────────────────────────────────────── */

type Listener = (event: any) => void;

class FakeElement {
  readonly tagName: string;
  style: Record<string, string> = {};
  clientHeight = 0;
  scrollHeight = 0;
  offsetHeight = 0;
  hidden = false;
  isContentEditable = false;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  rect = { top: 0, left: 0, width: 400, height: 0 };
  focusCalls = 0;
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
  }
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type: string, event: any = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  getBoundingClientRect() {
    return {
      ...this.rect,
      bottom: this.rect.top + this.rect.height,
      right: this.rect.left + this.rect.width,
    };
  }
  focus(): void {
    this.focusCalls += 1;
  }
}

class FakeDocument {
  readonly listeners = new Map<string, Array<{ listener: Listener; capture: boolean }>>();
  addEventListener(type: string, listener: Listener, capture = false): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ listener, capture });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener, capture = false): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (entry) => entry.listener !== listener || entry.capture !== capture,
      ),
    );
  }
  dispatch(type: string, event: any = {}): void {
    for (const entry of this.listeners.get(type) ?? []) entry.listener(event);
  }
}

class FakeResizeObserver implements ResizeObserverLike {
  readonly observed: unknown[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: unknown): void {
    this.observed.push(target);
  }
  disconnect(): void {
    this.observed.length = 0;
  }
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

class FakeWindow {
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ type });
  }
}

interface Harness {
  controller: OverlayAutoScroll;
  viewport: FakeElement;
  content: FakeElement;
  question: FakeElement;
  answer: FakeElement;
  pill: FakeElement;
  document: FakeDocument;
  window: FakeWindow;
  resizeObserver: FakeResizeObserver;
  storage: FakeStorage;
  now: () => number;
  tick: (ms?: number, frames?: number) => void;
  grow: (contentHeight: number) => void;
  setContentHeight: (contentHeight: number) => void;
  layout: () => void;
}

function createHarness(options: {
  contentHeight?: number;
  viewportHeight?: number;
  sessionId?: string;
  saved?: { offset: number; pinned: boolean; updatedAt: number } | null;
  reducedMotion?: boolean;
  animationMs?: number;
  storage?: FakeStorage;
} = {}): Harness {
  const viewportHeight = options.viewportHeight ?? 200;
  const contentHeight = options.contentHeight ?? 1000;
  const doc = new FakeDocument();
  const win = new FakeWindow();
  const storage = options.storage ?? new FakeStorage();
  const viewport = new FakeElement("div");
  const content = new FakeElement("div");
  const question = new FakeElement("div");
  const answer = new FakeElement("div");
  const pill = new FakeElement("button");
  viewport.clientHeight = viewportHeight;
  content.scrollHeight = contentHeight;
  viewport.rect = { top: 100, left: 0, width: 400, height: viewportHeight };
  let offset = 0;
  const frameCallbacks: Array<{ id: number; callback: FrameRequestCallback }> = [];
  let frameId = 0;
  let clock = 0;

  const now = () => clock;
  const raf = (callback: FrameRequestCallback) => {
    const id = ++frameId;
    frameCallbacks.push({ id, callback });
    return id;
  };
  const caf = (id: number) => {
    const index = frameCallbacks.findIndex((entry) => entry.id === id);
    if (index >= 0) frameCallbacks.splice(index, 1);
  };
  let observer: FakeResizeObserver | null = null;
  const sessionId = options.sessionId ?? "session-1";
  if (options.saved) {
    storage.setItem(
      "hireshade.overlay.scroll.v1:" + sessionId,
      JSON.stringify(options.saved),
    );
  }

  const layout = () => {
    offset = controller.getOffset();
    content.rect = { top: 100 - offset, left: 0, width: 400, height: contentHeight };
    question.rect = { top: 100 - offset + 8, left: 0, width: 380, height: 24 };
    answer.rect = { top: 100 - offset + 40, left: 0, width: 380, height: contentHeight - 40 };
  };

  const controller = createOverlayAutoScroll({
    sessionId,
    elements: { viewport: viewport as any, content: content as any, question: question as any, answer: answer as any, pill: pill as any },
    storage,
    document: doc as unknown as Document,
    window: win as unknown as Window,
    reducedMotion: options.reducedMotion ?? false,
    animationMs: options.animationMs ?? 100,
    now,
    raf,
    caf,
    resizeObserverFactory: (callback) => {
      observer = new FakeResizeObserver(callback);
      return observer;
    },
    questionTopGapPx: 10,
  });
  layout();

  const tick = (ms = 20, frames = 50) => {
    for (let i = 0; i < frames; i++) {
      clock += ms;
      const pending = frameCallbacks.splice(0, frameCallbacks.length);
      if (!pending.length) return;
      for (const entry of pending) entry.callback(clock);
      layout();
    }
  };

  const grow = (nextContentHeight: number) => {
    content.scrollHeight = nextContentHeight;
    observer?.trigger();
    layout();
  };

  return {
    controller,
    viewport,
    content,
    question,
    answer,
    pill,
    document: doc,
    window: win,
    resizeObserver: observer as unknown as FakeResizeObserver,
    storage,
    now,
    tick,
    grow,
    setContentHeight: (height: number) => {
      content.scrollHeight = height;
    },
    layout,
  };
}

function wheel(deltaY: number) {
  return { deltaY, deltaMode: 0 };
}
function keydown(key: string, extra: Record<string, unknown> = {}) {
  let prevented = false;
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: new FakeElement("div"),
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
    ...extra,
  };
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("overlayAutoScroll DOM adapter", () => {
  it("sets answer-pane ARIA live semantics and starts pinned at the bottom", () => {
    const h = createHarness();
    expect(h.answer.getAttribute("role")).toBe("log");
    expect(h.answer.getAttribute("aria-live")).toBe("polite");
    expect(h.answer.getAttribute("aria-atomic")).toBe("false");
    expect(h.controller.getSnapshot().pinned).toBe(true);
    expect(h.controller.getOffset()).toBe(800);
    expect(h.content.style.transform).toBe("translate3d(0px, -800px, 0px)");
    expect(h.pill.hidden).toBe(true);
    expect(h.pill.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a 200-token stream pinned within 2px of the bottom and budgets updates", () => {
    const h = createHarness();
    let contentHeight = 1000;
    for (let token = 0; token < 200; token++) {
      contentHeight += 14;
      h.grow(contentHeight);
      const snapshot = h.controller.getSnapshot();
      expect(snapshot.distanceFromBottom).toBeLessThanOrEqual(2);
      expect(Math.abs(snapshot.offset - (contentHeight - 200))).toBeLessThanOrEqual(2);
    }
    const stats = h.controller.getFrameStats();
    expect(stats.frames).toBeGreaterThanOrEqual(200);
    expect(stats.maxUpdateMs).toBeLessThanOrEqual(16);
    expect(Number.isFinite(stats.maxFrameIntervalMs)).toBe(true);
  });

  it("unlocks within one synthetic scroll-up frame, shows the pill and never snaps back", () => {
    const h = createHarness();
    h.viewport.dispatch("wheel", wheel(-30));
    const snapshot = h.controller.getSnapshot();
    expect(snapshot.pinned).toBe(false);
    expect(snapshot.pillVisible).toBe(true);
    expect(h.pill.hidden).toBe(false);
    expect(h.pill.getAttribute("aria-hidden")).toBe("false");
    expect(h.controller.getOffset()).toBe(770);
    // More streaming must not move the viewport.
    h.grow(1100);
    h.grow(1200);
    expect(h.controller.getOffset()).toBe(770);
    expect(h.controller.getSnapshot().pinned).toBe(false);
  });

  it("re-locks when the pill is clicked and animates to the bottom", () => {
    const h = createHarness();
    h.viewport.dispatch("wheel", wheel(-60));
    expect(h.controller.getSnapshot().pinned).toBe(false);
    h.pill.dispatch("click", { preventDefault() {} });
    // Animation is in-flight; finish it.
    h.tick(20, 20);
    const snapshot = h.controller.getSnapshot();
    expect(snapshot.pinned).toBe(true);
    expect(snapshot.pillVisible).toBe(false);
    expect(h.pill.hidden).toBe(true);
    expect(h.controller.getOffset()).toBe(800);
  });

  it("re-locks when the user manually returns within 2px of the bottom", () => {
    const h = createHarness();
    h.viewport.dispatch("wheel", wheel(-60));
    h.controller.scrollTo(801);
    const snapshot = h.controller.getSnapshot();
    expect(snapshot.pinned).toBe(true);
    expect(h.controller.getOffset()).toBe(800);
    expect(h.pill.hidden).toBe(true);
  });

  it("immediately animates instantly for reduced motion (no rAF needed)", () => {
    const h = createHarness({ reducedMotion: true });
    h.viewport.dispatch("wheel", wheel(-60));
    h.pill.dispatch("click", { preventDefault() {} });
    expect(h.controller.getSnapshot().pinned).toBe(true);
    expect(h.controller.getOffset()).toBe(800);
    expect(h.pill.hidden).toBe(true);
  });

  it("never moves, nor shows a jump pill, for a short answer", () => {
    const h = createHarness({ contentHeight: 120 });
    expect(h.controller.getOffset()).toBe(0);
    h.grow(140);
    expect(h.controller.getOffset()).toBe(0);
    expect(h.pill.hidden).toBe(true);
    expect(h.controller.getSnapshot().pillVisible).toBe(false);
  });

  it("scrolls the new question into view, keeps the answer start visible and follows", () => {
    const h = createHarness({ contentHeight: 1400 });
    h.controller.scrollTo(200);
    h.controller.notifyQuestionChanged();
    h.tick(20, 20);
    // Question top = contentTop + 8; at offset 0 that's 108, 8px below the
    // viewport top accounting for the 10px gap => snapped to the top.
    expect(h.controller.getOffset()).toBe(0);
    // The answer start (contentTop + 40 = 140px) is inside the 200px viewport.
    expect(h.answer.getBoundingClientRect().top).toBeLessThan(300);
    // Following resumes: growth keeps the bottom pinned.
    h.grow(1500);
    expect(h.controller.getSnapshot().distanceFromBottom).toBeLessThanOrEqual(2);
  });

  it("persists per session and restores on reopen", () => {
    const storage = new FakeStorage();
    const first = createHarness({ storage });
    first.viewport.dispatch("wheel", wheel(-40));
    first.tick(20, 5); // flush the scheduled persist
    const savedRaw = storage.getItem("hireshade.overlay.scroll.v1:session-1");
    expect(savedRaw).toBeTruthy();
    const saved = JSON.parse(savedRaw!);
    expect(saved.pinned).toBe(false);
    expect(saved.offset).toBe(760);

    const reopened = createHarness({ storage });
    const snapshot = reopened.controller.getSnapshot();
    expect(snapshot.pinned).toBe(false);
    expect(snapshot.offset).toBe(760);
    expect(reopened.pill.hidden).toBe(false);
  });

  it("re-applies a restored offset when the transcript renders after reopen", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "hireshade.overlay.scroll.v1:session-1",
      JSON.stringify({ offset: 500, pinned: false, updatedAt: 1 }),
    );
    // Reopen with no content yet (transcript loads later).
    const h = createHarness({ storage, contentHeight: 120 });
    expect(h.controller.getSnapshot().pinned).toBe(false);
    expect(h.controller.getOffset()).toBe(0);
    // Transcript arrives: the saved offset is applied as soon as it fits.
    h.grow(1000);
    expect(h.controller.getOffset()).toBe(500);
    expect(h.controller.getSnapshot().pinned).toBe(false);
    expect(h.pill.hidden).toBe(false);
  });

  it("restores a pinned session at the bottom", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "hireshade.overlay.scroll.v1:session-1",
      JSON.stringify({ offset: 0, pinned: true, updatedAt: 1 }),
    );
    const h = createHarness({ storage });
    expect(h.controller.getOffset()).toBe(800);
    expect(h.controller.getSnapshot().pinned).toBe(true);
  });

  it("ignores wheel scrolling while dragged and snaps after drag ends", () => {
    const h = createHarness();
    h.controller.setDragging(true);
    h.grow(1200);
    expect(h.controller.getOffset()).toBe(800);
    h.controller.setDragging(false);
    expect(h.controller.getOffset()).toBe(1000);
  });

  it("handles PageUp/PageDown/Home/End/Space on the document", () => {
    const h = createHarness();
    const pageUp = keydown("PageUp");
    h.document.dispatch("keydown", pageUp);
    expect(pageUp.prevented).toBe(true);
    expect(h.controller.getSnapshot().pinned).toBe(false);
    expect(h.pill.hidden).toBe(false);

    const end = keydown("End");
    h.document.dispatch("keydown", end);
    h.tick(20, 20);
    expect(h.controller.getSnapshot().pinned).toBe(true);
    expect(h.controller.getOffset()).toBe(800);

    const home = keydown("Home");
    h.document.dispatch("keydown", home);
    h.tick(20, 20);
    expect(h.controller.getOffset()).toBe(0);
    expect(h.controller.getSnapshot().pinned).toBe(false);

    const space = keydown(" ");
    h.document.dispatch("keydown", space);
    h.tick(20, 20);
    expect(h.controller.getOffset()).toBeGreaterThan(0);
    expect(space.prevented).toBe(true);

    const pageDown = keydown("PageDown");
    h.document.dispatch("keydown", pageDown);
    expect(pageDown.prevented).toBe(true);
  });

  it("ignores keys while typing in an input", () => {
    const h = createHarness();
    const input = new FakeElement("input");
    const event = keydown("PageUp", { target: input });
    h.document.dispatch("keydown", event);
    expect(event.prevented).toBe(false);
    expect(h.controller.getOffset()).toBe(800);
  });

  it("never programmatically steals focus", () => {
    const h = createHarness();
    h.viewport.dispatch("wheel", wheel(-60));
    h.tick(20, 5);
    h.pill.dispatch("click", { preventDefault() {} });
    h.tick(20, 20);
    h.document.dispatch("keydown", keydown("End"));
    h.tick(20, 20);
    expect(h.viewport.focusCalls).toBe(0);
    expect(h.answer.focusCalls).toBe(0);
    expect(h.pill.focusCalls).toBe(0);
  });

  it("stops all work after destroy", () => {
    const h = createHarness();
    h.controller.destroy();
    const before = h.controller.getOffset();
    h.viewport.dispatch("wheel", wheel(-60));
    expect(h.controller.getOffset()).toBe(before);
    h.controller.notifyContentChanged();
    h.tick(20, 5);
    expect(h.controller.getOffset()).toBe(before);
  });

  it("reports frame statistics and save counts", () => {
    const h = createHarness();
    h.grow(1020);
    h.grow(1040);
    const stats = h.controller.getFrameStats();
    expect(stats.frames).toBeGreaterThanOrEqual(2);
    expect(stats.maxUpdateMs).toBeGreaterThanOrEqual(0);
    expect(h.controller.getSaveCount()).toBeGreaterThanOrEqual(0);
    expect(h.controller.getSnapshot().maxOffset).toBe(840);
  });
});
