/**
 * Sticky-bottom scroll decision logic for the floating overlay's AnswerArea.
 *
 * Extracted as pure functions (matching the autoScrollPolicy.ts pattern used
 * elsewhere in this codebase) so the decision rules are unit-testable without
 * a DOM/ResizeObserver — the craft-vita vitest environment is "node".
 *
 * Behavior contract:
 *  - The user is "near bottom" while within NEAR_BOTTOM_TOLERANCE_PX of the
 *    scroll container's true bottom.
 *  - Forced auto-scroll (from either a text-length change or a rendered-
 *    height change reported by ResizeObserver) only fires while near bottom
 *    — a manual scroll-up must never be fought.
 */

export const NEAR_BOTTOM_TOLERANCE_PX = 120;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Same rule AnswerArea's onScroll handler applies to its scroll container. */
export function isNearBottom(
  metrics: ScrollMetrics,
  tolerancePx: number = NEAR_BOTTOM_TOLERANCE_PX,
): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom < tolerancePx;
}

/**
 * The single gate both the text-growth effect and the ResizeObserver effect
 * check before forcing scrollTop to scrollHeight. One shared function means
 * both triggers can never diverge in behavior.
 */
export function shouldForceScrollToBottom(isUserNearBottom: boolean): boolean {
  return isUserNearBottom;
}
