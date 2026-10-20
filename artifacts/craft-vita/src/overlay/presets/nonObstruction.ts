/**
 * Non-obstruction helpers (O1 / EXT G-044): multi-monitor suggestion,
 * camera-preview avoidance, click-through affordance and opacity slider model.
 * Pure functions only.
 */
import type { Rect, ViewportSize } from './types';

// --- Multi-monitor ---

export interface DisplayInfo {
  readonly id: string | number;
  readonly primary?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly scaleFactor?: number;
}

export interface SecondaryDisplaySuggestion {
  readonly hasSecondary: boolean;
  readonly targetDisplayId: string | number | null;
  readonly copy: string;
  readonly shortCopy: string;
}

/** Detects a second display and produces plain-language placement copy. */
export function suggestSecondaryDisplay(
  displays: readonly DisplayInfo[] | null | undefined,
): SecondaryDisplaySuggestion {
  const list = Array.isArray(displays)
    ? displays.filter((display) => display && display.id !== undefined)
    : [];
  const secondary = list.find((display) => display.primary !== true);
  if (!secondary) {
    return {
      hasSecondary: false,
      targetDisplayId: null,
      copy: 'Single display detected. HireShade stays on this screen - use Compact or Banner to keep it out of the way.',
      shortCopy: 'Single display - use Compact to stay out of the way.',
    };
  }
  return {
    hasSecondary: true,
    targetDisplayId: secondary.id,
    copy: 'You have ' + list.length + ' displays. Put HireShade on the other screen so the overlay never covers your call.',
    shortCopy: 'Move HireShade to your second display.',
  };
}

// --- Camera preview avoidance ---

/** Typical in-call camera preview: top-center, 26% width x 22% height. */
export function defaultCameraPreviewRegion(viewport: ViewportSize): Rect {
  const width = Math.round(viewport.width * 0.26);
  const height = Math.round(viewport.height * 0.22);
  return {
    x: Math.round((viewport.width - width) / 2),
    y: 8,
    width,
    height,
  };
}

export interface CameraAvoidanceResult {
  readonly bounds: Rect;
  readonly avoided: boolean;
  readonly strategy: 'none' | 'below' | 'above' | 'left' | 'right';
}

function intersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/** Moves a surface out of the camera region (below, above, then sideways). */
export function avoidCameraPreviewRegion(
  bounds: Rect,
  camera: Rect,
  viewport: ViewportSize,
  gap = 8,
): CameraAvoidanceResult {
  if (!intersects(bounds, camera)) return { bounds, avoided: false, strategy: 'none' };
  const clamp = (rect: Rect): Rect => ({
    ...rect,
    x: Math.round(Math.max(0, Math.min(viewport.width - rect.width, rect.x))),
    y: Math.round(Math.max(0, Math.min(viewport.height - rect.height, rect.y))),
  });
  const below = clamp({ ...bounds, y: camera.y + camera.height + gap });
  if (!intersects(below, camera)) return { bounds: below, avoided: true, strategy: 'below' };
  const above = clamp({ ...bounds, y: camera.y - bounds.height - gap });
  if (!intersects(above, camera)) return { bounds: above, avoided: true, strategy: 'above' };
  const right = clamp({ ...bounds, x: camera.x + camera.width + gap });
  if (!intersects(right, camera)) return { bounds: right, avoided: true, strategy: 'right' };
  const left = clamp({ ...bounds, x: camera.x - bounds.width - gap });
  if (!intersects(left, camera)) return { bounds: left, avoided: true, strategy: 'left' };
  return { bounds, avoided: false, strategy: 'none' };
}

// --- Click-through / opacity ---

export interface ClickThroughAffordance {
  readonly label: string;
  readonly description: string;
  readonly hotkey: string;
  readonly instruction: string;
}

/** Affordance copy for the click-through toggle (the hotkey hook already exists). */
export function clickThroughAffordance(hotkey = 'CommandOrControl+Shift+X'): ClickThroughAffordance {
  return {
    label: 'Click-through',
    description: 'Clicks pass through the overlay to the app underneath. The hotkey always works.',
    hotkey,
    instruction: 'Press ' + hotkey.replace('CommandOrControl', 'Ctrl') + ' to toggle click-through',
  };
}

export interface OpacitySliderModel {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly label: string;
  readonly valueLabel: string;
}

/** Opacity slider model: defaults to the preset's semi-transparent value. */
export function opacitySliderModel(
  value: number,
  options: { min?: number; max?: number; step?: number } = {},
): OpacitySliderModel {
  const min = options.min ?? 0.2;
  const max = options.max ?? 1;
  const step = options.step ?? 0.05;
  const clamped = Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
  return {
    min,
    max,
    step,
    value: clamped,
    label: 'Overlay opacity',
    valueLabel: Math.round(clamped * 100) + '% opaque',
  };
}

/** The adapter/overlay must never call focus() on show or re-layout. */
export const OVERLAY_FOCUS_INVARIANT = 'never-steal-focus';
