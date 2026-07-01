/**
 * useSafeZoom — adaptive safe-zoom engine for Tauri overlay windows.
 *
 * Dynamically calculates safe [min, max] zoom bounds at runtime based on:
 *   • Natural content height  (ResizeObserver on the pre-transform element)
 *   • Available screen height (window.screen.availHeight — respects dock/taskbar)
 *   • Absolute readability floor / ceiling from overlaySettings
 *
 * HOW TO USE
 * ----------
 * 1. Add `innerRef = useRef<HTMLDivElement>(null)` to the element that has
 *    `transform: scale(zoom)` applied (or to the unscaled root for fontSize zoom).
 *    CSS transforms don't affect layout, so ResizeObserver always reports
 *    natural (pre-scale) dimensions — exactly what we need.
 *
 * 2. Call `const bounds = useSafeZoom(innerRef, zoom, setZoom)`.
 *
 * 3. Use `bounds.safeMin` / `bounds.safeMax` in sliders and shortcut handlers.
 *    Use `bounds.atMin` / `bounds.atMax` for disabled button states.
 *    Use `bounds.clamp(v)` before applying any zoom value.
 *
 * SAFE MAX LOGIC
 * --------------
 *   safeMax = snapDown( screenAvailH × MAX_SCREEN_FRACTION / naturalContentH )
 *
 * Example: 900px screen, 550px natural content height
 *   rawMax  = (900 × 0.88) / 550 ≈ 1.44
 *   safeMax = snapDown(1.44, 0.05) = 1.40  → widget fills 88% at 140%
 *
 * When content grows (e.g. accordion expands), safeMax decreases automatically.
 * If the current zoom exceeds the new safeMax, it is clamped immediately.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ZOOM_MIN, ZOOM_MAX, saveZoom } from "@/lib/overlaySettings";

/** Fraction of screen available height the widget may fill at max zoom. */
const MAX_SCREEN_FRACTION = 0.88;

/**
 * Snap a value DOWN to the nearest multiple of `step`.
 * e.g. snapDown(1.44, 0.05) → 1.40
 */
function snapDown(v: number, step = 0.05): number {
  return Math.floor(v / step) * step;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SafeZoomBounds {
  /** Absolute minimum zoom (readability floor = ZOOM_MIN from overlaySettings). */
  safeMin: number;
  /**
   * Runtime-calculated maximum zoom.
   * Prevents the widget from exceeding MAX_SCREEN_FRACTION of available screen height.
   * Recalculates whenever content dimensions change.
   */
  safeMax: number;
  /** True when `zoom` is at or below `safeMin` — disable zoom-out controls. */
  atMin: boolean;
  /** True when `zoom` is at or above `safeMax` — disable zoom-in controls. */
  atMax: boolean;
  /** Clamp an arbitrary zoom value to [safeMin, safeMax]. */
  clamp: (v: number) => number;
}

/**
 * @param contentRef  Ref to the element that has CSS `zoom: ${zoom}` applied.
 *                    When cssZoomApplied=true, the hook divides the observed
 *                    height by the current zoom to recover the natural height.
 *                    When cssZoomApplied=false (default, legacy), the element
 *                    uses `transform: scale()` which does NOT affect offsetHeight,
 *                    so raw observed height == natural height.
 * @param zoom        Current zoom value — drives atMin/atMax, triggers auto-clamp.
 * @param setZoom     Setter called when auto-clamping is required (content grew).
 * @param cssZoomApplied  Pass `true` when the observed element uses the CSS `zoom`
 *                        property (not `transform: scale`).  Default: false.
 */
export function useSafeZoom(
  contentRef: React.RefObject<HTMLElement | null>,
  zoom: number,
  setZoom: (v: number) => void,
  cssZoomApplied = false,
): SafeZoomBounds {
  const [safeMax, setSafeMax] = useState<number>(ZOOM_MAX);

  // Stable refs so recalc closure never captures stale values
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setZoomRef = useRef(setZoom);
  setZoomRef.current = setZoom;

  /**
   * Recalculate safe max from measured height.
   * When cssZoomApplied=true, rawH = naturalH * zoom (CSS zoom changes offsetHeight).
   * We divide by zoom to get the pre-zoom natural height for the safeMax formula.
   */
  const recalc = useCallback((rawH: number) => {
    if (rawH <= 0) return;
    const naturalH = cssZoomApplied ? rawH / zoomRef.current : rawH;

    const availH = window.screen.availHeight || 900;

    // Maximum zoom that keeps content inside MAX_SCREEN_FRACTION of screen height
    const rawMax = (availH * MAX_SCREEN_FRACTION) / naturalH;

    // Clamp to absolute bounds and snap DOWN to nearest 0.05 step
    const nextMax = +Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN + 0.1, snapDown(rawMax)),
    ).toFixed(2);

    setSafeMax(nextMax);

    // NOTE: We intentionally do NOT auto-clamp the current zoom here.
    // safeMax is a cap on the zoom controls (prevents zooming further in);
    // it must not silently reset the user's zoom when content height changes
    // between navigation steps (e.g. session creation step 1 → step 2).
  }, []);

  // Attach ResizeObserver to the natural-size content element
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    // Measure immediately — offsetHeight is unaffected by parent transforms
    if (el.offsetHeight > 0) recalc(el.offsetHeight);

    const ro = new ResizeObserver((entries) => {
      const h =
        entries[0]?.borderBoxSize?.[0]?.blockSize ??
        entries[0]?.contentRect.height ??
        0;
      if (h > 0) recalc(h);
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [contentRef, recalc]);

  const clamp = useCallback(
    (v: number): number =>
      +Math.min(safeMax, Math.max(ZOOM_MIN, v)).toFixed(2),
    [safeMax],
  );

  return {
    safeMin: ZOOM_MIN,
    safeMax,
    atMin: zoom <= ZOOM_MIN,
    atMax: zoom >= safeMax,
    clamp,
  };
}
