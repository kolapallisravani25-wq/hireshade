/**
 * overlayGeometry — pure geometry + persisted-settings model for the Electron
 * overlay (position presets, opacity, dynamic click-through, private mode).
 *
 * Zero runtime imports: unit-tested by vitest in craft-vita and compiled to
 * CommonJS for artifacts/desktop-electron by scripts/build-main-helpers.js.
 *
 * Persistence contract (main process):
 *   <userData>/overlay-settings.json  — one JSON document, schema below.
 *   Bounds are saved on every user move/resize (debounced) so the overlay
 *   reopens exactly where the user left it; choosing a preset records the
 *   preset name and its computed bounds.
 */

export const OVERLAY_SETTINGS_VERSION = 1;

export const OPACITY_MIN = 0.2;
export const OPACITY_MAX = 1;
export const OPACITY_DEFAULT = 1;
export const OPACITY_STEP = 0.05;

/** Gap (device-independent px) between a preset edge and the work area edge. */
export const PRESET_MARGIN = 16;

export type PositionPreset =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom";

export const SELECTABLE_POSITION_PRESETS: readonly Exclude<PositionPreset, "custom">[] = [
  "top-left",
  "top-center",
  "top-right",
  "center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export const WINDOW_IDS = ["floating", "launcher"] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

export interface WorkArea extends Rect {}

export type WindowBounds = Partial<Record<WindowId, Rect>>;

export interface OverlaySettings {
  readonly version: number;
  /** Window opacity 0.20 - 1.00 (Electron BrowserWindow.setOpacity). */
  readonly opacity: number;
  /** Dynamic click-through hit-testing enabled (T-06). */
  readonly clickThrough: boolean;
  /** Persisted private mode; re-applied via setContentProtection on every show (T-04). */
  readonly isPrivate: boolean;
  /** Last selected preset; becomes "custom" after a manual move. */
  readonly positionPreset: PositionPreset;
  /** Last known bounds per window, restored on next launch. */
  readonly bounds: WindowBounds;
  /** Optional per-action accelerator overrides (validated by hotkeys.ts). */
  readonly hotkeys: Record<string, string>;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  version: OVERLAY_SETTINGS_VERSION,
  opacity: OPACITY_DEFAULT,
  clickThrough: true,
  isPrivate: true,
  positionPreset: "top-center",
  bounds: {},
  hotkeys: {},
};

// ─── Primitives ─────────────────────────────────────────────────────────────

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampOpacity(value: number): number {
  if (!isFiniteNumber(value)) return OPACITY_DEFAULT;
  return Math.round(clamp(value, OPACITY_MIN, OPACITY_MAX) * 100) / 100;
}

export function isPositionPreset(value: unknown): value is PositionPreset {
  return (
    value === "custom" ||
    (typeof value === "string" &&
      (SELECTABLE_POSITION_PRESETS as readonly string[]).includes(value))
  );
}

export function isSelectablePositionPreset(
  value: unknown,
): value is Exclude<PositionPreset, "custom"> {
  return (
    typeof value === "string" &&
    (SELECTABLE_POSITION_PRESETS as readonly string[]).includes(value)
  );
}

export function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const rect = value as Partial<Rect>;
  return (
    isFiniteNumber(rect.x) &&
    isFiniteNumber(rect.y) &&
    isFiniteNumber(rect.width) &&
    isFiniteNumber(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function sanitizeRect(value: unknown): Rect | null {
  if (!isRect(value)) return null;
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.max(1, Math.round(value.width)),
    height: Math.max(1, Math.round(value.height)),
  };
}

export function rectEquals(a: Rect | null | undefined, b: Rect | null | undefined): boolean {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// ─── Geometry ───────────────────────────────────────────────────────────────

/** Clamp a window position so the window stays fully inside the work area. */
export function clampToWorkArea(
  position: Point,
  size: Size,
  workArea: WorkArea,
  margin = 0,
): Point {
  const safeMargin = Math.max(0, margin);
  const maxX = workArea.x + workArea.width - size.width - safeMargin;
  const maxY = workArea.y + workArea.height - size.height - safeMargin;
  const minX = workArea.x + safeMargin;
  const minY = workArea.y + safeMargin;
  // Oversized windows: prefer the top-left edge instead of a negative offset.
  const x = maxX >= minX ? clamp(position.x, minX, maxX) : workArea.x;
  const y = maxY >= minY ? clamp(position.y, minY, maxY) : workArea.y;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Compute the top-left position for a preset inside a display work area. */
export function computePresetPosition(
  workArea: WorkArea,
  windowSize: Size,
  preset: PositionPreset,
  margin = PRESET_MARGIN,
): Point {
  const width = Math.min(windowSize.width, workArea.width);
  const height = Math.min(windowSize.height, workArea.height);
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - width - margin;
  const middleX = workArea.x + (workArea.width - width) / 2;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - height - margin;
  const middleY = workArea.y + (workArea.height - height) / 2;

  let position: Point;
  switch (preset) {
    case "top-left":
      position = { x: left, y: top };
      break;
    case "top-right":
      position = { x: right, y: top };
      break;
    case "bottom-left":
      position = { x: left, y: bottom };
      break;
    case "bottom-right":
      position = { x: right, y: bottom };
      break;
    case "bottom-center":
      position = { x: middleX, y: bottom };
      break;
    case "center":
      position = { x: middleX, y: middleY };
      break;
    case "top-center":
    case "custom":
    default:
      position = { x: middleX, y: top };
      break;
  }
  return clampToWorkArea(position, { width, height }, workArea, 0);
}

/** Preset position + size as a complete bounds object. */
export function boundsForPreset(
  workArea: WorkArea,
  windowSize: Size,
  preset: PositionPreset,
  margin = PRESET_MARGIN,
): Rect {
  const width = Math.min(windowSize.width, workArea.width);
  const height = Math.min(windowSize.height, workArea.height);
  const position = computePresetPosition(workArea, { width, height }, preset, margin);
  return { x: position.x, y: position.y, width, height };
}

/** Nudge a bounds rect by delta, clamped to the work area. */
export function nudgeBounds(
  bounds: Rect,
  delta: Point,
  workArea: WorkArea,
  margin = 0,
): Rect {
  const position = clampToWorkArea(
    { x: bounds.x + delta.x, y: bounds.y + delta.y },
    { width: bounds.width, height: bounds.height },
    workArea,
    margin,
  );
  return { x: position.x, y: position.y, width: bounds.width, height: bounds.height };
}

// ─── Settings parsing / serialization ──────────────────────────────────────

function parseHotkeyOverrides(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, accelerator] of Object.entries(value as Record<string, unknown>)) {
    if (typeof accelerator !== "string") continue;
    const trimmed = accelerator.trim();
    if (trimmed.length === 0 || trimmed.length > 64) continue;
    result[key] = trimmed;
  }
  return result;
}

function parseBounds(value: unknown): WindowBounds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: WindowBounds = {};
  for (const id of WINDOW_IDS) {
    const rect = sanitizeRect((value as Record<string, unknown>)[id]);
    if (rect) result[id] = rect;
  }
  return result;
}

/** Parse persisted JSON (or an untrusted object) into valid settings. */
export function parseSettings(raw: unknown): OverlaySettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_OVERLAY_SETTINGS, bounds: {}, hotkeys: {} };
  }
  const input = raw as Record<string, unknown>;
  return {
    version: OVERLAY_SETTINGS_VERSION,
    opacity: isFiniteNumber(input.opacity)
      ? clampOpacity(input.opacity)
      : DEFAULT_OVERLAY_SETTINGS.opacity,
    clickThrough:
      typeof input.clickThrough === "boolean"
        ? input.clickThrough
        : DEFAULT_OVERLAY_SETTINGS.clickThrough,
    isPrivate:
      typeof input.isPrivate === "boolean"
        ? input.isPrivate
        : DEFAULT_OVERLAY_SETTINGS.isPrivate,
    positionPreset: isPositionPreset(input.positionPreset)
      ? input.positionPreset
      : DEFAULT_OVERLAY_SETTINGS.positionPreset,
    bounds: parseBounds(input.bounds),
    hotkeys: parseHotkeyOverrides(input.hotkeys),
  };
}

