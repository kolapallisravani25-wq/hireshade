/**
 * Deterministic synthetic face renderer (W4).
 *
 * Produces an RGBA frame with two elliptical eyes and a saturated-blue iris so
 * tests can measure the iris centroid before/after warping without a real
 * camera or model. Same seed + options always produce byte-identical output.
 */
import type { EyeLandmarks, FaceLandmarks, Point, RgbaFrame } from "./types";

export interface EyeGeometry {
  readonly center: Point;
  readonly width: number;
  readonly height: number;
}

export interface SyntheticFaceGeometry {
  readonly left: EyeGeometry;
  readonly right: EyeGeometry;
}

export interface SyntheticFaceOptions {
  readonly width: number;
  readonly height: number;
  /** Iris displacement from the eye center, in pixels (+x right, +y down). */
  readonly leftOffset: Point;
  /** Defaults to leftOffset. */
  readonly rightOffset?: Point;
  readonly seed?: number;
  readonly timestampMs?: number;
}

export interface SyntheticFace {
  readonly frame: RgbaFrame;
  readonly landmarks: FaceLandmarks;
  readonly geometry: SyntheticFaceGeometry;
}

/** Standard eye placement for a synthetic face of the given size. */
export function syntheticEyeGeometry(width: number, height: number): SyntheticFaceGeometry {
  const eyeWidth = Math.max(8, Math.round(width * 0.14));
  const eyeHeight = Math.max(6, Math.round(height * 0.12));
  return {
    left: { center: { x: width * 0.36, y: height * 0.46 }, width: eyeWidth, height: eyeHeight },
    right: { center: { x: width * 0.64, y: height * 0.46 }, width: eyeWidth, height: eyeHeight },
  };
}

function clampOffset(offset: Point, geometry: EyeGeometry): Point {
  const irisRadius = Math.max(3, Math.round((geometry.width / 2) * 0.42));
  const maxX = Math.max(1, geometry.width / 2 - irisRadius - 2);
  const maxY = Math.max(1, geometry.height / 2 - irisRadius * 0.6 - 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, offset.x)),
    y: Math.max(-maxY, Math.min(maxY, offset.y)),
  };
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, r: number, g: number, b: number): void {
  const index = (y * width + x) * 4;
  data[index] = r;
  data[index + 1] = g;
  data[index + 2] = b;
  data[index + 3] = 255;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Render the synthetic face and return ground-truth landmarks for it. */
export function generateSyntheticFace(options: SyntheticFaceOptions): SyntheticFace {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("generateSyntheticFace: width/height must be positive integers");
  }
  const geometry = syntheticEyeGeometry(width, height);
  const leftOffset = clampOffset(options.leftOffset, geometry.left);
  const rightOffset = clampOffset(options.rightOffset ?? options.leftOffset, geometry.right);
  const data = new Uint8ClampedArray(width * height * 4);
  const random = createRandom(options.seed ?? 42);

  // Skin background with deterministic low-amplitude texture.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const noise = Math.round((random() - 0.5) * 6);
      setPixel(data, width, x, y, 198 + noise, 168 + noise, 148 + noise);
    }
  }

  const paintEye = (eye: EyeGeometry, offset: Point): EyeLandmarks => {
    const rx = eye.width / 2;
    const ry = eye.height / 2;
    const irisRadius = Math.max(3, Math.round(rx * 0.42));
    const pupilRadius = Math.max(1, Math.round(irisRadius * 0.42));
    const centerX = eye.center.x;
    const centerY = eye.center.y;

    for (let y = Math.floor(centerY - ry - 2); y <= Math.ceil(centerY + ry + 2); y += 1) {
      for (let x = Math.floor(centerX - rx - 2); x <= Math.ceil(centerX + rx + 2); x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const nx = (x - centerX) / rx;
        const ny = (y - centerY) / ry;
        if (nx * nx + ny * ny <= 1) setPixel(data, width, x, y, 246, 246, 244);
      }
    }

    const iris: Point = { x: centerX + offset.x, y: centerY + offset.y };
    for (let y = Math.floor(iris.y - irisRadius - 1); y <= Math.ceil(iris.y + irisRadius + 1); y += 1) {
      for (let x = Math.floor(iris.x - irisRadius - 1); x <= Math.ceil(iris.x + irisRadius + 1); x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const dx = x - iris.x;
        const dy = y - iris.y;
        if (dx * dx + dy * dy > irisRadius * irisRadius) continue;
        if (dx * dx + dy * dy <= pupilRadius * pupilRadius) {
          setPixel(data, width, x, y, 12, 12, 16);
        } else {
          setPixel(data, width, x, y, 32, 88, 208);
        }
      }
    }
    // Specular highlight so the centroid stays stable when pixels are blended.
    setPixel(data, width, Math.round(iris.x - irisRadius * 0.35), Math.round(iris.y - irisRadius * 0.35), 240, 248, 255);

    return { center: { x: centerX, y: centerY }, iris, width: eye.width, height: eye.height };
  };

  const leftEye = paintEye(geometry.left, leftOffset);
  const rightEye = paintEye(geometry.right, rightOffset);
  return {
    frame: { width, height, data, timestampMs: options.timestampMs ?? 0 },
    landmarks: { leftEye, rightEye, confidence: 1 },
    geometry,
  };
}

/**
 * Measure the blue iris centroid inside an eye ROI. Used by tests and the
 * preview to verify the warp actually moved the iris (2D pixel evidence, not
 * just the warp's own bookkeeping).
 */
export function measureIrisCenter(frame: RgbaFrame, eye: { center: Point; width: number; height: number }): Point | null {
  const rx = eye.width * 0.75;
  const ry = eye.height * 0.9;
  const minX = Math.max(0, Math.floor(eye.center.x - rx));
  const maxX = Math.min(frame.width - 1, Math.ceil(eye.center.x + rx));
  const minY = Math.max(0, Math.floor(eye.center.y - ry));
  const maxY = Math.min(frame.height - 1, Math.ceil(eye.center.y + ry));
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = (y * frame.width + x) * 4;
      const r = frame.data[index]!;
      const g = frame.data[index + 1]!;
      const b = frame.data[index + 2]!;
      if (b > 120 && b - r > 40 && b - g > 30) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }
  if (count < 8) return null;
  return { x: sumX / count, y: sumY / count };
}

/** Distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
