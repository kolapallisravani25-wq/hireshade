/**
 * Overlay preset model (O1 / EXT G-044): five presets with geometry,
 * typography, opacity and scrim; pure functions only (no DOM, no globals).
 *
 * Presets:
 *   COMPACT      - small card, top-right, minimal footprint
 *   BANNER       - DEFAULT: full width minus margins, 35-40% screen height,
 *                  docked to the bottom edge
 *   TELEPROMPTER - band as close to the webcam / top-center as possible
 *   SIDE-COLUMN  - 30-35% width, docked left or right, near full height
 *   READING      - near full-screen, dimmed scrim, long-form reading
 *
 * Persistence is per preset: each preset remembers its own bounds/opacity/side
 * (localStorage key OVERLAY_PRESET_STORAGE_KEY), so switching presets never
 * destroys a tuned layout.
 */
import {
  OPACITY_MAX,
  OPACITY_MIN,
  OPACITY_STEP,
  clamp,
  clampOpacity,
} from "../overlayGeometry";
import {
  MIN_READABLE_FONT_PX,
  resolveTypography,
  computeDpiProfile,
} from "./readability";
import type {
  OverlayPreset,
  OverlayPresetId,
  PersistedPresetState,
  PersistedPresetStore,
  PresetLayout,
  PresetState,
  SideColumnSide,
  ViewportSize,
} from "./types";
import {
  DEFAULT_OVERLAY_PRESET,
  OVERLAY_PRESET_IDS,
} from "./types";

export const OVERLAY_PRESET_STORAGE_KEY = "hireshade.overlay.presets.v1";
export const OVERLAY_PRESET_STORE_VERSION = 1;
export const SNAP_TO_EDGE_THRESHOLD_PX = 24;
export const MIN_DRAG_AREA_PX = 40;

