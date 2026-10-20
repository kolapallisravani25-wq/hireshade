/**
 * Gaze correction processor (W4).
 *
 * Orchestrates: frame normalization (fixed output size/fps) -> landmark
 * detection -> EMA-smoothed warp -> pass-through guarantees.
 *
 * Hard rule: process() never throws and never returns a partially processed
 * frame. Any failure (disabled, missing frame, detector unavailable/throwing,
 * low confidence, warper failure, invalid frame) returns the ORIGINAL frame
 * object with identical bytes, tagged with a passthroughReason.
 */
import type {
  FaceLandmarkDetector,
  GazeFrameMetrics,
  GazeWarper,
  RgbaFrame,
  WarpCorrection,
} from "./types";
import { WarpGazeWarper } from "./warp";

export const DEFAULT_OUTPUT_WIDTH = 1280;
export const DEFAULT_OUTPUT_HEIGHT = 720;
export const DEFAULT_FPS = 30;
export const DEFAULT_STREAMING_BOOST = 1.35;

export function frameIntervalMs(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return 1000 / DEFAULT_FPS;
  return 1000 / fps;
}

/** Quantize a timestamp to the fixed-fps grid (deterministic output cadence). */
export function quantizeTimestamp(timestampMs: number, fps: number): number {
  const interval = frameIntervalMs(fps);
  const safe = Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : 0;
  // Round to microseconds so 30 fps produces 1000 (not 1000.0000000000001).
  return Math.round((Math.round(safe / interval) * interval) * 1000) / 1000;
}

/**
 * Auto-boost while an answer is streaming (reading mode): the viewer needs the
 * correction to hold while they read, so amplitude is raised, never lowered.
 */
export function resolveEffectiveStrength(
  baseStrength: number,
  streaming: boolean,
  boostRatio = DEFAULT_STREAMING_BOOST,
): number {
  const base = Math.min(1, Math.max(0, Number.isFinite(baseStrength) ? baseStrength : 0));
  if (!streaming) return base;
  const ratio = Math.min(2, Math.max(1, Number.isFinite(boostRatio) ? boostRatio : DEFAULT_STREAMING_BOOST));
  return Math.min(1, base * ratio);
}

