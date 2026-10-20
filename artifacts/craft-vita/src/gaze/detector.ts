/**
 * Face landmark detectors (W4).
 *
 * Ships:
 *   - DeterministicMockFaceLandmarkDetector: synthetic-face detector used by the
 *     MVP, demo flag and tests. No model, no network, repeatable.
 *   - OnnxFaceLandmarkDetector: adapter STUB documenting the exact runtime/model
 *     contract. It reports status "unavailable" (no model bundled, no
 *     onnxruntime dependency), so the processor stays pass-through instead of
 *     failing or emitting garbage.
 */
import type { FaceLandmarkDetector, FaceLandmarks, Point, RgbaFrame } from "./types";
import { syntheticEyeGeometry } from "./syntheticFace";

export interface MockFaceLandmarkDetectorOptions {
  readonly width: number;
  readonly height: number;
  /** Per-frame iris offsets (relative to the neutral eye center). */
  readonly offsets?: readonly Point[];
  /** Fallback when offsets are exhausted. */
  readonly fallbackOffset?: Point;
  readonly confidence?: number;
}

export class DeterministicMockFaceLandmarkDetector implements FaceLandmarkDetector {
  readonly name = "mock-deterministic";
  readonly status = "ready" as const;
  private frameIndex = 0;
  private readonly width: number;
  private readonly height: number;
  private readonly offsets: readonly Point[];
  private readonly fallbackOffset: Point;
  private readonly confidence: number;

  constructor(options: MockFaceLandmarkDetectorOptions) {
    this.width = options.width;
    this.height = options.height;
    this.offsets = options.offsets ?? [];
    this.fallbackOffset = options.fallbackOffset ?? { x: 0, y: 0 };
    this.confidence = options.confidence ?? 1;
  }

  /** How many frames have been detected (useful for assertions). */
  get detectedFrames(): number {
    return this.frameIndex;
  }

  /** Restart the offset sequence (e.g. after the camera reconnects). */
  reset(): void {
    this.frameIndex = 0;
  }

  detect(frame: RgbaFrame): FaceLandmarks | null {
    if (!frame || frame.width <= 0 || frame.height <= 0) return null;
    const offset = this.offsets[this.frameIndex] ?? this.fallbackOffset;
    this.frameIndex += 1;
    const geometry = syntheticEyeGeometry(this.width || frame.width, this.height || frame.height);
    return {
      leftEye: {
        center: geometry.left.center,
        iris: { x: geometry.left.center.x + offset.x, y: geometry.left.center.y + offset.y },
        width: geometry.left.width,
        height: geometry.left.height,
      },
      rightEye: {
        center: geometry.right.center,
        iris: { x: geometry.right.center.x + offset.x, y: geometry.right.center.y + offset.y },
        width: geometry.right.width,
        height: geometry.right.height,
      },
      confidence: this.confidence,
    };
  }
}

/**
 * Records a fixed or scripted iris offset per frame, optionally with
 * deterministic jitter (for EMA smoothing tests).
 */
export interface JitterMockOptions extends MockFaceLandmarkDetectorOptions {
  readonly jitterAmplitude?: number;
  readonly jitterSeed?: number;
}

export class JitteringMockFaceLandmarkDetector implements FaceLandmarkDetector {
  readonly name = "mock-jittering";
  readonly status = "ready" as const;
  private frameIndex = 0;
  private state: number;
  private readonly width: number;
  private readonly height: number;
  private readonly baseOffset: Point;
  private readonly amplitude: number;
  private readonly confidence: number;

  constructor(options: JitterMockOptions) {
    this.width = options.width;
    this.height = options.height;
    this.baseOffset = options.fallbackOffset ?? { x: 0, y: 0 };
    this.amplitude = options.jitterAmplitude ?? 0;
    this.state = (options.jitterSeed ?? 7) >>> 0;
    this.confidence = options.confidence ?? 1;
  }

  reset(): void {
    this.frameIndex = 0;
  }

  private nextJitter(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return (this.state / 0xffffffff - 0.5) * 2 * this.amplitude;
  }