export const PRESETS: Readonly<Record<OverlayPresetId, OverlayPreset>> = {
  compact: {
    id: "compact",
    label: "Compact",
    description: "Small card in the top-right corner; least intrusive.",
    defaultOpacity: 0.84,
    scrimAlpha: 0.82,
    scrimColor: "#05070c",
    textColor: "#f7faff",
    geometry: {
      widthRatio: 0.36,
      minWidthPx: 360,
      maxWidthPx: 560,
      heightRatio: 0.24,
      minHeightPx: 170,
      maxHeightRatio: 0.3,
      anchor: "top-right",
      marginPx: 16,
    },
    typography: {
      minFontPx: 16,
      baseFontPx: 19,
      maxFontPx: 24,
      lineHeightRatio: 1.55,
      maxCh: 62,
      hookScale: 1.15,
    },
    paddingPx: 16,
    radiusPx: 16,
    answerViewportMaxPx: 180,
    dragAreaPx: 44,
    resizeHandlePx: 28,
    fullScreenScrimAlpha: 0,
  },
  banner: {
    id: "banner",
    label: "Banner",
    description: "Full width minus margins, 35-40% screen height, docked bottom.",
    defaultOpacity: 0.86,
    scrimAlpha: 0.8,
    scrimColor: "#05070c",
    textColor: "#f7faff",
    geometry: {
      widthRatio: 1,
      minWidthPx: 420,
      heightRatio: 0.38,
      minHeightPx: 240,
      maxHeightRatio: 0.4,
      anchor: "bottom-center",
      marginPx: 24,
    },
    typography: {
      minFontPx: 16,
      baseFontPx: 22,
      maxFontPx: 28,
      lineHeightRatio: 1.55,
      maxCh: 75,
      hookScale: 1.2,
    },
    paddingPx: 20,
    radiusPx: 18,
    answerViewportMaxPx: 300,
    dragAreaPx: 44,
    resizeHandlePx: 28,
    fullScreenScrimAlpha: 0,
  },
  teleprompter: {
    id: "teleprompter",
    label: "Teleprompter",
    description: "Band at top-center, as close to the webcam as possible.",
    defaultOpacity: 0.88,
    scrimAlpha: 0.84,
    scrimColor: "#04060a",
    textColor: "#f8fbff",
    geometry: {
      widthRatio: 0.72,
      minWidthPx: 480,
      maxWidthPx: 1120,
      heightRatio: 0.26,
      minHeightPx: 170,
      maxHeightRatio: 0.3,
      anchor: "top-center",
      marginPx: 12,
    },
    typography: {
      minFontPx: 16,
      baseFontPx: 26,
      maxFontPx: 34,
      lineHeightRatio: 1.5,
      maxCh: 64,
      hookScale: 1.15,
    },
    paddingPx: 18,
    radiusPx: 16,
    answerViewportMaxPx: 220,
    dragAreaPx: 48,
    resizeHandlePx: 30,
    fullScreenScrimAlpha: 0,
  },
  "side-column": {
    id: "side-column",
    label: "Side column",
    description: "Narrow column (30-35% width) docked left or right, near full height.",
    defaultOpacity: 0.9,
    scrimAlpha: 0.82,
    scrimColor: "#05070c",
    textColor: "#f7faff",
    geometry: {
      widthRatio: 0.32,
      minWidthPx: 300,
      minWidthRatio: 0.3,
      maxWidthRatio: 0.35,
      heightRatio: 0.9,
      minHeightPx: 420,
      maxHeightRatio: 0.94,
      anchor: "side-right",
      marginPx: 16,
      side: "right",
    },
    typography: {
      minFontPx: 16,
      baseFontPx: 21,
      maxFontPx: 26,
      lineHeightRatio: 1.55,
      maxCh: 58,
      hookScale: 1.15,
    },
    paddingPx: 18,
    radiusPx: 18,
    answerViewportMaxPx: 380,
    dragAreaPx: 44,
    resizeHandlePx: 28,
    fullScreenScrimAlpha: 0,
  },
  reading: {
    id: "reading",
    label: "Reading",
    description: "Near full-screen with a dimmed scrim for long answers.",
    defaultOpacity: 0.96,
    scrimAlpha: 0.72,
    scrimColor: "#03050a",
    textColor: "#f8fbff",
    geometry: {
      widthRatio: 0.94,
      minWidthPx: 640,
      heightRatio: 0.9,
      minHeightPx: 520,
      maxHeightRatio: 0.92,
      anchor: "center",
      marginPx: 24,
    },
    typography: {
      minFontPx: 16,
      baseFontPx: 22,
      maxFontPx: 30,
      lineHeightRatio: 1.6,
      maxCh: 75,
      hookScale: 1.2,
    },
    paddingPx: 24,
    radiusPx: 20,
    answerViewportMaxPx: 720,
    dragAreaPx: 44,
    resizeHandlePx: 28,
    fullScreenScrimAlpha: 0.55,
  },
};

export const PRESET_LIST: readonly OverlayPreset[] = OVERLAY_PRESET_IDS.map(
  (id) => PRESETS[id],
);

export function isOverlayPresetId(value: unknown): value is OverlayPresetId {
  return typeof value === "string" && (OVERLAY_PRESET_IDS as readonly string[]).includes(value);
}

export function getPreset(id: OverlayPresetId): OverlayPreset {
  return PRESETS[id] ?? PRESETS[DEFAULT_OVERLAY_PRESET];
}

export function nextPresetId(id: OverlayPresetId, direction = 1): OverlayPresetId {
  const index = OVERLAY_PRESET_IDS.indexOf(id);
  const length = OVERLAY_PRESET_IDS.length;
  const next = (index + (direction >= 0 ? 1 : length - 1)) % length;
  return OVERLAY_PRESET_IDS[next] ?? DEFAULT_OVERLAY_PRESET;
}

// --- Layout -----------------------------------------------------------------

export interface LayoutOverrides {
  readonly side?: SideColumnSide | null;
  readonly persisted?: PersistedPresetState | null;
}

