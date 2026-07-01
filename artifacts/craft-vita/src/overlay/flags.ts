/**
 * Overlay Migration Feature Flags
 * ─────────────────────────────────────────────────────────────────────────────
 * Controls the incremental migration from the current multi-window Tauri
 * architecture to a single fullscreen transparent overlay runtime (Phase 1–5).
 *
 * ALL FLAGS DEFAULT TO FALSE — existing launcher + mini windows continue to
 * work exactly as before until each phase is explicitly enabled.
 *
 * Activation order:
 *   Phase 1:  ENABLE_PORTAL_SYSTEM          (safe — additive only)
 *   Phase 2:  ENABLE_SESSION_LAYER          (moves mini window into launcher window)
 *   Phase 3:  ENABLE_INTERACTIVE_ISLANDS    (replaces useCursorPassthrough)
 *   Phase 4:  USE_UNIFIED_OVERLAY           (enables OverlayRoot coordinator)
 *   Phase 5:  ENABLE_OPACITY_LAYERS         (separates background vs content opacity)
 */
export const OverlayFlags = {
  /**
   * Replace multi-window architecture with a single fullscreen overlay runtime.
   * Enables OverlayRoot as the top-level coordinator inside the launcher window.
   * Requires ENABLE_SESSION_LAYER to also be true for sessions to work.
   */
  USE_UNIFIED_OVERLAY: false,

  /**
   * Render the active session overlay (FloatingApp content) as an internal
   * React layer inside the launcher window instead of a separate Tauri mini window.
   * The mini window will not be created/shown when this flag is active.
   */
  ENABLE_SESSION_LAYER: false,

  /**
   * Use the centralized OverlayPortalProvider for all menus, popovers, dropdowns,
   * and tooltips. Eliminates transform/zoom-induced positioning bugs.
   * Can be enabled independently of other flags.
   */
  ENABLE_PORTAL_SYSTEM: false,

  /**
   * Replace the element-scan-based useCursorPassthrough with the
   * InteractiveIslandsManager which tracks precise DOMRect regions and
   * supports scale transforms, drag, animations, and popover regions.
   */
  ENABLE_INTERACTIVE_ISLANDS: false,

  /**
   * Apply layered opacity so only the glass background fades — text, buttons,
   * answers, and interactive content remain at full opacity.
   * Already implemented in FloatingApp; this flag gates launcher adoption.
   */
  ENABLE_OPACITY_LAYERS: false,
} as const;

export type OverlayFlagKey = keyof typeof OverlayFlags;

/** Runtime check for a single flag */
export function isOverlayFlagEnabled(flag: OverlayFlagKey): boolean {
  return OverlayFlags[flag];
}
