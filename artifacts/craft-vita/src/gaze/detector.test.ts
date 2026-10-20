import { describe, expect, it } from "vitest";
import {
  DeterministicMockFaceLandmarkDetector,
  JitteringMockFaceLandmarkDetector,
  OnnxFaceLandmarkDetector,
  createFaceLandmarkDetector,
} from "./detector";
import { generateSyntheticFace } from "./syntheticFace";

const frame = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 0, y: 0 } }).frame;

describe("face landmark detectors", () => {
  it("replays scripted iris offsets frame by frame", () => {
    const detector = new DeterministicMockFaceLandmarkDetector({
      width: 320,
      height: 180,
      offsets: [
        { x: 4, y: 1 },
        { x: -3, y: 2 },
      ],
      fallbackOffset: { x: 0, y: 0 },
    });
    const first = detector.detect(frame)!;
    const second = detector.detect(frame)!;
    const third = detector.detect(frame)!;
    expect(first.leftEye.iris.x - first.leftEye.center.x).toBeCloseTo(4, 5);
    expect(second.leftEye.iris.y - second.leftEye.center.y).toBeCloseTo(2, 5);
    expect(third.leftEye.iris.x - third.leftEye.center.x).toBeCloseTo(0, 5);
    expect(detector.detectedFrames).toBe(3);
    detector.reset();
    expect(detector.detectedFrames).toBe(0);
  });

  it("produces deterministic jitter", () => {
    const a = new JitteringMockFaceLandmarkDetector({ width: 320, height: 180, jitterAmplitude: 2, jitterSeed: 9, fallbackOffset: { x: 8, y: 0 } });
    const b = new JitteringMockFaceLandmarkDetector({ width: 320, height: 180, jitterAmplitude: 2, jitterSeed: 9, fallbackOffset: { x: 8, y: 0 } });
    for (let index = 0; index < 6; index += 1) {
      const left = a.detect(frame)!;
      const right = b.detect(frame)!;
      expect(left.leftEye.iris.x).toBeCloseTo(right.leftEye.iris.x, 10);
    }
  });

  it("returns null for invalid frames", () => {
    const detector = new DeterministicMockFaceLandmarkDetector({ width: 320, height: 180 });
    expect(detector.detect(null as never)).toBeNull();
    expect(detector.detect({ width: 0, height: 0, data: new Uint8ClampedArray(0), timestampMs: 0 })).toBeNull();
  });

  it("exposes the ONNX adapter as a documented unavailable stub (pass-through)", () => {
    const onnx = new OnnxFaceLandmarkDetector({ modelPath: "models/face_landmark_478.onnx" });
    expect(onnx.status).toBe("unavailable");
    expect(onnx.detect(frame)).toBeNull();
    expect(onnx.unavailableReason).toMatch(/onnxruntime/);
    expect(onnx.unavailableReason).toMatch(/face_landmark_478\.onnx/);
    expect(OnnxFaceLandmarkDetector.isModelBundled()).toBe(false);
  });

  it("creates detectors through the factory", () => {
    expect(createFaceLandmarkDetector({ mode: "mock", mock: { width: 100, height: 100 } })).toBeInstanceOf(DeterministicMockFaceLandmarkDetector);
    expect(createFaceLandmarkDetector({ mode: "onnx" })).toBeInstanceOf(OnnxFaceLandmarkDetector);
    expect(() => createFaceLandmarkDetector({ mode: "mock" })).toThrow();
  });
});
