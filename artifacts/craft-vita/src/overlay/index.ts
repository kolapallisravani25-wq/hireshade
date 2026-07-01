/**
 * Overlay module barrel export
 * ─────────────────────────────────────────────────────────────────────────────
 * Import from "@/overlay" for all public overlay infrastructure:
 *   flags, types, root, layers, providers, managers
 */

// Feature flags
export { OverlayFlags, isOverlayFlagEnabled } from "./flags";
export type { OverlayFlagKey } from "./flags";

// Shared types
export type {
  OverlayMode,
  OverlaySessionData,
  InteractiveRegion,
  OverlayDragState,
  PortalAnchor,
  MenuAnchor,
  OverlaySliceState,
} from "./types";

// Root coordinator
export { OverlayRoot } from "./OverlayRoot";

// Layers
export { OverlayEffectsLayer } from "./layers/OverlayEffectsLayer";
export { LauncherLayer } from "./layers/LauncherLayer";
export { SessionLayer } from "./layers/SessionLayer";
export { OverlayPortalLayer } from "./layers/OverlayPortalLayer";

// Portal provider + hook
export { OverlayPortalProvider, useOverlayPortal } from "./providers/OverlayPortalProvider";

// Interactive islands manager + hook
export {
  InteractiveIslandsManager,
  useInteractiveIslands,
} from "./managers/InteractiveIslandsManager";

// Redux actions (re-exported for convenience)
export {
  setOverlayMode,
  setActivePopover,
  setSessionActive,
} from "@/features/launcher/slices/overlaySlice";
