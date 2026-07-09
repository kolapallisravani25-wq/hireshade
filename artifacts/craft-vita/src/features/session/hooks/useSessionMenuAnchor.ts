import { useState, useLayoutEffect, useRef } from "react";
import { MORE_ACTIONS_POPOVER_W } from "@/features/launcher/constants";

// Match the actual rendered panel width so right-edge clamping is accurate.
const MENU_W = MORE_ACTIONS_POPOVER_W;
// Gap between the trigger and the panel, and the min margin kept from any edge.
const GAP = 6;
const EDGE_MARGIN = 8;

type MenuAnchor = {
  top: number;
  left: number;
  /** Max panel height so a tall menu scrolls internally instead of overflowing
   *  the bottom of the (short) overlay window. */
  maxHeight: number;
} | null;

/**
 * Computes session menu popover position — identical pattern to usePopoverAnchor
 * from the launcher, ensuring both use the same architecture.
 *
 * Measures from triggerRef's getBoundingClientRect() but applies horizontal
 * clamping to keep the menu inside the viewport.
 *
 * When open, recomputes on scroll/resize to keep the menu glued to its trigger.
 */
export function useSessionMenuAnchor({
  menuOpen,
  triggerRef,
}: {
  menuOpen: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}): MenuAnchor {
  const [anchor, setAnchor] = useState<MenuAnchor>(null);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setAnchor(null);
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const trigger = triggerRef.current;
    if (!trigger) return;

    function compute() {
      const t = triggerRef.current;
      if (!t) return;

      const rect = t.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Right-align menu with trigger right edge, clamped inside viewport
      const left = Math.max(
        EDGE_MARGIN,
        Math.min(vw - MENU_W - EDGE_MARGIN, Math.round(rect.right - MENU_W)),
      );

      // Vertical placement: prefer dropping below the trigger, but if there is
      // more room above (short overlay window), flip up. Either way cap the
      // panel height to the available space so the bottom is never clipped and
      // the panel scrolls internally instead.
      const spaceBelow = vh - rect.bottom - GAP - EDGE_MARGIN;
      const spaceAbove = rect.top - GAP - EDGE_MARGIN;
      const dropBelow = spaceBelow >= spaceAbove;

      const maxHeight = Math.max(
        120,
        Math.round(dropBelow ? spaceBelow : spaceAbove),
      );

      const top = dropBelow
        ? Math.round(rect.bottom + GAP)
        : Math.round(Math.max(EDGE_MARGIN, rect.top - GAP - maxHeight));

      setAnchor({ top, left, maxHeight });
    }

    const recompute = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    compute(); // synchronous first time — zero flicker

    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [menuOpen]);

  return anchor;
}