  detect(frame: RgbaFrame): FaceLandmarks | null {
    if (!frame || frame.width <= 0 || frame.height <= 0) return null;
    this.frameIndex += 1;
    const geometry = syntheticEyeGeometry(this.width || frame.width, this.height || frame.height);
    const jitterX = this.nextJitter();
    const jitterY = this.nextJitter() * 0.5;
    const iris = { x: geometry.left.center.x + this.baseOffset.x + jitterX, y: geometry.left.center.y + this.baseOffset.y + jitterY };
    return {
      leftEye: { center: geometry.left.center, iris, width: geometry.left.width, height: geometry.left.height },
      rightEye: {
        center: geometry.right.center,
        iris: { x: geometry.right.center.x + this.baseOffset.x + jitterX, y: geometry.right.center.y + this.baseOffset.y + jitterY },
        width: geometry.right.width,
        height: geometry.right.height,
      },
      confidence: this.confidence,
    };
  }
}

export interface OnnxFaceLandmarkDetectorOptions {
  /** Path/URL to the bundled ONNX model (not shipped in the MVP). */
  readonly modelPath?: string;
  readonly executionProvider?: "wasm" | "cpu";
  /** Model input edge (MediaPipe face-landmark models use 192 or 256). */
  readonly inputSize?: number;
}

/**
 * ONNX Runtime adapter STUB — intentionally unavailable in this MVP.
 *
 * Real implementation contract (documented for the follow-up task):
 *   - Model: MediaPipe canonical face-landmark / face-mesh ONNX export,
 *     e.g. face_landmark_478.onnx (468 mesh points + 10 iris points).
 *   - Runtime: onnxruntime-web (wasm) in the renderer preview, or
 *     onnxruntime-node in Electron main. Neither dependency is installed yet.
 *   - Input: float32 NCHW [1, 3, inputSize, inputSize], RGB, normalized 0..1,
 *     after face detection + square crop/letterbox (face detector is a separate
 *     missing piece — this MVP does not ship BlazeFace).
 *   - Output: [1, 478, 3] (x, y, z) in model-input pixels (or normalized;
 *     verify against the exported model metadata).
 *   - Iris indices: 468..472 = left iris, 473..477 = right iris.
 *   - Mapping: eye center = midpoint of the eye's outer/inner corner landmarks
 *     (left 33/133, right 362/263); iris = mean of the 5 iris landmarks;
 *     eye width/height from the lid landmarks (159/145, 386/374).
 *
 * Until those pieces exist, detect() returns null and status stays
 * "unavailable", which the processor treats as pass-through.
 */
export class OnnxFaceLandmarkDetector implements FaceLandmarkDetector {
  readonly name = "onnx-face-landmark";
  readonly status = "unavailable" as const;
  readonly unavailableReason: string;
  readonly modelPath?: string;
  readonly executionProvider: "wasm" | "cpu";
  readonly inputSize: number;

  constructor(options: OnnxFaceLandmarkDetectorOptions = {}) {
    this.modelPath = options.modelPath;
    this.executionProvider = options.executionProvider ?? "wasm";
    this.inputSize = options.inputSize ?? 256;
    this.unavailableReason =
      "ONNX face-landmark adapter is a stub: no model is bundled in this MVP and onnxruntime-web/node is not a dependency. " +
      "Provide face_landmark_478.onnx + a face detector, then implement pre/post-processing documented in detector.ts. " +
      "Until then gaze correction runs pass-through.";
  }

  static isModelBundled(): boolean {
    return false;
  }

  detect(_frame: RgbaFrame): FaceLandmarks | null {
    return null;
  }

  dispose(): void {
    // No session/tensor resources exist in the stub.
  }
}

export function createFaceLandmarkDetector(options: {
  readonly mode: "mock" | "onnx";
  readonly mock?: MockFaceLandmarkDetectorOptions;
  readonly onnx?: OnnxFaceLandmarkDetectorOptions;
}): FaceLandmarkDetector {
  if (options.mode === "onnx") return new OnnxFaceLandmarkDetector(options.onnx);
  if (!options.mock) throw new Error("createFaceLandmarkDetector: mock options are required for mode=mock");
  return new DeterministicMockFaceLandmarkDetector(options.mock);
}
