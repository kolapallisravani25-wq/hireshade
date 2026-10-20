/**
 * Gaze correction — shared types and interfaces (W4).
 *
 * Everything here is deliberately DOM/Node-free so the pipeline can run in the
 * browser preview, Electron main, the demo harness, and unit tests unchanged.
 *
 * Design rule: every stage is optional and failure is non-fatal. If a detector,
 * warper, frame source or virtual-camera sink cannot run, the processor must
 * emit the original frame bytes untouched (pass-through), never a half-warped
 * frame.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Landmarks for one eye. center = neutral gaze axis, iris = observed iris. */
export interface EyeLandmarks {
  readonly center: Point;
  readonly iris: Point;
  /** Horizontal eye width in pixels (used for ROI + correction clamp). */
  readonly width: number;
  /** Vertical eye opening height in pixels. */
  readonly height: number;
}

export interface FaceLandmarks {
  readonly leftEye: EyeLandmarks;
  readonly rightEye: EyeLandmarks;
  /** 0..1 detector confidence; low confidence should be treated as failure. */
  readonly confidence: number;
}

/**
 * A single RGBA frame (4 bytes per pixel, row-major, top-left origin).
 * data.length === width * height * 4.
 */
export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Presentation timestamp in milliseconds. */
  readonly timestampMs: number;
}

export type FrameSourceState =
  | "idle"
  | "starting"
  | "streaming"
  | "reconnecting"
  | "error";

/**
 * Camera abstraction. Implementations must never throw from read(): a missing
 * device, camera-in-use (NotReadableError) or hot-unplug becomes null plus a
 * state change so the pipeline keeps running (and stays pass-through).
 */
export interface FrameSource {
  readonly kind: string;
  readonly state: FrameSourceState;
  start(): Promise<void>;
  read(): Promise<RgbaFrame | null>;
  stop(): Promise<void>;
  /** Optional observer for state diagnostics. Returns an unsubscribe function. */
  onStateChange?(listener: (state: FrameSourceState, detail?: string) => void): () => void;
}

export type FaceLandmarkDetectorStatus = "ready" | "unavailable" | "error";

/**
 * Landmark detector abstraction.
 *
 * The MVP ships a deterministic mock (synthetic faces) and an ONNX Runtime
 * adapter stub. A real detector must return 468 face landmarks + 10 iris
 * landmarks (MediaPipe face-mesh layout) mapped to EyeLandmarks; the stub
 * documents the exact tensor contract in detector.ts.
 */
export interface FaceLandmarkDetector {
  readonly name: string;
  readonly status: FaceLandmarkDetectorStatus;
  readonly unavailableReason?: string;
  detect(frame: RgbaFrame): FaceLandmarks | null;
  dispose?(): void;
}

export interface WarpCorrection {
  readonly left: Point;
  readonly right: Point;
}

export interface WarpResult {
  /** Warped frame, or the exact input object when nothing was applied. */
  readonly frame: RgbaFrame;
  /** Pixels the iris was moved by (negative = toward the eye center). */
  readonly correction: WarpCorrection;
  readonly applied: boolean;
}

export interface GazeWarper {
  warp(frame: RgbaFrame, landmarks: FaceLandmarks, strength: number): WarpResult;
  reset(): void;
}

export type VirtualCameraStatus = "stopped" | "streaming" | "deferred" | "error";

export interface VirtualCameraConfig {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly name?: string;
}

export interface VirtualCameraCapabilities {
  /** True only when the OS can actually expose a new camera device. */
  readonly realCameraDevice: boolean;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly fps: number;
  readonly platform: "win32" | "darwin" | "linux" | "unknown";
}

/**
 * Virtual-camera sink. The MVP ships a mock and a clearly-labelled deferred
 * (preview-only) sink; the DirectShow adapter is documented in GAZE.md with the
 * exact MSVC build + elevated COM registration steps that are deferred.
 */
export interface VirtualCameraSink {
  readonly kind: string;
  readonly status: VirtualCameraStatus;
  readonly capabilities: VirtualCameraCapabilities;
  /** Present when status === "deferred" or "error". */
  readonly deferredReason?: string;
  start(config: VirtualCameraConfig): Promise<void>;
  push(frame: RgbaFrame): Promise<void>;
  stop(): Promise<void>;
}

export interface GazeFrameMetrics {
  /** True only when the warper actually changed pixels. */
  readonly applied: boolean;
  /** Why the frame passed through unchanged (null when applied). */
  readonly passthroughReason: string | null;
  readonly detectorStatus: FaceLandmarkDetectorStatus;
  readonly effectiveStrength: number;
  readonly durationMs: number;
  readonly correction: WarpCorrection | null;
  readonly outputWidth: number;
  readonly outputHeight: number;
}