function clampToViewport(rect: { x: number; y: number; width: number; height: number }, viewport: ViewportSize) {
  const width = Math.min(rect.width, Math.max(1, viewport.width));
  const height = Math.min(rect.height, Math.max(1, viewport.height));
  return {
    width,
    height,
    x: Math.round(clamp(rect.x, 0, Math.max(0, viewport.width - width))),
    y: Math.round(clamp(rect.y, 0, Math.max(0, viewport.height - height))),
  };
}

/** Computes a preset's bounds for a viewport, honouring per-preset overrides. */
export function computePresetLayout(
  id: OverlayPresetId,
  viewport: ViewportSize,
  overrides: LayoutOverrides = {},
): PresetLayout {
  const preset = getPreset(id);
  const g = preset.geometry;
  const margin = Math.max(0, g.marginPx);
  const maxWidth = Math.max(1, viewport.width - margin * 2);
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const side = overrides.side ?? overrides.persisted?.side ?? g.side ?? null;

  const widthFloor = Math.min(
    Math.max(g.minWidthPx, Math.round(viewport.width * (g.minWidthRatio ?? 0))),
    maxWidth,
  );
  const widthCeiling = Math.max(
    1,
    Math.min(
      g.maxWidthPx ?? maxWidth,
      Math.round(viewport.width * (g.maxWidthRatio ?? 1)),
      maxWidth,
    ),
  );
  let width = clamp(Math.round(viewport.width * g.widthRatio), widthFloor, widthCeiling);
  let height = clamp(
    Math.round(viewport.height * g.heightRatio),
    Math.min(g.minHeightPx, maxHeight),
    Math.min(Math.round(viewport.height * (g.maxHeightRatio ?? 0.94)), maxHeight),
  );

  let x: number;
  let y: number;
  const anchor = g.anchor;
  if (anchor === "side-left" || anchor === "side-right") {
    x = side === "left" ? margin : viewport.width - width - margin;
  } else if (anchor === "top-left") x = margin;
  else if (anchor === "top-right") x = viewport.width - width - margin;
  else x = Math.round((viewport.width - width) / 2);
  if (anchor === "bottom-center") y = viewport.height - height - margin;
  else if (anchor === "center") y = Math.round((viewport.height - height) / 2);
  else if (anchor === "side-left" || anchor === "side-right") y = Math.round((viewport.height - height) / 2);
  else y = margin;

  const persisted = overrides.persisted;
  let restored = false;
  if (persisted) {
    const hasBounds =
      persisted.xRatio !== null &&
      persisted.yRatio !== null &&
      persisted.widthRatio !== null &&
      persisted.heightRatio !== null;
    if (hasBounds) {
      width = clamp(
        Math.round(persisted.widthRatio! * viewport.width),
        widthFloor,
        widthCeiling,
      );
      height = clamp(
        Math.round(persisted.heightRatio! * viewport.height),
        Math.min(g.minHeightPx, maxHeight),
        Math.min(Math.round(viewport.height * (g.maxHeightRatio ?? 0.94)), maxHeight),
      );
      x = Math.round(persisted.xRatio! * viewport.width);
      y = Math.round(persisted.yRatio! * viewport.height);
      restored = true;
    }
  }

  const clamped = clampToViewport({ x, y, width, height }, viewport);
  return {
    preset: id,
    bounds: { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height },
    side: id === "side-column" ? (side ?? "right") : null,
    restored,
  };
}

export function maxPresetSize(id: OverlayPresetId, viewport: ViewportSize): { width: number; height: number } {
  const preset = getPreset(id);
  const margin = preset.geometry.marginPx;
  return {
    width: Math.max(1, viewport.width - margin * 2),
    height: Math.max(1, viewport.height - margin * 2),
  };
}

