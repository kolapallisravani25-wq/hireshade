import { describe, expect, it } from "vitest";
import { EmaFilter, alphaForTimeConstant, clampAlpha, standardDeviation } from "./smoothing";

function feed(values: readonly number[]): number[] {
  const filter = new EmaFilter(0.35);
  return values.map((value) => filter.update({ x: value, y: 0 }).x);
}

describe("EMA smoothing", () => {
  it("bootstraps to the first measurement (no warm-up ramp)", () => {
    const filter = new EmaFilter(0.35);
    expect(filter.initialized).toBe(false);
    expect(filter.update({ x: 10, y: 4 })).toEqual({ x: 10, y: 4 });
    expect(filter.initialized).toBe(true);
    expect(filter.current).toEqual({ x: 10, y: 4 });
  });

  it("reduces deterministic jitter to below 1 px stddev", () => {
    const raw: number[] = [];
    let state = 12345;
    for (let index = 0; index < 60; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      raw.push(10 + (state / 0xffffffff - 0.5) * 2 * 2);
    }
    const smoothed = feed(raw);
    const rawStd = standardDeviation(raw.slice(1));
    const smoothedStd = standardDeviation(smoothed.slice(1));
    expect(rawStd).toBeGreaterThan(0.4);
    expect(smoothedStd).toBeLessThan(1);
    expect(smoothedStd).toBeLessThan(rawStd * 0.7);
  });

  it("tracks a step change without oscillating", () => {
    const filter = new EmaFilter(0.5);
    filter.update({ x: 0, y: 0 });
    let value = 0;
    for (let index = 0; index < 20; index += 1) {
      value = filter.update({ x: 10, y: 0 }).x;
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(value).toBeCloseTo(10, 1);
  });

  it("clamps alpha and converts time constants", () => {
    expect(clampAlpha(0)).toBe(0.01);
    expect(clampAlpha(2)).toBe(1);
    expect(clampAlpha(Number.NaN)).toBe(0.35);
    expect(alphaForTimeConstant(30, 50)).toBeGreaterThan(alphaForTimeConstant(30, 200));
    expect(alphaForTimeConstant(0, 50)).toBe(0.35);
    expect(alphaForTimeConstant(30, 0)).toBe(1);
  });

  it("resets state", () => {
    const filter = new EmaFilter(0.5);
    filter.update({ x: 5, y: 5 });
    filter.reset();
    expect(filter.current).toBeNull();
    expect(filter.update({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});
