/**
 * Preview/control state (W4): pure slider/toggle model shared by the HTML
 * preview and any settings UI. No DOM imports.
 */
import { resolveEffectiveStrength } from "./processor";

export interface GazePreviewState {
  readonly enabled: boolean;
  readonly strength: number;
  readonly streaming: boolean;
}

export const DEFAULT_PREVIEW_STATE: GazePreviewState = {
  enabled: true,
  strength: 0.85,
  streaming: false,
};

export function createPreviewState(overrides: Partial<GazePreviewState> = {}): GazePreviewState {
  return {
    enabled: overrides.enabled ?? DEFAULT_PREVIEW_STATE.enabled,
    strength: clampStrength(overrides.strength ?? DEFAULT_PREVIEW_STATE.strength),
    streaming: overrides.streaming ?? DEFAULT_PREVIEW_STATE.streaming,
  };
}

export function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_STATE.strength;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function setPreviewStrength(state: GazePreviewState, value: number): GazePreviewState {
  return { ...state, strength: clampStrength(value) };
}

export function togglePreviewEnabled(state: GazePreviewState): GazePreviewState {
  return { ...state, enabled: !state.enabled };
}

export function setPreviewStreaming(state: GazePreviewState, streaming: boolean): GazePreviewState {
  return { ...state, streaming: Boolean(streaming) };
}

export function previewEffectiveStrength(state: GazePreviewState): number {
  return resolveEffectiveStrength(state.strength, state.streaming);
}

export function describePreview(state: GazePreviewState): string {
  if (!state.enabled) return "Off (pass-through: output bytes identical to input)";
  const boost = state.streaming ? " · streaming boost" : "";
  return "On · strength " + Math.round(state.strength * 100) + "%" + boost + " · effective " + Math.round(previewEffectiveStrength(state) * 100) + "%";
}
