/**
 * Frame source abstraction (W4).
 *
 * The MVP has no browser/Electron camera binding in this module: it ships a
 * deterministic synthetic source plus explicit camera failure semantics so the
 * pipeline can be tested for missing camera, camera-in-use and hot-unplug
 * without hardware. A real adapter (getUserMedia -> VideoFrame -> RgbaFrame)
 * plugs into the same interface in the Electron renderer.
 */
import type { RgbaFrame, FrameSource, FrameSourceState } from "./types";
import { generateSyntheticFace } from "./syntheticFace";

export type CameraFailure =
  | "camera-missing"
  | "camera-in-use"
  | "camera-lost"
  | "permission-denied"
  | "unknown";

export interface ScriptedFrameSourceStep {
  readonly frame?: RgbaFrame;
  readonly error?: CameraFailure | string;
  readonly state?: FrameSourceState;
}

export interface ScriptedFrameSourceOptions {
  readonly rootWidth: number;
  readonly rootHeight: number;
  readonly steps: readonly ScriptedFrameSourceStep[];
  readonly startError?: CameraFailure | string;
  readonly kind?: string;
}

function failureState(failure: string): FrameSourceState {
  if (failure === "camera-missing" || failure === "permission-denied") return "error";
  if (failure === "camera-in-use") return "reconnecting";
  if (failure === "camera-lost") return "reconnecting";
  return "error";
}

/**
 * Replays a scripted sequence of frames/failures. read() never throws: errors
 * become null + a state transition, mirroring the real adapter contract.
 */
export class ScriptedFrameSource implements FrameSource {
  readonly kind: string;
  private currentState: FrameSourceState = "idle";
  private index = 0;
  private readonly options: ScriptedFrameSourceOptions;
  private readonly listeners = new Set<(state: FrameSourceState, detail?: string) => void>();
  private lastDetail?: string;

  constructor(options: ScriptedFrameSourceOptions) {
    this.options = options;
    this.kind = options.kind ?? "scripted";
  }

  get state(): FrameSourceState {
    return this.currentState;
  }

  get lastErrorDetail(): string | undefined {
    return this.lastDetail;
  }

  onStateChange(listener: (state: FrameSourceState, detail?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: FrameSourceState, detail?: string): void {
    this.currentState = state;
    this.lastDetail = detail;
    for (const listener of this.listeners) listener(state, detail);
  }

  async start(): Promise<void> {
    if (this.options.startError) {
      this.setState(failureState(this.options.startError), this.options.startError);
      throw new Error("frame source unavailable: " + this.options.startError);
    }
    this.setState("streaming");
  }

  async read(): Promise<RgbaFrame | null> {
    if (this.currentState === "idle" || this.currentState === "starting") return null;
    const step = this.options.steps[this.index];
    if (!step) {
      this.setState("streaming");
      return null;
    }
    this.index += 1;
    if (step.error) {
      this.setState(failureState(step.error), step.error);
      return null;
    }
    if (step.state) this.setState(step.state);
    else this.setState("streaming");
    return step.frame ?? null;
  }

  async stop(): Promise<void> {
    this.setState("idle");
  }
}

/** Deterministic synthetic source used by the preview/demo/tests. */
export class SyntheticFrameSource implements FrameSource {
  readonly kind = "synthetic";
  private currentState: FrameSourceState = "idle";
  private index = 0;
  private readonly width: number;
  private readonly height: number;
  private readonly offsets: readonly { x: number; y: number }[];
  private readonly seed: number;
  private readonly listeners = new Set<(state: FrameSourceState, detail?: string) => void>();

  constructor(options: {
    width: number;
    height: number;
    offsets?: readonly { x: number; y: number }[];
    seed?: number;
  }) {
    this.width = options.width;
    this.height = options.height;
    this.offsets = options.offsets ?? [{ x: 0, y: 0 }];
    this.seed = options.seed ?? 42;
  }

  get state(): FrameSourceState {
    return this.currentState;
  }

  onStateChange(listener: (state: FrameSourceState, detail?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: FrameSourceState): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }

  async start(): Promise<void> {
    this.setState("starting");
    this.setState("streaming");
  }

  async read(): Promise<RgbaFrame | null> {
    if (this.currentState !== "streaming" && this.currentState !== "reconnecting") return null;
    const offset = this.offsets[this.index % this.offsets.length]!;
    const face = generateSyntheticFace({
      width: this.width,
      height: this.height,
      leftOffset: offset,
      seed: this.seed + this.index,
      timestampMs: this.index * (1000 / 30),
    });
    this.index += 1;
    return face.frame;
  }

  async stop(): Promise<void> {
    this.setState("idle");
  }
}

/** Wraps any source so start/read/stop never throw out of the pipeline. */
export class ResilientFrameSource implements FrameSource {
  readonly kind: string;
  private currentState: FrameSourceState = "idle";
  private readonly inner: FrameSource;
  private readonly listeners = new Set<(state: FrameSourceState, detail?: string) => void>();

  constructor(inner: FrameSource) {
    this.inner = inner;
    this.kind = "resilient:" + inner.kind;
  }

  get state(): FrameSourceState {
    return this.currentState;
  }

  get innerSource(): FrameSource {
    return this.inner;
  }

  onStateChange(listener: (state: FrameSourceState, detail?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(state: FrameSourceState, detail?: string): void {
    this.currentState = state;
    for (const listener of this.listeners) listener(state, detail);
  }

  async start(): Promise<void> {
    this.setState("starting");
    try {
      await this.inner.start();
      this.setState("streaming");
    } catch (error) {
      // Preserve transient camera failures (in use / reconnecting) instead of
      // collapsing everything to a hard error.
      const innerState = this.inner.state;
      this.setState(innerState === "reconnecting" ? "reconnecting" : "error", describeError(error));
    }
  }

  async read(): Promise<RgbaFrame | null> {
    try {
      const frame = await this.inner.read();
      if (!frame) {
        this.setState(this.inner.state === "reconnecting" ? "reconnecting" : "error");
        return null;
      }
      this.setState("streaming");
      return frame;
    } catch (error) {
      this.setState("reconnecting", describeError(error));
      return null;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.inner.stop();
    } finally {
      this.setState("idle");
    }
  }
}

export function describeCameraFailure(failure: CameraFailure): string {
  switch (failure) {
    case "camera-missing":
      return "No camera device found (check Windows Privacy > Camera and the device manager).";
    case "camera-in-use":
      return "Camera is in use by another application (Zoom/Teams/Meet). The preview will resume when released.";
    case "camera-lost":
      return "Camera was unplugged or stopped delivering frames; attempting to reconnect.";
    case "permission-denied":
      return "Camera permission was denied. Enable it in OS privacy settings and restart the app.";
    default:
      return "Unknown camera failure.";
  }
}

/** Map a DOMException / getUserMedia rejection into a stable failure reason. */
export function cameraFailureFromError(error: unknown): CameraFailure {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "camera-missing";
  if (name === "NotReadableError" || name === "TrackStartError") return "camera-in-use";
  if (name === "OverconstrainedError") return "camera-missing";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "permission-denied";
  if (name === "AbortError") return "camera-lost";
  return "unknown";
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
