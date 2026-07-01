/**
 * clampToScreen
 * ─────────────────────────────────────────────────────────────────────────────
 * Keeps a CSS-positioned widget (inside a fullscreen transparent Tauri window)
 * within the visible viewport on every drag frame.
 *
 * Architecture note
 * ─────────────────
 * HireShade's floating windows (launcher + mini) are fullscreen/transparent
 * at the native level.  The visible card is just a div positioned absolutely
 * inside that canvas.  We therefore clamp in *CSS pixel* space — no native
 * Tauri PhysicalPosition APIs needed, which avoids round-trip IPC latency and
 * prevents flicker.
 *
 * Edge cases handled
 * ──────────────────
 * • The widget is wider than the viewport (unlikely but safe — left edge wins).
 * • `window.innerWidth/Height` already accounts for DPI-scaled CSS pixels.
 * • Multi-monitor: the fullscreen Tauri window spans one monitor at a time;
 *   `window.innerWidth/Height` reflects that monitor's logical resolution.
 */

/** Minimum pixels of the widget that must remain on screen on every side. */
export const EDGE_GUARD = 80;

/** Snap distance in px — position snaps to edge when within this range. */
const SNAP_THRESHOLD = 20;

/** How far the snapped edge is inset from the viewport boundary. */
const SNAP_OFFSET = 8;

export interface ClampedPos {
  x: number;
  y: number;
  /** True when the position was snapped to an edge this frame. */
  snappedH: "left" | "right" | null;
  snappedV: "top" | "bottom" | null;
}

/**
 * Clamp `(x, y)` so a widget of `widgetW × widgetH` pixels stays visible.
 * Optionally applies magnetic edge snapping near screen borders.
 *
 * @param x        Desired left edge in CSS pixels.
 * @param y        Desired top  edge in CSS pixels.
 * @param widgetW  Widget width  (use 0 if unknown — only left/top are guarded).
 * @param widgetH  Widget height (use 0 if unknown).
 * @param snap     Enable magnetic edge snapping (default: true).
 */
export function clampToScreen(
  x: number,
  y: number,
  widgetW = 0,
  widgetH = 0,
  snap = true,
): ClampedPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ── Hard clamp ─────────────────────────────────────────────────────────────
  // Right edge: at least EDGE_GUARD px of the widget right side must be visible.
  // Left  edge: at least EDGE_GUARD px of the widget left  side must be visible.
  const maxX = widgetW > 0 ? vw - EDGE_GUARD : vw - EDGE_GUARD;
  const minX = widgetW > 0 ? -(widgetW - EDGE_GUARD) : -EDGE_GUARD;

  const maxY = widgetH > 0 ? vh - EDGE_GUARD : vh - EDGE_GUARD;
  const minY = 0; // Never let the top go above 0 (title bar area).

  let cx = Math.min(maxX, Math.max(minX, x));
  let cy = Math.min(maxY, Math.max(minY, y));

  // ── Magnetic edge snapping ─────────────────────────────────────────────────
  let snappedH: ClampedPos["snappedH"] = null;
  let snappedV: ClampedPos["snappedV"] = null;

  if (snap) {
    // Left snap
    if (cx <= SNAP_THRESHOLD) {
      cx = SNAP_OFFSET;
      snappedH = "left";
    }
    // Right snap (right edge of widget near viewport right)
    else if (widgetW > 0 && cx + widgetW >= vw - SNAP_THRESHOLD) {
      cx = vw - widgetW - SNAP_OFFSET;
      snappedH = "right";
    }

    // Top snap
    if (cy <= SNAP_THRESHOLD) {
      cy = SNAP_OFFSET;
      snappedV = "top";
    }
    // Bottom snap
    else if (widgetH > 0 && cy + widgetH >= vh - SNAP_THRESHOLD) {
      cy = vh - widgetH - SNAP_OFFSET;
      snappedV = "bottom";
    }
  }

  return { x: Math.round(cx), y: Math.round(cy), snappedH, snappedV };
}

/**
 * Clamp an already-persisted position back onto the current screen.
 * Call this on mount to fix positions stored when the window was on a
 * larger/different monitor.
 */
export function clampStoredPos(
  pos: { x: number; y: number },
  widgetW = 0,
  widgetH = 0,
): { x: number; y: number } {
  const { x, y } = clampToScreen(pos.x, pos.y, widgetW, widgetH, false);
  return { x, y };
}
