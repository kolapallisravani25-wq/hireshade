/**
 * usePopupWindowExpand
 * ─────────────────────────────────────────────────────────────────────────────
 * Prevents popup/popover clipping inside a transparent, always-on-top Tauri
 * window by dynamically expanding the native window frame BEFORE the popup
 * becomes visible, then restoring the original size when it closes.
 *
 * ## Why this is necessary
 * `position: fixed` in a Tauri WebView is still bounded by the native macOS
 * window frame.  CSS overflow properties cannot make content escape the OS
 * window boundary — macOS composites everything within the window rect.
 *
 * ## Strategy
 * 1. Caller computes the anchor point (typically trigger.getBoundingClientRect()
 *    .bottom) and the expected popup height (can use a DOM ref or a constant).
 * 2. This hook calculates whether `anchorTop + popupHeight + margin` exceeds
 *    `window.innerHeight`.
 * 3. If expansion is needed, it calls `set_mini_size_instant` (no animation) to
 *    synchronously resize the Tauri window BEFORE setVisible(true) is called.
 * 4. On close, it restores the previous `window.innerHeight`.
 *
 * The caller is responsible for keeping popup content invisible (opacity:0 /
 * not rendered) until `expandReady` is true — that single frame gap is
 * enough for the OS to apply the new window size.
 *
 * ## Usage
 * ```tsx
 * const { expandForPopup, collapseAfterPopup, expandReady } =
 *   usePopupWindowExpand({ popupHeight: 340, bottomMargin: 20 });
 *
 * // On trigger click:
 * const anchorTop = triggerRef.current.getBoundingClientRect().bottom + 6;
 * await expandForPopup(anchorTop);   // awaitable — resolves after resize IPC
 * setIsOpen(true);                   // show popup now — no clip possible
 *
 * // On close:
 * collapseAfterPopup();              // fire-and-forget, instant
 * setIsOpen(false);
 * ```
 */

import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/utils";

/** Width of the mini window — kept constant, only height changes. */
const MINI_W = 700;

interface Options {
  /** Expected maximum height of the popup content in CSS pixels. */
  popupHeight: number;
  /** Minimum gap between popup bottom edge and window bottom edge. */
  bottomMargin?: number;
}

interface Result {
  /**
   * Call before showing the popup.  Pass the pixel distance from the window
   * top to where the popup's top edge will be rendered (anchor.top).
   *
   * Returns a promise that resolves after the native resize IPC completes.
   * The popup should only become visible after this resolves.
   */
  expandForPopup: (anchorTop: number) => Promise<void>;

  /**
   * Call after hiding the popup.  Restores the window to its pre-popup height.
   * Fire-and-forget — no need to await.
   */
  collapseAfterPopup: () => void;
}

export function usePopupWindowExpand({ popupHeight, bottomMargin = 20 }: Options): Result {
  /** The window.innerHeight captured just before expansion. */
  const savedHeightRef = useRef<number | null>(null);

  const expandForPopup = useCallback(async (anchorTop: number): Promise<void> => {
    if (!isTauri()) return;

    const currentH = window.innerHeight;
    const required = Math.ceil(anchorTop + popupHeight + bottomMargin);

    if (required <= currentH) {
      // Window is already tall enough — no resize needed.
      return;
    }

    // Save current height so we can restore it precisely.
    savedHeightRef.current = currentH;

    // Resize synchronously (awaited) so the window frame is the correct size
    // by the time the caller renders the popup.  set_mini_size_instant cancels
    // any in-progress smooth animation to prevent races.
    await invoke("set_mini_size_instant", {
      width: MINI_W,
      height: required,
    });
  }, [popupHeight, bottomMargin]);

  const collapseAfterPopup = useCallback((): void => {
    if (!isTauri()) return;
    if (savedHeightRef.current === null) return;

    const restoreH = savedHeightRef.current;
    savedHeightRef.current = null;

    // Fire-and-forget.  The popup is already removed from the DOM at this
    // point so the visual "shrink" is imperceptible.
    invoke("set_mini_size_instant", {
      width: MINI_W,
      height: restoreH,
    }).catch(console.error);
  }, []);

  return { expandForPopup, collapseAfterPopup };
}
