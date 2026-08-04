/**
 * Auto-scroll decision policy for the floating-session responses panel.
 *
 * The append/toggle behaviors were previously embedded inline in
 * useFloatingSession (which drags in Tauri + Redux and cannot be rendered in
 * the node-env test stack). Extracting them here keeps the exact same
 * behavior while making every branch unit-testable as pure functions.
 *
 * Behavior contract (matches the approved auto-scroll design):
 *  - The FIRST AI response of a session always jumps the viewer to it and
 *    expands the panel, regardless of the auto-scroll toggle.
 *  - When auto-scroll is ON, a newly appended response always advances the
 *    viewer to the newest card.
 *  - When auto-scroll is OFF, an append only advances the viewer if they were
 *    already viewing the latest response (preserves manual browsing).
 *  - Re-enabling auto-scroll jumps to the latest response if any exist.
 */

export interface AutoScrollAppendInput {
  /** Number of AI responses before this render. */
  prevLen: number;
  /** Number of AI responses in the current render. */
  currLen: number;
  /** Index of the response the user is currently viewing. */
  currentIndex: number;
  /** Whether follow-mode auto-scroll is enabled. */
  autoScroll: boolean;
}

export type AutoScrollAppendDecision =
  /** First response ever arrived — jump to index 0 and expand the panel. */
  | { type: "first-arrived"; index: 0 }
  /** A new response was appended and the viewer should advance to it. */
  | { type: "advance"; index: number }
  /** Keep the current viewport; no index change. */
  | { type: "none" };

/**
 * Decide what to do with the viewer's response index after a render.
 *
 * `index` on "advance" is always `currLen - 1`, so it can never be
 * out-of-bounds even if Redux state raced ahead of React state.
 */
export function decideAutoScrollOnAppend(
  input: AutoScrollAppendInput,
): AutoScrollAppendDecision {
  const { prevLen, currLen, currentIndex, autoScroll } = input;

  // No new response: never touch the viewport (also covers shrink/reset).
  if (currLen <= prevLen) return { type: "none" };
  // First response of the session always jumps + expands.
  if (prevLen === 0) return { type: "first-arrived", index: 0 };
  // Follow-mode always advances; manual mode only when already at the end.
  if (autoScroll || currentIndex >= prevLen - 1) {
    return { type: "advance", index: currLen - 1 };
  }
  return { type: "none" };
}

/**
 * Compute the response index to jump to when the user toggles auto-scroll.
 * Returns `null` when no jump should occur (disabling, or enabling with no
 * responses yet); otherwise the index of the latest response.
 */
export function nextResponseIndexOnToggle(
  nextAutoScroll: boolean,
  responseCount: number,
): number | null {
  if (!nextAutoScroll || responseCount <= 0) return null;
  return responseCount - 1;
}
