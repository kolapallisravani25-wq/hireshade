/**
 * Warp-based eye-region re-centering (W4).
 *
 * For each eye we translate a small elliptical ROI by the negative of the
 * observed iris offset (scaled by the user strength), blended through a raised
 * cosine feather so there is no visible seam. Only two small ROIs are touched
 * per frame, which keeps the 720p budget well under the 25 ms target.
 *
 * The correction itself is EMA-smoothed across frames (see smoothing.ts).
 */
import { EmaFilter, DEFAULT_EMA_ALPHA } from "./smoothing";
import type { EyeLandmarks, FaceLandmarks, GazeWarper, Point, RgbaFrame, WarpCorrection, WarpResult } from "./types";

export interface WarpGazeWarperOptions {
  readonly emaAlpha?: number;
  /** ROI feather: 0..1 of the ellipse radius that stays fully opaque. */
  readonly featherInner?: number;
  /** Max correction as a fraction of eye width (prevents extreme warps). */
  readonly maxCorrectionRatio?: number;
}

const ZERO: Point = { x: 0, y: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMagnitude(point: Point, max: number): Point {
  const length = Math.hypot(point.x, point.y);
  if (length <= max || length === 0) return point;
  const scale = max / length;
  return { x: point.x * scale, y: point.y * scale };
}

/** Smoothstep feather weight for an elliptical ROI (0 at the edge, 1 inside). */
export function featherWeight(normalizedDistance: number, inner = 0.65): number {
  if (normalizedDistance <= inner) return 1;
  if (normalizedDistance >= 1) return 0;
  const t = (normalizedDistance - inner) / (1 - inner);
  return t * t * (3 - 2 * t);
}

/**
 * Warp one eye ROI. Performance-critical: no per-pixel allocations, no
 * Math.hypot/cos, and the sampled channel values are computed inline. This is
 * what keeps the 720p budget single-digit milliseconds.
 */
function warpEye(
  source: RgbaFrame,
  output: Uint8ClampedArray,
  eye: EyeLandmarks,
  correction: Point,
  inner: number,
): void {
  const width = source.width;
  const height = source.height;
  const data = source.data;
  // ROI: iris radius + max correction comfortably fit inside 0.58 * eye width.
  const rx = Math.max(2, eye.width * 0.58);
  const ry = Math.max(2, eye.height * 0.85);
  const minX = Math.max(0, Math.floor(eye.center.x - rx));
  const maxX = Math.min(width - 1, Math.ceil(eye.center.x + rx));
  const minY = Math.max(0, Math.floor(eye.center.y - ry));
  const maxY = Math.min(height - 1, Math.ceil(eye.center.y + ry));
  const correctionX = correction.x;
  const correctionY = correction.y;
  const featherScale = 1 / (1 - inner);
  const centerX = eye.center.x;
  const centerY = eye.center.y;
  const maxSampleX = width - 1;
  const maxSampleY = height - 1;

  for (let y = minY; y <= maxY; y += 1) {
    const ny = (y - centerY) / ry;
    const ny2 = ny * ny;
    const rowBase = y * width * 4;
    for (let x = minX; x <= maxX; x += 1) {
      const nx = (x - centerX) / rx;
      const distanceSquared = nx * nx + ny2;
      if (distanceSquared >= 1) continue;
      let weight = 1;
      if (distanceSquared > inner * inner) {
        const t = (Math.sqrt(distanceSquared) - inner) * featherScale;
        if (t >= 1) continue;
        weight = t * t * (3 - 2 * t);
        if (weight < 0.004) continue;
      }

      // Bilinear sample at the inverse-mapped position (x - correction).
      let sampleX = x - correctionX;
      if (sampleX < 0) sampleX = 0;
      else if (sampleX > maxSampleX) sampleX = maxSampleX;
      let sampleY = y - correctionY;
      if (sampleY < 0) sampleY = 0;
      else if (sampleY > maxSampleY) sampleY = maxSampleY;
      const x0 = sampleX | 0;
      const y0 = sampleY | 0;
      const x1 = x0 < maxSampleX ? x0 + 1 : x0;
      const y1 = y0 < maxSampleY ? y0 + 1 : y0;
      const fx = sampleX - x0;
      const fy = sampleY - y0;
      const i00 = (y0 * width + x0) * 4;
      const i10 = (y0 * width + x1) * 4;
      const i01 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const index = rowBase + x * 4;
      // RGB only: overlay frames are opaque, so alpha is a straight copy. This
      // is a 25% reduction in the hottest loop.
      for (let channel = 0; channel < 3; channel += 1) {
        const i00c = i00 + channel;
        const i10c = i10 + channel;
        const top = data[i00c]! + (data[i10c]! - data[i00c]!) * fx;
        const i01c = i01 + channel;
        const i11c = i11 + channel;
        const bottom = data[i01c]! + (data[i11c]! - data[i01c]!) * fx;
        const sampled = top + (bottom - top) * fy;
        const original = data[index + channel]!;
        output[index + channel] = original + (sampled - original) * weight;
      }
      output[index + 3] = data[index + 3]!;
    }
  }
}

export class WarpGazeWarper implements GazeWarper {
  private readonly leftFilter: EmaFilter;
  private readonly rightFilter: EmaFilter;
  private readonly featherInner: number;
  private readonly maxCorrectionRatio: number;
  private lastCorrection: WarpCorrection | null = null;

  constructor(options: WarpGazeWarperOptions = {}) {
    this.leftFilter = new EmaFilter(options.emaAlpha ?? DEFAULT_EMA_ALPHA);
    this.rightFilter = new EmaFilter(options.emaAlpha ?? DEFAULT_EMA_ALPHA);
    this.featherInner = clamp(options.featherInner ?? 0.65, 0.1, 0.95);
    this.maxCorrectionRatio = clamp(options.maxCorrectionRatio ?? 0.35, 0.05, 0.5);
  }

  getLastCorrection(): WarpCorrection | null {
    return this.lastCorrection;
  }

  reset(): void {
    this.leftFilter.reset();
    this.rightFilter.reset();
    this.lastCorrection = null;
  }

  warp(frame: RgbaFrame, landmarks: FaceLandmarks | null, strength: number): WarpResult {
    if (!frame || !landmarks || !(frame.data instanceof Uint8ClampedArray)) {
      return { frame, correction: { left: ZERO, right: ZERO }, applied: false };
    }
    const clampedStrength = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);
    if (clampedStrength <= 0) {
      this.lastCorrection = null;
      return { frame, correction: { left: ZERO, right: ZERO }, applied: false };
    }
    const rawLeft = this.desiredCorrection(landmarks.leftEye, clampedStrength);
    const rawRight = this.desiredCorrection(landmarks.rightEye, clampedStrength);
    const left = this.leftFilter.update(rawLeft);
    const right = this.rightFilter.update(rawRight);
    this.lastCorrection = { left, right };
    if (Math.hypot(left.x, left.y) < 0.01 && Math.hypot(right.x, right.y) < 0.01) {
      return { frame, correction: { left, right }, applied: false };
    }
    const data = new Uint8ClampedArray(frame.data);
    const output: RgbaFrame = {
      width: frame.width,
      height: frame.height,
      data,
      timestampMs: frame.timestampMs,
    };
    warpEye(frame, data, landmarks.leftEye, left, this.featherInner);
    warpEye(frame, data, landmarks.rightEye, right, this.featherInner);
    return { frame: output, correction: { left, right }, applied: true };
  }

  private desiredCorrection(eye: EyeLandmarks, strength: number): Point {
    const offsetX = eye.iris.x - eye.center.x;
    const offsetY = eye.iris.y - eye.center.y;
    const maxCorrection = this.maxCorrectionRatio * Math.max(2, eye.width);
    return clampMagnitude(
      { x: -offsetX * strength, y: -offsetY * strength },
      maxCorrection,
    );
  }
}

/** Stateless helper used by preview/tests: correction for one eye at strength. */
export function desiredIrisCorrection(eye: EyeLandmarks, strength: number, maxCorrectionRatio = 0.35): Point {
  const maxCorrection = maxCorrectionRatio * Math.max(2, eye.width);
  return clampMagnitude(
    {
      x: -(eye.iris.x - eye.center.x) * clamp(strength, 0, 1),
      y: -(eye.iris.y - eye.center.y) * clamp(strength, 0, 1),
    },
    maxCorrection,
  );
}
