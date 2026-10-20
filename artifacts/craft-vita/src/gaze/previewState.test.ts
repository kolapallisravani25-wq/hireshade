import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_STATE,
  clampStrength,
  createPreviewState,
  describePreview,
  previewEffectiveStrength,
  setPreviewStreaming,
  setPreviewStrength,
  togglePreviewEnabled,
} from "./previewState";

describe("preview control state", () => {
  it("clamps and rounds the strength slider", () => {
    expect(clampStrength(-1)).toBe(0);
    expect(clampStrength(2)).toBe(1);
    expect(clampStrength(0.1234)).toBe(0.12);
    expect(clampStrength(Number.NaN)).toBe(DEFAULT_PREVIEW_STATE.strength);
    const state = setPreviewStrength(createPreviewState(), -0.5);
    expect(state.strength).toBe(0);
  });

  it("toggles enabled and streaming immutably", () => {
    const state = createPreviewState({ strength: 0.8 });
    const off = togglePreviewEnabled(state);
    expect(off.enabled).toBe(false);
    expect(state.enabled).toBe(true);
    const streaming = setPreviewStreaming(state, true);
    expect(streaming.streaming).toBe(true);
    expect(previewEffectiveStrength(streaming)).toBe(1);
    expect(previewEffectiveStrength(state)).toBeCloseTo(0.8, 5);
  });

  it("describes the state for the preview UI", () => {
    expect(describePreview(createPreviewState({ enabled: false }))).toMatch(/pass-through/);
    expect(describePreview(createPreviewState({ strength: 0.5 }))).toMatch(/50%/);
    expect(describePreview(createPreviewState({ strength: 0.5, streaming: true }))).toMatch(/boost/);
  });
});
