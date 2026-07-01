/**
 * Shared domain types for the unified overlay runtime.
 */

// ─── Overlay Modes ────────────────────────────────────────────────────────────

/**
 * The overlay's primary display mode.
 * - `launcher` — floating widget card (session creation, past sessions)
 * - `session`  — active session panel (transcript, AI answers, controls)
 */
export type OverlayMode = "launcher" | "session";

// ─── Session Info (from Tauri session-init event) ─────────────────────────────

export interface OverlaySessionData {
  sessionId: string;
  isFree: boolean;
  aiModel: string;
  language: string;
  companyName: string;
  startedAt: string | null;
  maxAllowedMinutes: number | null;
}

// ─── Interactive Islands ──────────────────────────────────────────────────────

/**
 * A named interactive region tracked by the InteractiveIslandsManager.
 * rect is in viewport coordinates (pre-scale-adjusted when needed).
 */
export interface InteractiveRegion {
  id: string;
  rect: DOMRect;
  /** When true the region remains interactive during drag (e.g. the drag handle itself) */
  persistDuringDrag?: boolean;
}

// ─── Drag State ───────────────────────────────────────────────────────────────

export interface OverlayDragState {
  isDragging: boolean;
  elementId: string | null;
  startClientX: number;
  startClientY: number;
  startElementX: number;
  startElementY: number;
}

// ─── Portal ───────────────────────────────────────────────────────────────────

export interface PortalAnchor {
  top: number;
  left: number;
  width?: number;
  transformOrigin?: string;
}

// ─── Overlay State (Redux shape) ──────────────────────────────────────────────

export interface MenuAnchor {
  top: number;
  left: number;
}

export interface OverlaySliceState {
  collapsed: boolean;
  menuOpen: boolean;
  menuAnchor: MenuAnchor | null;
  /** Active mode — only meaningful when USE_UNIFIED_OVERLAY is true */
  mode: OverlayMode;
  /** Mutually exclusive popover — ID of the currently open popover, null if none */
  activePopover: string | null;
  /** True once a session has been started; gates private-mode lock behavior */
  sessionActive: boolean;
}
