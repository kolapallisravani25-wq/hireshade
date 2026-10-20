import { describe, expect, it } from "vitest";
import { JitteringMockFaceLandmarkDetector } from "./detector";
import { distance, generateSyntheticFace, measureIrisCenter } from "./syntheticFace";
import { WarpGazeWarper, desiredIrisCorrection, featherWeight } from "./warp";
import { standardDeviation } from "./smoothing";
import type { EyeLandmarks, RgbaFrame } from "./types";

function frameWithoutData(face: RgbaFrame): Uint8ClampedArray {
  return new Uint8ClampedArray(face.data);
}

describe("warp gaze correction", () => {
  it("reduces horizontal+vertical iris displacement toward the axis by >=70%", () => {
    const offset = { x: 12, y: 6 };
    const face = generateSyntheticFace({ width: 640, height: 360, leftOffset: offset });
    const before = measureIrisCenter(face.frame, face.geometry.left)!;
    const warper = new WarpGazeWarper();
    const result = warper.warp(face.frame, face.landmarks, 0.85);
    expect(result.applied).toBe(true);
    const after = measureIrisCenter(result.frame, face.geometry.left)!;
    const beforeDistance = distance(before, face.geometry.left.center);
    const afterDistance = distance(after, face.geometry.left.center);
    const reduction = 1 - afterDistance / beforeDistance;
    expect(reduction).toBeGreaterThanOrEqual(0.7);
    // Both eyes are corrected independently.
    const rightBefore = measureIrisCenter(face.frame, face.geometry.right)!;
    const rightAfter = measureIrisCenter(result.frame, face.geometry.right)!;
    const rightReduction =
      1 - distance(rightAfter, face.geometry.right.center) / distance(rightBefore, face.geometry.right.center);
    expect(rightReduction).toBeGreaterThanOrEqual(0.7);
  });

  it("returns the exact input object when strength is zero", () => {
    const face = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 8, y: 2 } });
    const warper = new WarpGazeWarper();
    const result = warper.warp(face.frame, face.landmarks, 0);
    expect(result.applied).toBe(false);
    expect(result.frame).toBe(face.frame);
  });

  it("never mutates the input frame", () => {
    const face = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 8, y: 2 } });
    const snapshot = frameWithoutData(face.frame);
    const warper = new WarpGazeWarper();
    warper.warp(face.frame, face.landmarks, 0.9);
    expect(Buffer.from(face.frame.data).equals(Buffer.from(snapshot))).toBe(true);
  });

  it("leaves pixels outside the eye ROIs untouched", () => {
    const face = generateSyntheticFace({ width: 640, height: 360, leftOffset: { x: 10, y: 0 } });
    const warper = new WarpGazeWarper();
    const result = warper.warp(face.frame, face.landmarks, 0.85);
    const probe = (x: number, y: number): number[] => {
      const index = (y * face.frame.width + x) * 4;
      return [face.frame.data[index]!, face.frame.data[index + 1]!, face.frame.data[index + 2]!, face.frame.data[index + 3]!];
    };
    // Between the eyes / cheek / frame corners are outside both ROIs.
    for (const [x, y] of [[320, 180], [10, 10], [630, 350], [320, 40]] as const) {
      expect([...result.frame.data.slice(((y * 640 + x) * 4), (y * 640 + x) * 4 + 4)]).toEqual(probe(x, y));
    }
  });

  it("clamps extreme corrections to the configured eye-width ratio", () => {
    const eye: EyeLandmarks = {
      center: { x: 100, y: 100 },
      iris: { x: 140, y: 100 },
      width: 20,
      height: 10,
    };
    const correction = desiredIrisCorrection(eye, 1, 0.35);
    expect(Math.hypot(correction.x, correction.y)).toBeCloseTo(7, 5);
  });

  it("feathers to 0 at the ROI edge and 1 in the center", () => {
    expect(featherWeight(0)).toBe(1);
    expect(featherWeight(0.5)).toBe(1);
    expect(featherWeight(1)).toBe(0);
    expect(featherWeight(1.2)).toBe(0);
    const middle = featherWeight(0.825);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("EMA smoothing keeps jitter below 1 px stddev", () => {
    const width = 640;
    const height = 360;
    const face = generateSyntheticFace({ width, height, leftOffset: { x: 0, y: 0 } });
    const detector = new JitteringMockFaceLandmarkDetector({
      width,
      height,
      fallbackOffset: { x: 10, y: 0 },
      jitterAmplitude: 2,
      jitterSeed: 3,
    });
    const warper = new WarpGazeWarper({ emaAlpha: 0.35 });
    const raw: number[] = [];
    const smoothed: number[] = [];
    for (let index = 0; index < 45; index += 1) {
      const landmarks = detector.detect(face.frame)!;
      raw.push(landmarks.leftEye.iris.x - landmarks.leftEye.center.x);
      const result = warper.warp(face.frame, landmarks, 0.85);
      smoothed.push(result.correction.left.x);
    }
    const rawStd = standardDeviation(raw.slice(1));
    const smoothedStd = standardDeviation(smoothed.slice(1));
    expect(rawStd).toBeGreaterThan(0.4);
    expect(smoothedStd).toBeLessThan(1);
  });

  it("reports corrections and resets state", () => {
    const face = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 6, y: 0 } });
    const warper = new WarpGazeWarper();
    warper.warp(face.frame, face.landmarks, 0.8);
    const correction = warper.getLastCorrection()!;
    expect(correction.left.x).toBeLessThan(0);
    warper.reset();
    expect(warper.getLastCorrection()).toBeNull();
  });
});
