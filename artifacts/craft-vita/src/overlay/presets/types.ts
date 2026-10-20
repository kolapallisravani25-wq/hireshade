/**
 * Overlay preset model types (O1 / EXT G-044).
 *
 * Pure, zero-DOM types shared by the preset model, the readability/auto-fit
 * helpers, the framework-free DOM adapter and the Electron/CDP demo harness.
 */

export type OverlayPresetId =
  | "compact"
  | "banner"
  | "teleprompter"
  | "side-column"
  | "reading";

export const OVERLAY_PRESET_IDS: readonly OverlayPresetId[] = [
  "compact",
  "banner",
  "teleprompter",
  "side-column",
  "reading",
];

/** Default preset: full width minus margins, 35-40% screen height, docked bottom. */
export const DEFAULT_OVERLAY_PRESET: OverlayPresetId = "banner";

export type SideColumnSide = "left" | "right";

export type PresetAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-center"
  | "center"
  | "side-left"
  | "side-right";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PresetGeometrySpec {
  /** Fraction of the viewport width (before min/max clamping). */
  readonly widthRatio: number;
  readonly minWidthPx: number;
  /** Optional absolute cap; fallback is viewport width minus margins. */
  readonly maxWidthPx?: number;
  /** Optional lower/upper fractions enforced for the width (side column). */
  readonly minWidthRatio?: number;
  readonly maxWidthRatio?: number;
  /** Fraction of the viewport height. */
  readonly heightRatio: number;
  readonly minHeightPx: number;
  /** Optional height ceiling as a fraction of the viewport. */
  readonly maxHeightRatio?: number;
  readonly anchor: PresetAnchor;
  /** Gap from the work-area edges. */
  readonly marginPx: number;
  /** Side column only. */
  readonly side?: SideColumnSide;
}

export interface PresetTypographySpec {
  /** Smallest CSS font size allowed at this preset (never below 16). */
  readonly minFontPx: number;
  readonly baseFontPx: number;
  readonly maxFontPx: number;
  /** >= 1.5 by contract; encoded in the preset table. */
  readonly lineHeightRatio: number;
  /** Hard cap on measure: never wider than 75ch. */
  readonly maxCh: number;
  /** Hook (first line) scale relative to the body font. */
  readonly hookScale: number;
}

export interface OverlayPreset {
  readonly id: OverlayPresetId;
  readonly label: string;
  readonly description: string;
  /** Window opacity applied when the preset is selected (semi-transparent). */
  readonly defaultOpacity: number;
  /** Scrim opacity behind the text; chosen to reach >= 7:1 contrast. */
  readonly scrimAlpha: number;
  /** Scrim colour (near-black, keeps text contrast stable over bright video). */
  readonly scrimColor: string;
  readonly textColor: string;
  readonly geometry: PresetGeometrySpec;
  readonly typography: PresetTypographySpec;
  readonly paddingPx: number;
  readonly radiusPx: number;
  /** Max height of the scrollable answer pane inside this preset. */
  readonly answerViewportMaxPx: number;
  /** Generous drag area at the top edge of the surface. */
  readonly dragAreaPx: number;
  /** Generous resize grip at the bottom-right corner. */
  readonly resizeHandlePx: number;
  /** Extra full-screen dim behind the surface (READING only; 0 otherwise). */
  readonly fullScreenScrimAlpha: number;
}

/** What gets persisted per preset (fractions so other displays keep the layout). */
export interface PersistedPresetState {
  readonly preset: OverlayPresetId;
  /** Bounds as fractions of the viewport; null means "use preset defaults". */
  readonly xRatio: number | null;
  readonly yRatio: number | null;
  readonly widthRatio: number | null;
  readonly heightRatio: number | null;
  readonly opacity: number;
  readonly side: SideColumnSide | null;
}

export interface PersistedPresetStore {
  readonly version: number;
  readonly active: OverlayPresetId;
  readonly perPreset: Partial<Record<OverlayPresetId, PersistedPresetState>>;
}

export interface PresetLayout {
  readonly preset: OverlayPresetId;
  readonly bounds: Rect;
  readonly side: SideColumnSide | null;
  /** True when the layout came from persisted per-preset state. */
  readonly restored: boolean;
}

export interface DpiProfile {
  readonly viewport: ViewportSize;
  readonly devicePixelRatio: number;
  /** Classification for docs/tests: sm < 900px, md < 1440, lg < 2200, xl beyond. */
  readonly density: "sm" | "md" | "lg" | "xl";
  /** Multiplier applied to the preset base font (0.9 - 1.25). */
  readonly fontScale: number;
}

export interface ResolvedTypography {
  readonly fontPx: number;
  readonly hookFontPx: number;
  readonly bulletFontPx: number;
  readonly lineHeightPx: number;
  readonly lineHeightRatio: number;
  readonly maxCh: number;
  /** >= 16 by contract, even at the smallest preset / viewport. */
  readonly minFontPx: number;
}

export interface PresetState {
  readonly preset: OverlayPresetId;
  readonly layout: PresetLayout;
  readonly opacity: number;
  readonly clickThrough: boolean;
  readonly typography: ResolvedTypography;
  readonly scrimAlpha: number;
  readonly scrimColor: string;
  readonly textColor: string;
  readonly maxCh: number;
}
