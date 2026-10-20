import { describe, expect, it } from "vitest";
import { GazeCorrectionProcessor, quantizeTimestamp, resizeFrame, resolveEffectiveStrength } from "./processor";
import { DeterministicMockFaceLandmarkDetector, OnnxFaceLandmarkDetector } from "./detector";
import { generateSyntheticFace } from "./syntheticFace";
import type { FaceLandmarkDetector, FaceLandmarks, GazeWarper, RgbaFrame, WarpResult } from "./types";

function makeFrame(width = 640, height = 360, offset = { x: 10, y: 4 }): RgbaFrame {
  return generateSyntheticFace({ width, height, leftOffset: offset, seed: 11 }).frame;
}

function detectorFor(width = 640, height = 360): DeterministicMockFaceLandmarkDetector {
  return new DeterministicMockFaceLandmarkDetector({
    width,
    height,
    offsets: [{ x: 10, y: 4 }, { x: 10, y: 4 }, { x: 10, y: 4 }],
    fallbackOffset: { x: 10, y: 4 },
  });
}

class ThrowingDetector implements FaceLandmarkDetector {
  readonly name = "throwing";
  readonly status = "ready" as const;
  detect(): FaceLandmarks | null {
    throw new Error("detector exploded");
  }
}

class NullDetector implements FaceLandmarkDetector {
  readonly name = "null";
  readonly status = "ready" as const;
  detect(): FaceLandmarks | null {
    return null;
  }
}

class ThrowingWarper implements GazeWarper {
  warp(): WarpResult {
    throw new Error("warper exploded");
  }
  reset(): void {}
}

describe("gaze processor pass-through guarantees", () => {
  it("returns the exact input bytes when disabled", () => {
    const frame = makeFrame();
    const before = new Uint8ClampedArray(frame.data);
    const processor = new GazeCorrectionProcessor({ enabled: false, detector: detectorFor() });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.applied).toBe(false);
    expect(result.metrics.passthroughReason).toBe("disabled");
    expect(Buffer.from(result.frame.data).equals(Buffer.from(before))).toBe(true);
  });

  it("returns identical bytes when the detector is unavailable (ONNX stub)", () => {
    const frame = makeFrame();
    const before = new Uint8ClampedArray(frame.data);
    const processor = new GazeCorrectionProcessor({ detector: new OnnxFaceLandmarkDetector() });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("detector-unavailable");
    expect(Buffer.from(result.frame.data).equals(Buffer.from(before))).toBe(true);
  });

  it("returns identical bytes when the detector throws", () => {
    const frame = makeFrame();
    const before = new Uint8ClampedArray(frame.data);
    const processor = new GazeCorrectionProcessor({ detector: new ThrowingDetector() });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("detector-error");
    expect(processor.lastProcessingError).toContain("detector exploded");
    expect(Buffer.from(result.frame.data).equals(Buffer.from(before))).toBe(true);
  });

  it("returns identical bytes when no landmarks are found or confidence is low", () => {
    const frame = makeFrame();
    const nullProcessor = new GazeCorrectionProcessor({ detector: new NullDetector() });
    expect(nullProcessor.process(frame).metrics.passthroughReason).toBe("detector-null");

    const lowConfidence = new DeterministicMockFaceLandmarkDetector({ width: 640, height: 360, confidence: 0.1 });
    const lowProcessor = new GazeCorrectionProcessor({ detector: lowConfidence });
    const result = lowProcessor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("low-confidence");
  });

  it("returns identical bytes when the warper throws", () => {
    const frame = makeFrame();
    const before = new Uint8ClampedArray(frame.data);
    const processor = new GazeCorrectionProcessor({ detector: detectorFor(), warper: new ThrowingWarper() });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("warper-error");
    expect(Buffer.from(result.frame.data).equals(Buffer.from(before))).toBe(true);
  });

  it("rejects malformed frames without throwing or resizing", () => {
    const frame: RgbaFrame = { width: 10, height: 10, data: new Uint8ClampedArray(3), timestampMs: 0 };
    const processor = new GazeCorrectionProcessor({ detector: detectorFor(10, 10) });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("invalid-frame");
  });

  it("passes through when strength is zero", () => {
    const frame = makeFrame();
    const processor = new GazeCorrectionProcessor({ detector: detectorFor(), strength: 0 });
    const result = processor.process(frame);
    expect(result.frame).toBe(frame);
    expect(result.metrics.passthroughReason).toBe("zero-strength");
  });
});

