/**
 * Framework-free overlay auto-scroll module (W2 UX).
 *
 * - autoScrollMachine: pure reducer/state machine (no DOM) — animations are
 *   decided by the adapter from the emitted commands + reduced-motion state.
 * - overlayAutoScroll: DOM adapter (transform virtual scroll, ResizeObserver,
 *   persistence, ARIA, keyboard, drag guard, frame instrumentation).
 *
 * Usage:
 *   const controller = createOverlayAutoScroll({
 *     sessionId,
 *     elements: { viewport, content, question, answer, pill },
 *   });
 *   // after each streamed DOM update:
 *   controller.notifyContentChanged();
 *   // when the detected question changes:
 *   controller.notifyQuestionChanged();
 */
export * from "./autoScrollMachine";
export * from "./overlayAutoScroll";