/** Parse the settings file contents; tolerates missing/invalid JSON. */
export function parseSettingsJson(text: string | null | undefined): OverlaySettings {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ...DEFAULT_OVERLAY_SETTINGS, bounds: {}, hotkeys: {} };
  }
  try {
    return parseSettings(JSON.parse(text));
  } catch {
    return { ...DEFAULT_OVERLAY_SETTINGS, bounds: {}, hotkeys: {} };
  }
}

/** Stable JSON document written to disk. */
export function serializeSettings(settings: OverlaySettings): string {
  return JSON.stringify(parseSettings(settings), null, 2) + "\n";
}

// ─── Immutable updates ─────────────────────────────────────────────────────

export function applyOpacity(settings: OverlaySettings, opacity: number): OverlaySettings {
  return { ...settings, opacity: clampOpacity(opacity) };
}

export function stepOpacity(settings: OverlaySettings, delta: number): OverlaySettings {
  return applyOpacity(settings, settings.opacity + delta);
}

export function setClickThrough(settings: OverlaySettings, enabled: boolean): OverlaySettings {
  return { ...settings, clickThrough: Boolean(enabled) };
}

export function setPrivateMode(settings: OverlaySettings, enabled: boolean): OverlaySettings {
  return { ...settings, isPrivate: Boolean(enabled) };
}

export function setPositionPreset(
  settings: OverlaySettings,
  preset: PositionPreset,
): OverlaySettings {
  return { ...settings, positionPreset: isPositionPreset(preset) ? preset : "custom" };
}

/**
 * Remember the window's current bounds. A manual move (markCustom = true)
 * demotes the label to "custom" but keeps the exact bounds so the next launch
 * reopens in the same place.
 */
export function recordBounds(
  settings: OverlaySettings,
  windowId: WindowId,
  bounds: Rect,
  markCustom = true,
): OverlaySettings {
  const sanitized = sanitizeRect(bounds);
  if (!sanitized) return settings;
  return {
    ...settings,
    positionPreset: markCustom && windowId === "floating" ? "custom" : settings.positionPreset,
    bounds: { ...settings.bounds, [windowId]: sanitized },
  };
}

/** Remember programmatically applied preset bounds without demoting the preset. */
export function recordPresetBounds(
  settings: OverlaySettings,
  windowId: WindowId,
  bounds: Rect,
): OverlaySettings {
  return recordBounds(settings, windowId, bounds, false);
}

/** Preset label for a fresh baseline (used when no persisted bounds exist). */
export function defaultPresetFor(windowId: WindowId): PositionPreset {
  return windowId === "launcher" ? "center" : DEFAULT_OVERLAY_SETTINGS.positionPreset;
}
