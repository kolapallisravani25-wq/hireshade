import { useState, useLayoutEffect, useRef } from "react";

const MENU_W = 260;
const MENU_FLIP_SAFE_BOTTOM = 80;

type MenuAnchor = {
  top: number;
  left: number;
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

      // Right-align menu with trigger right edge, clamped inside viewport
      const left = Math.max(
        8,
        Math.min(vw - MENU_W - 8, Math.round(rect.right - MENU_W)),
      );

      setAnchor({
        top: Math.round(rect.bottom + 6),
        left,
      });
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
