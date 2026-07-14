/**
 * ResizeHandles — invisible edge/corner grab zones for the frameless mini
 * overlay window. Renders 8 absolutely-positioned strips (4 edges + 4
 * corners) with resize cursors. On mousedown, delegates to Tauri's native
 * `startResizeDragging(direction)` so the OS handles the actual drag.
 *
 * Why this exists in JS instead of Rust:
 * The mini window hosts WebView2 as a child HWND that fills the entire
 * client area. Native WM_NCHITTEST on the parent HWND never fires for
 * cursor positions inside the client rect — the WebView2 child intercepts
 * mouse messages first. So the only way to get resize working on a
 * frameless Tauri window is from the JS side, using the officially
 * supported `startResizeDragging` API.
 *
 * Handle geometry:
 * - Edges are 6px thick strips inset from the corners by 12px (so they
 *   don't overlap the corner handles which take priority).
 * - Corners are 12x12 squares in each corner.
 * - z-index high so they sit above the FloatingSurface glass card but
 *   still below any modal / dropdown portals.
 * - pointer-events:auto and data-interactive so useCursorPassthrough
 *   never turns them into click-through zones.
 * - background:transparent so they're invisible in normal state.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CSSProperties, RefObject } from "react";

// The 8 resize directions Tauri understands. String literals match
// tauri::ResizeDirection variants exactly (case-sensitive).
type ResizeDirection =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

interface HandleSpec {
  direction: ResizeDirection;
  cursor: string;
  style: CSSProperties;
}

// EDGE thickness and CORNER size in px. Corners are square; edges are
// strips inset to leave room for the corner handles.
const EDGE = 6;
const CORNER = 12;

const HANDLES: HandleSpec[] = [
  // Corners (take priority — mounted last so highest in DOM order at
  // same z-index; also inherently no overlap issue since they're
  // corner-locked).
  { direction: "NorthWest", cursor: "nwse-resize",
    style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { direction: "NorthEast", cursor: "nesw-resize",
    style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { direction: "SouthWest", cursor: "nesw-resize",
    style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { direction: "SouthEast", cursor: "nwse-resize",
    style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
  // Edges (inset by CORNER on each end so corners can win the hit-test).
  { direction: "North", cursor: "ns-resize",
    style: { top: 0, left: CORNER, right: CORNER, height: EDGE } },
  { direction: "South", cursor: "ns-resize",
    style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE } },
  { direction: "West", cursor: "ew-resize",
    style: { top: CORNER, bottom: CORNER, left: 0, width: EDGE } },
  { direction: "East", cursor: "ew-resize",
    style: { top: CORNER, bottom: CORNER, right: 0, width: EDGE } },
];

interface ResizeHandlesProps {
  /**
   * Shared ref from FloatingApp's useCursorPassthrough call. We must set
   * this to true for the entire duration of the native resize drag,
   * otherwise the cursor-passthrough poll (which fires every 120 ms on
   * Windows) will detect that the cursor is "outside" any [data-interactive]
   * rect — because the window is mid-resize and the cached window bounds
   * are stale — and call `setIgnoreCursorEvents(true)`. That immediately
   * terminates the OS-level resize because the window stops receiving mouse
   * messages. This ref is the same fast-path the drag-to-move handler uses
   * (see handleGripMouseDown in FloatingApp).
   */
  isDraggingRef: RefObject<boolean>;
}

/**
 * Absolutely-positioned resize grab zones for a frameless Tauri window.
 * MUST be placed inside a positioned parent (position:relative or absolute)
 * that represents the window's visible bounds — typically the widget shell
 * in FloatingApp Layer 2.
 */
export function ResizeHandles({ isDraggingRef }: ResizeHandlesProps) {
  const onMouseDown = (direction: ResizeDirection) =>
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only left-click initiates resize. Right/middle click reserved for
      // future context menu / paste actions.
      if (e.button !== 0) return;
      // preventDefault stops React text-selection while dragging; stops the
      // browser from also firing its own edge-drag behaviors.
      e.preventDefault();
      e.stopPropagation();

      // CRITICAL: pin passthrough to INTERACTIVE for the whole drag. Without
      // this, useCursorPassthrough's poll loop sees the cursor "outside" the
      // (moving/resizing) window and toggles ignoreCursorEvents on, which
      // yanks the window out from under the native drag. We reset on the
      // next global mouseup no matter where the release happens.
      isDraggingRef.current = true;
      const release = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mouseup", release);
        window.removeEventListener("blur", release);
      };
      document.addEventListener("mouseup", release);
      // If the OS captures focus for the drag and mouseup never fires in
      // our window, blur is our safety net so we don't get stuck pinned
      // interactive.
      window.addEventListener("blur", release);

      // Fire and forget. `.catch` guards against the promise rejecting when
      // the mini window isn't focused (Windows sometimes rejects the first
      // resize call after a focus switch — harmless).
      getCurrentWindow()
        .startResizeDragging(direction as unknown as never)
        .catch(() => {
          // OS did not initiate the drag — release the passthrough pin now
          // so the user isn't stuck with a permanently-interactive window.
          release();
        });
    };

  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.direction}
          data-interactive
          data-resize-handle={h.direction}
          onMouseDown={onMouseDown(h.direction)}
          style={{
            position: "absolute",
            cursor: h.cursor,
            // Transparent background so handles are invisible — the whole
            // point is that users see the glass card, not resize UI.
            background: "transparent",
            // Above the card but below portaled overlays (z-index:50+).
            zIndex: 20,
            // pointerEvents:auto so this catches mousedown even if the
            // parent widget shell is set to pointer-events:none somewhere.
            pointerEvents: "auto",
            // touchAction:none prevents accidental scroll-hijack on
            // trackpads / touchscreens when the user starts a resize drag.
            touchAction: "none",
            ...h.style,
          }}
        />
      ))}
    </>
  );
}
