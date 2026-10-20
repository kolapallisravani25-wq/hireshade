/**
 * Temporal smoothing (W4).
 *
 * A per-frame landmark detector is noisy; warping with raw iris displacement
 * makes the image jitter. An exponential moving average (EMA) smooths the
 * correction while keeping latency to one frame class.
 */
import type { Point } from "./types";

export const DEFAULT_EMA_ALPHA = 0.35;

export function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return DEFAULT_EMA_ALPHA;
  return Math.min(1, Math.max(0.01, alpha));
}

/** EMA time constant to per-frame alpha: alpha = 1 - exp(-dt / tau). */
export function alphaForTimeConstant(frameRate: number, timeConstantMs: number): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return DEFAULT_EMA_ALPHA;
  if (!Number.isFinite(timeConstantMs) || timeConstantMs <= 0) return 1;
  const dt = 1000 / frameRate;
  return clampAlpha(1 - Math.exp(-dt / timeConstantMs));
}

export class EmaFilter {
  private readonly alphaValue: number;
  private value: Point | null = null;

  constructor(alpha: number = DEFAULT_EMA_ALPHA) {
    this.alphaValue = clampAlpha(alpha);
  }

  get alpha(): number {
    return this.alphaValue;
  }

  get current(): Point | null {
    return this.value ? { x: this.value.x, y: this.value.y } : null;
  }

  get initialized(): boolean {
    return this.value !== null;
  }

  /**
   * First update bootstraps directly to the measurement (no warm-up ramp), so
   * a static offset is corrected on frame 1. Later updates blend.
   */
  update(point: Point): Point {
    if (!this.value) {
      this.value = { x: point.x, y: point.y };
      return { x: point.x, y: point.y };
    }
    const next = {
      x: this.value.x + (point.x - this.value.x) * this.alphaValue,
      y: this.value.y + (point.y - this.value.y) * this.alphaValue,
    };
    this.value = next;
    return { x: next.x, y: next.y };
  }

  reset(): void {
    this.value = null;
  }
}

/** Sample standard deviation (population denominator n-1). */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}