describe("gaze processor output contract", () => {
  it("emits the fixed output resolution", () => {
    const frame = makeFrame(640, 360);
    const processor = new GazeCorrectionProcessor({
      detector: detectorFor(640, 360),
      outputWidth: 1280,
      outputHeight: 720,
    });
    const result = processor.process(frame);
    expect(result.metrics.applied).toBe(true);
    expect(result.frame.width).toBe(1280);
    expect(result.frame.height).toBe(720);
    expect(result.frame.data.length).toBe(1280 * 720 * 4);
    expect(result.frame.width).toBe(processor.outputWidth);
  });

  it("keeps 720p input at 720p and quantizes timestamps to the fps grid", () => {
    const frame: RgbaFrame = { ...makeFrame(1280, 720), timestampMs: 1010 };
    const processor = new GazeCorrectionProcessor({ detector: detectorFor(1280, 720), fps: 30 });
    const result = processor.process(frame);
    expect(result.metrics.applied).toBe(true);
    expect(result.frame.width).toBe(1280);
    expect(Math.abs(result.frame.timestampMs - quantizeTimestamp(1010, 30))).toBeLessThan(1e-6);
    expect(result.frame.timestampMs).toBe(1000);
  });

  it("auto-boosts strength while tokens stream, clamped to 1", () => {
    const processor = new GazeCorrectionProcessor({ detector: detectorFor(), strength: 0.85 });
    const idle = processor.process(makeFrame());
    expect(idle.metrics.effectiveStrength).toBeCloseTo(0.85, 5);
    processor.setStreaming(true);
    const streaming = processor.process(makeFrame());
    expect(streaming.metrics.effectiveStrength).toBe(1);
    processor.setStreaming(false);
    expect(processor.process(makeFrame()).metrics.effectiveStrength).toBeCloseTo(0.85, 5);
    processor.setStrength(0.5);
    expect(processor.strength).toBe(0.5);
    expect(resolveEffectiveStrength(0.5, true)).toBeCloseTo(0.675, 5);
    expect(resolveEffectiveStrength(2, false)).toBe(1);
  });

  it("never mutates the original frame bytes", () => {
    const frame = makeFrame(640, 360);
    const snapshot = new Uint8ClampedArray(frame.data);
    const processor = new GazeCorrectionProcessor({ detector: detectorFor() });
    processor.process(frame);
    expect(Buffer.from(frame.data).equals(Buffer.from(snapshot))).toBe(true);
  });

  it("resizes frames bilinearly when requested directly", () => {
    const frame = makeFrame(320, 180);
    const resized = resizeFrame(frame, 640, 360);
    expect(resized.width).toBe(640);
    expect(resized.height).toBe(360);
    expect(resized.data.length).toBe(640 * 360 * 4);
    expect(resizeFrame(frame, 320, 180)).toBe(frame);
  });

  it("toggles enable/disable and exposes metrics", () => {
    const processor = new GazeCorrectionProcessor({ detector: detectorFor() });
    expect(processor.enabled).toBe(true);
    processor.setEnabled(false);
    expect(processor.process(makeFrame()).metrics.applied).toBe(false);
    processor.setEnabled(true);
    const result = processor.process(makeFrame());
    expect(result.metrics.applied).toBe(true);
    expect(processor.lastFrameMetrics).not.toBeNull();
    expect(processor.detectorStatus).toBe("ready");
  });
});