/** Bilinear RGBA resize (only used when the source size differs from output). */
export function resizeFrame(frame: RgbaFrame, width: number, height: number, timestampMs?: number): RgbaFrame {
  if (frame.width === width && frame.height === height && timestampMs === undefined) return frame;
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const scaleX = frame.width / targetWidth;
  const scaleY = frame.height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(frame.height - 1, Math.max(0, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(frame.height - 1, y0 + 1);
    const fy = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(frame.width - 1, Math.max(0, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(frame.width - 1, x0 + 1);
      const fx = sourceX - x0;
      const i00 = (y0 * frame.width + x0) * 4;
      const i10 = (y0 * frame.width + x1) * 4;
      const i01 = (y1 * frame.width + x0) * 4;
      const i11 = (y1 * frame.width + x1) * 4;
      const out = (y * targetWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = frame.data[i00 + channel]! * (1 - fx) + frame.data[i10 + channel]! * fx;
        const bottom = frame.data[i01 + channel]! * (1 - fx) + frame.data[i11 + channel]! * fx;
        data[out + channel] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return {
    width: targetWidth,
    height: targetHeight,
    data,
    timestampMs: timestampMs === undefined ? frame.timestampMs : quantizeTimestamp(timestampMs, DEFAULT_FPS),
  };
}

export interface GazeProcessorConfig {
  readonly enabled?: boolean;
  readonly strength?: number;
  readonly streaming?: boolean;
  readonly detector: FaceLandmarkDetector;
  readonly warper?: GazeWarper;
  readonly outputWidth?: number;
  readonly outputHeight?: number;
  readonly fps?: number;
  /** Detector confidence below this is treated as "no landmarks" (passthrough). */
  readonly minConfidence?: number;
  readonly streamingBoost?: number;
}

export interface GazeProcessResult {
  /** The output frame (same object as input on pass-through). */
  readonly frame: RgbaFrame;
  /** Original input frame, always unchanged. */
  readonly original: RgbaFrame;
  readonly metrics: GazeFrameMetrics;
}

export class GazeCorrectionProcessor {
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly fps: number;
  private readonly minConfidence: number;
  private readonly streamingBoost: number;
  private enabledValue: boolean;
  private strengthValue: number;
  private streamingValue: boolean;
  private detector: FaceLandmarkDetector;
  private readonly warper: GazeWarper;
  private lastError: string | null = null;
  private lastMetrics: GazeFrameMetrics | null = null;

  constructor(config: GazeProcessorConfig) {
    this.enabledValue = config.enabled ?? true;
    this.strengthValue = clamp01(config.strength ?? 0.85);
    this.streamingValue = config.streaming ?? false;
    this.detector = config.detector;
    this.warper = config.warper ?? new WarpGazeWarper();
    this.outputWidth = config.outputWidth ?? DEFAULT_OUTPUT_WIDTH;
    this.outputHeight = config.outputHeight ?? DEFAULT_OUTPUT_HEIGHT;
    this.fps = config.fps ?? DEFAULT_FPS;
    this.minConfidence = clamp01(config.minConfidence ?? 0.5);
    this.streamingBoost = config.streamingBoost ?? DEFAULT_STREAMING_BOOST;
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  get strength(): number {
    return this.strengthValue;
  }

  get streaming(): boolean {
    return this.streamingValue;
  }

  get detectorStatus(): FaceLandmarkDetector["status"] {
    return this.detector.status;
  }

  get detectorName(): string {
    return this.detector.name;
  }

  get lastProcessingError(): string | null {
    return this.lastError;
  }

  get lastFrameMetrics(): GazeFrameMetrics | null {
    return this.lastMetrics;
  }

  setEnabled(enabled: boolean): void {
    this.enabledValue = Boolean(enabled);
  }

  setStrength(strength: number): void {
    this.strengthValue = clamp01(strength);
  }

  /** Called by the session/answer stream: raises strength while tokens stream. */
  setStreaming(streaming: boolean): void {
    this.streamingValue = Boolean(streaming);
  }

  /** Swap detectors (e.g. mock -> ONNX once a model is bundled). */
  setDetector(detector: FaceLandmarkDetector): void {
    this.detector = detector;
  }

  reset(): void {
    this.warper.reset?.();
    this.lastMetrics = null;
    this.lastError = null;
  }

  process(frame: RgbaFrame): GazeProcessResult {
    const started = performance.now();
    const baseMetrics = (applied: boolean, passthroughReason: string | null, effectiveStrength: number, correction: WarpCorrection | null, output: RgbaFrame): GazeFrameMetrics => ({
      applied,
      passthroughReason,
      detectorStatus: this.detector.status,
      effectiveStrength,
      durationMs: performance.now() - started,
      correction,
      outputWidth: output.width,
      outputHeight: output.height,
    });
    const passthrough = (reason: string, output: RgbaFrame = frame, effectiveStrength = 0): GazeProcessResult => {
      const metrics = baseMetrics(false, reason, effectiveStrength, null, output);
      this.lastMetrics = metrics;
      return { frame: output, original: frame, metrics };
    };

    if (!this.enabledValue) return passthrough("disabled");
    if (!isValidFrame(frame)) return passthrough("invalid-frame");
    if (!this.detector || this.detector.status !== "ready") return passthrough("detector-unavailable");

    let working: RgbaFrame;
    try {
      working =
        frame.width === this.outputWidth && frame.height === this.outputHeight
          ? frame
          : resizeFrame(frame, this.outputWidth, this.outputHeight);
    } catch (error) {
      this.lastError = "resize-failed: " + describeError(error);
      return passthrough("resize-failed");
    }

    let landmarks = null;
    try {
      landmarks = this.detector.detect(working);
    } catch (error) {
      this.lastError = "detector-threw: " + describeError(error);
      return passthrough("detector-error");
    }
    if (!landmarks) return passthrough("detector-null");
    if (!(landmarks.confidence >= this.minConfidence)) return passthrough("low-confidence");

    const effectiveStrength = resolveEffectiveStrength(this.strengthValue, this.streamingValue, this.streamingBoost);
    if (effectiveStrength <= 0) return passthrough("zero-strength", frame, effectiveStrength);

    try {
      const result = this.warper.warp(working, landmarks, effectiveStrength);
      if (!result.applied) return passthrough("no-correction", frame, effectiveStrength);
      const output: RgbaFrame = result.frame === working && working !== frame
        ? working
        : {
            width: result.frame.width,
            height: result.frame.height,
            data: result.frame.data,
            timestampMs: quantizeTimestamp(result.frame.timestampMs, this.fps),
          };
      const metrics = baseMetrics(true, null, effectiveStrength, result.correction, output);
      this.lastMetrics = metrics;
      this.lastError = null;
      return { frame: output, original: frame, metrics };
    } catch (error) {
      this.lastError = "warper-threw: " + describeError(error);
      return passthrough("warper-error", frame, effectiveStrength);
    }
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isValidFrame(frame: RgbaFrame | null | undefined): frame is RgbaFrame {
  return Boolean(
    frame &&
      Number.isInteger(frame.width) &&
      Number.isInteger(frame.height) &&
      frame.width > 0 &&
      frame.height > 0 &&
      frame.data instanceof Uint8ClampedArray &&
      frame.data.length === frame.width * frame.height * 4 &&
      Number.isFinite(frame.timestampMs),
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