/** Resize from the bottom-right grip; clamps to preset min/max and the viewport. */
export function resizePresetLayout(
  layout: PresetLayout,
  delta: { dx: number; dy: number },
  viewport: ViewportSize,
): PresetLayout {
  const preset = getPreset(layout.preset);
  const g = preset.geometry;
  const max = maxPresetSize(layout.preset, viewport);
  const maxWidth = Math.max(
    1,
    Math.min(
      max.width,
      g.maxWidthPx ?? max.width,
      Math.round(viewport.width * (g.maxWidthRatio ?? 1)),
    ),
  );
  const maxHeight = Math.max(
    1,
    Math.min(max.height, Math.round(viewport.height * (g.maxHeightRatio ?? 1))),
  );
  const minWidth = Math.min(
    Math.max(g.minWidthPx, Math.round(viewport.width * (g.minWidthRatio ?? 0))),
    maxWidth,
  );
  const minHeight = Math.min(g.minHeightPx, maxHeight);
  const width = clamp(Math.round(layout.bounds.width + delta.dx), minWidth, maxWidth);
  const height = clamp(Math.round(layout.bounds.height + delta.dy), minHeight, maxHeight);
  return {
    ...layout,
    bounds: {
      x: layout.bounds.x,
      y: layout.bounds.y,
      width,
      height,
    },
    restored: false,
  };
}

export interface SnappedLayout {
  readonly layout: PresetLayout;
  readonly snapped: readonly ("left" | "right" | "top" | "bottom")[];
}

/** Snap-to-edge with a generous threshold (default 24px). */
export function snapLayoutToEdges(
  layout: PresetLayout,
  viewport: ViewportSize,
  threshold = SNAP_TO_EDGE_THRESHOLD_PX,
): SnappedLayout {
  const preset = getPreset(layout.preset);
  const margin = preset.geometry.marginPx;
  const rightX = viewport.width - layout.bounds.width - margin;
  const bottomY = viewport.height - layout.bounds.height - margin;
  const snapped: ("left" | "right" | "top" | "bottom")[] = [];
  let x = layout.bounds.x;
  let y = layout.bounds.y;
  if (Math.abs(x - margin) <= threshold) {
    x = margin;
    snapped.push("left");
  } else if (Math.abs(x - rightX) <= threshold) {
    x = rightX;
    snapped.push("right");
  }
  if (Math.abs(y - margin) <= threshold) {
    y = margin;
    snapped.push("top");
  } else if (Math.abs(y - bottomY) <= threshold) {
    y = bottomY;
    snapped.push("bottom");
  }
  return {
    layout: { ...layout, bounds: { ...layout.bounds, x: Math.round(x), y: Math.round(y) } },
    snapped,
  };
}

/** Moves a preset (drag): clamped to the viewport, then edge-snapped. */
export function movePresetLayout(
  layout: PresetLayout,
  position: { x: number; y: number },
  viewport: ViewportSize,
  opts: { snap?: boolean } = {},
): SnappedLayout {
  const clamped = clampToViewport({ ...position, width: layout.bounds.width, height: layout.bounds.height }, viewport);
  const moved: PresetLayout = {
    ...layout,
    bounds: { x: clamped.x, y: clamped.y, width: clamped.width, height: clamped.height },
    restored: false,
  };
  return opts.snap === false ? { layout: moved, snapped: [] } : snapLayoutToEdges(moved, viewport);
}

// --- State ------------------------------------------------------------------

export function presetStateFor(
  id: OverlayPresetId,
  viewport: ViewportSize,
  options: {
    devicePixelRatio?: number;
    persisted?: PersistedPresetState | null;
    clickThrough?: boolean;
  } = {},
): PresetState {
  const preset = getPreset(id);
  const layout = computePresetLayout(id, viewport, { persisted: options.persisted });
  const profile = computeDpiProfile({
    viewport,
    devicePixelRatio: options.devicePixelRatio ?? 1,
  });
  return {
    preset: id,
    layout,
    opacity: clampOpacity(options.persisted?.opacity ?? preset.defaultOpacity),
    clickThrough: options.clickThrough ?? true,
    typography: resolveTypography(preset, profile),
    scrimAlpha: preset.scrimAlpha,
    scrimColor: preset.scrimColor,
    textColor: preset.textColor,
    maxCh: preset.typography.maxCh,
  };
}

