import { useState, useLayoutEffect, useRef } from "react";
import {
  MORE_ACTIONS_POPOVER_W,
  HEADER_MENU_MAX_H,
  MENU_FLIP_SAFE_BOTTOM,
} from "@/features/launcher/constants";

interface UsePopoverAnchorOptions {
  menuOpen: boolean;
  /** Kept for interface compat — not used internally (see architecture note). */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  cardRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  cardPosX: number;
  cardPosY: number;
  collapsed: boolean;
}

type MenuDirection = "down" | "up";

export type MenuAnchor = {
  top: number;
  left: number;
  /** Whether the menu opens above (up) or below (down) the trigger. */
  direction: MenuDirection;
} | null;

/**
 * Computes and tracks the position for the header menu popover.
 *
 * ## Root cause of zoom drift — and why we do NOT use triggerRef
 *
 * The trigger button lives inside `innerContentRef` which has `style={{ zoom }}`.
 * In WKWebView (macOS), `getBoundingClientRect()` on an element whose ancestor
 * has CSS `zoom` returns coordinates in the **un-zoomed layout space**, not the
 * visual viewport space.  At `zoom: 0.7` the trigger's
 * `getBoundingClientRect().right` returns the same number as at `zoom: 1.0`,
 * even though the trigger is visually 30% smaller and shifted inward.
 *
 * This causes the menu to be placed at the un-zoomed (larger) coordinate while
 * the trigger sits at the smaller visual position — exactly the "drifts away
 * from trigger" symptom.
 *
 * ## Fix: measure only from outside the zoom container
 *
 * `cardRef` wraps `innerContentRef` but is itself NOT zoomed.  Its
 * `getBoundingClientRect()` always returns correct viewport-space coordinates
 * because CSS zoom on a child physically shrinks that child in layout, so the
 * parent wrapper adapts — cardRef.right IS the visual right edge of the card.
 *
 * The trigger's visual bottom is derived without DOM measurement on zoomed
 * elements:
 *   triggerBottom = cardRect.top + HEADER_H_LOGICAL × zoom
 *
 * Both values are always correct: `cardRect.top` from reliable outside-zoom
 * measurement, `HEADER_H_LOGICAL × zoom` from pure arithmetic.
 *
 * ## Viewport-flip logic
 * When the card is near the bottom of the screen the menu flips upward so it
 * never disappears behind the macOS Dock.
 *
 * ## Retina / multi-monitor safety
 * cardRef.getBoundingClientRect() in WKWebView returns CSS px values that
 * already account for device pixel ratio — no DPR math needed.
 */

// Logical height (CSS px at zoom 1.0) of the launcher header row.
// Layout: py-2.5 (10px × 2) + button height (p-1.5 + h-3.5 icon = 6+14+6 = 26px) = 46px.
// Multiplied by runtime `zoom` to get the visual (post-zoom) pixel height.
const HEADER_H_LOGICAL = 46;

export function usePopoverAnchor({
  menuOpen,
  // triggerRef intentionally not used — see "Root cause" note above.
  cardRef,
  zoom,
  cardPosX,
  cardPosY,
  collapsed,
}: UsePopoverAnchorOptions): MenuAnchor {
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor>(null);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuAnchor(null);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const card = cardRef.current;
    if (!card) return;

    function compute() {
      const c = cardRef.current;
      if (!c) return;

      // cardRef is OUTSIDE the CSS zoom container — always viewport-correct.
      const cardRect = c.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // ── Horizontal: right-align menu with card right edge ─────────────
      // The trigger is at the far right of the header. The card's right edge
      // serves as the natural anchor for right-aligning the dropdown.
      const left = Math.max(
        8,
        Math.min(
          vw - MORE_ACTIONS_POPOVER_W - 8,
          Math.round(cardRect.right - MORE_ACTIONS_POPOVER_W),
        ),
      );

      // ── Vertical: derive header bottom from card top + zoomed height ───
      // HEADER_H_LOGICAL × zoom = visual header height at this zoom level.
      // Pure arithmetic — no getBoundingClientRect on any zoomed element.
      const headerBottom = cardRect.top + HEADER_H_LOGICAL * zoom;
      const spaceBelow = vh - headerBottom - MENU_FLIP_SAFE_BOTTOM;
      const openUpward = spaceBelow < HEADER_MENU_MAX_H;

      let top: number;
      if (openUpward) {
        top = Math.max(28, Math.round(cardRect.top - HEADER_MENU_MAX_H - 6));
      } else {
        top = Math.max(8, Math.round(headerBottom + 8));
      }

      const direction: MenuDirection = openUpward ? "up" : "down";

      setMenuAnchor((prev) =>
        prev &&
        prev.top === top &&
        prev.left === left &&
        prev.direction === direction
          ? prev
          : { top, left, direction },
      );
    }

    const recompute = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    compute(); // synchronous first frame — zero flicker on open

    window.addEventListener("resize", recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(card);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", recompute);
      ro.disconnect();
    };
    // zoom is a dep because HEADER_H_LOGICAL × zoom drives the top calculation.
    // This is safe: no getBoundingClientRect on any zoomed element, so there is
    // no CSS-zoom reflow timing race.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, zoom, cardPosX, cardPosY, collapsed]);

  return menuAnchor;
}
