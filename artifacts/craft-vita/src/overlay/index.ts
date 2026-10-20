/**
 * Overlay module barrel export
 * ─────────────────────────────────────────────────────────────────────────────
 * Import from "@/overlay" for all public overlay infrastructure:
 *   flags, types, root, layers, providers, managers
 */

// Feature flags
export { OverlayFlags, isOverlayFlagEnabled } from "./flags";
export type { OverlayFlagKey } from "./flags";

// Desktop hotkey model (shared with the Electron shell)
export {
  APP_HOTKEYS,
  DEFAULT_HOTKEYS,
  DEFAULT_MODEL_CYCLE,
  DESKTOP_IPC,
  HOTKEY_EVENT_CHANNEL,
  HOTKEY_ACTIONS,
  LIVE_CALL_HOTKEYS,
  POINTER_PASS_THROUGH_CHANNEL,
  bindingsForSet,
  canonicalizeAccelerator,
  cycleValue,
  findConflicts,
  formatAccelerator,
  isReservedAccelerator,
  keyEventToAccelerator,
  matchesKeyboardEvent,
  nextModel,
  normalizeKey,
  normalizePlatform,
  resolveHotkeys,
  tryParseAccelerator,
  validateAccelerator,
} from "./hotkeys";
export type {
  AcceleratorParseResult,
  AcceleratorValidation,
  HotkeyAction,
  HotkeyBinding,
  HotkeyIssue,
  HotkeyOverrides,
  HotkeySet,
  KeyboardEventLike,
  OverlayPlatform,
  ParsedAccelerator,
  ResolvedHotkeys,
} from "./hotkeys";

// Desktop overlay geometry + persisted settings model
export {
  DEFAULT_OVERLAY_SETTINGS,
  OPACITY_DEFAULT,
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
  OVERLAY_SETTINGS_VERSION,
  PRESET_MARGIN,
  SELECTABLE_POSITION_PRESETS,
  WINDOW_IDS,
  applyOpacity,
  boundsForPreset,
  clampOpacity,
  clampToWorkArea,
  computePresetPosition,
  defaultPresetFor,
  isPositionPreset,
  isRect,
  isSelectablePositionPreset,
  nudgeBounds,
  parseSettings,
  parseSettingsJson,
  recordBounds,
  recordPresetBounds,
  rectEquals,
  sanitizeRect,
  serializeSettings,
  setClickThrough,
  setPositionPreset,
  setPrivateMode,
  stepOpacity,
} from "./overlayGeometry";
export type {
  OverlaySettings,
  Point,
  PositionPreset,
  Rect,
  Size,
  WindowBounds,
  WindowId,
  WorkArea,
} from "./overlayGeometry";

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