// --- Persistence ------------------------------------------------------------

export interface PresetStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function emptyPresetStore(): PersistedPresetStore {
  return { version: OVERLAY_PRESET_STORE_VERSION, active: DEFAULT_OVERLAY_PRESET, perPreset: {} };
}

function ratioOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100000) / 100000 : null;
}

function parsePersistedPreset(
  id: OverlayPresetId,
  raw: unknown,
): PersistedPresetState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const clampRatio = (value: unknown) => {
    const ratio = ratioOrNull(value);
    return ratio === null ? null : Math.max(-0.5, Math.min(1.5, ratio));
  };
  return {
    preset: id,
    xRatio: clampRatio(input.xRatio),
    yRatio: clampRatio(input.yRatio),
    widthRatio: clampRatio(input.widthRatio),
    heightRatio: clampRatio(input.heightRatio),
    opacity: clampOpacity(typeof input.opacity === "number" ? input.opacity : getPreset(id).defaultOpacity),
    side: input.side === "left" || input.side === "right" ? input.side : null,
  };
}

export function parsePresetStore(raw: unknown): PersistedPresetStore {
  if (typeof raw !== "object" || raw === null) return emptyPresetStore();
  const input = raw as Record<string, unknown>;
  const active = isOverlayPresetId(input.active) ? input.active : DEFAULT_OVERLAY_PRESET;
  const perPreset: Partial<Record<OverlayPresetId, PersistedPresetState>> = {};
  const rawPerPreset = input.perPreset;
  if (typeof rawPerPreset === "object" && rawPerPreset !== null) {
    for (const id of OVERLAY_PRESET_IDS) {
      const parsed = parsePersistedPreset(id, (rawPerPreset as Record<string, unknown>)[id]);
      if (parsed) perPreset[id] = parsed;
    }
  }
  return { version: OVERLAY_PRESET_STORE_VERSION, active, perPreset };
}

export function parsePresetStoreJson(text: string | null | undefined): PersistedPresetStore {
  if (typeof text !== "string" || text.trim().length === 0) return emptyPresetStore();
  try {
    return parsePresetStore(JSON.parse(text));
  } catch {
    return emptyPresetStore();
  }
}

export function serializePresetStore(store: PersistedPresetStore): string {
  return JSON.stringify(parsePresetStore(store), null, 2) + "\n";
}

export function loadPresetStore(storage: PresetStorageLike | null | undefined): PersistedPresetStore {
  if (!storage) return emptyPresetStore();
  try {
    return parsePresetStoreJson(storage.getItem(OVERLAY_PRESET_STORAGE_KEY));
  } catch {
    return emptyPresetStore();
  }
}

export function savePresetStore(
  storage: PresetStorageLike | null | undefined,
  store: PersistedPresetStore,
): void {
  if (!storage) return;
  try {
    storage.setItem(OVERLAY_PRESET_STORAGE_KEY, serializePresetStore(store));
  } catch {
    // Quota / disabled storage must never break the overlay.
  }
}

export function storePresetState(
  store: PersistedPresetStore,
  layout: PresetLayout,
  viewport: ViewportSize,
  opacity: number,
): PersistedPresetStore {
  const state: PersistedPresetState = {
    preset: layout.preset,
    xRatio: ratioOrNull(layout.bounds.x / Math.max(1, viewport.width)),
    yRatio: ratioOrNull(layout.bounds.y / Math.max(1, viewport.height)),
    widthRatio: ratioOrNull(layout.bounds.width / Math.max(1, viewport.width)),
    heightRatio: ratioOrNull(layout.bounds.height / Math.max(1, viewport.height)),
    opacity: clampOpacity(opacity),
    side: layout.side,
  };
  return {
    ...store,
    active: layout.preset,
    perPreset: { ...store.perPreset, [layout.preset]: state },
  };
}

export function presetStateForStore(
  store: PersistedPresetStore,
  id: OverlayPresetId,
): PersistedPresetState | null {
  return store.perPreset[id] ?? null;
}

export function setStoreActivePreset(
  store: PersistedPresetStore,
  id: OverlayPresetId,
): PersistedPresetStore {
  return { ...store, active: id };
}

// --- Opacity / click-through helpers ----------------------------------------

export function stepPresetOpacity(opacity: number, delta: number): number {
  return clampOpacity(opacity + delta);
}

export function clampPresetOpacity(opacity: number): number {
  return clampOpacity(opacity);
}

export { OPACITY_MIN, OPACITY_MAX, OPACITY_STEP, MIN_READABLE_FONT_PX };

// --- Style patch (the only properties the adapter may write) ----------------

export const PRESET_STYLE_PROPERTIES = [
  "width",
  "height",
  "transform",
  "opacity",
  "borderRadius",
  "padding",
  "background",
  "backdropFilter",
  "maxWidth",
  "--overlay-font-px",
  "--overlay-hook-font-px",
  "--overlay-bullet-font-px",
  "--overlay-line-height-px",
  "--overlay-line-height-ratio",
  "--overlay-max-ch",
  "--overlay-scrim",
  "--overlay-scrim-color",
  "--overlay-scrim-alpha",
  "--overlay-text",
  "--overlay-drag-area",
  "--overlay-resize-handle",
  "--overlay-viewport-max",
  "--overlay-padding",
  "--overlay-full-scrim",
] as const;

export type PresetStyleProperty = (typeof PRESET_STYLE_PROPERTIES)[number];

/**
 * CSS patch for a preset state. Position is expressed ONLY as a transform so a
 * re-layout is a compositor-only update (one frame, no layout thrash).
 */
export function presetStylePatch(state: PresetState): Record<PresetStyleProperty, string> {
  const preset = getPreset(state.preset);
  const { x, y, width, height } = state.layout.bounds;
  return {
    width: width + "px",
    height: height + "px",
    transform: "translate3d(" + x + "px, " + y + "px, 0)",
    opacity: String(state.opacity),
    borderRadius: preset.radiusPx + "px",
    padding: preset.paddingPx + "px",
    background:
      "linear-gradient(180deg, rgba(20,24,34,0.96), " +
      state.scrimColor +
      ")",
    backdropFilter: "blur(16px) saturate(140%)",
    maxWidth: "none",
    "--overlay-font-px": state.typography.fontPx + "px",
    "--overlay-hook-font-px": state.typography.hookFontPx + "px",
    "--overlay-bullet-font-px": state.typography.bulletFontPx + "px",
    "--overlay-line-height-px": state.typography.lineHeightPx + "px",
    "--overlay-line-height-ratio": String(state.typography.lineHeightRatio),
    "--overlay-max-ch": String(state.maxCh),
    "--overlay-scrim": "rgba(3,5,10," + state.scrimAlpha + ")",
    "--overlay-scrim-color": state.scrimColor,
    "--overlay-scrim-alpha": String(state.scrimAlpha),
    "--overlay-text": state.textColor,
    "--overlay-drag-area": preset.dragAreaPx + "px",
    "--overlay-resize-handle": preset.resizeHandlePx + "px",
    "--overlay-viewport-max": preset.answerViewportMaxPx + "px",
    "--overlay-padding": preset.paddingPx + "px",
    "--overlay-full-scrim": "rgba(0,0,0," + preset.fullScreenScrimAlpha + ")",
  };
}

export function isPresetStyleProperty(value: string): value is PresetStyleProperty {
  return (PRESET_STYLE_PROPERTIES as readonly string[]).includes(value);
}

export function presetAriaLabel(id: OverlayPresetId): string {
  const preset = getPreset(id);
  return preset.label + " overlay preset — " + preset.description;
}

export function presetSummary(id: OverlayPresetId): string {
  const preset = getPreset(id);
  return preset.label + ": " + preset.description;
}

export { OVERLAY_PRESET_IDS, DEFAULT_OVERLAY_PRESET };
