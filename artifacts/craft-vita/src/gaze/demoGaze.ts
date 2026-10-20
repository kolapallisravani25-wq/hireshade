/**
 * Demo-harness integration for gaze correction (W4).
 *
 * The demo pipeline (src/demo/pipeline.ts) is owned by the harness task, so the
 * gaze stage is exposed as a flag-gated factory + one deterministic burst. The
 * Lead can wire it with:
 *
 *   import { isGazeDemoEnabled, runDemoGazeStage } from "@/gaze/demoGaze";
 *   if (isGazeDemoEnabled(process.env)) {
 *     const gaze = runDemoGazeStage();
 *     emit({ type: "gaze.summary", atMs: 0, mediaMs: 0, stream: null, data: gaze });
 *   }
 *
 * Flag: DEMO_GAZE=1 (also accepts GAZE_DEMO=1). Off by default, so the existing
 * demo output/tests are unchanged until the Lead wires and enables it.
 */
import { GazeCorrectionProcessor } from "./processor";
import { DeterministicMockFaceLandmarkDetector } from "./detector";
import { generateSyntheticFace } from "./syntheticFace";
import type { RgbaFrame } from "./types";

export const GAZE_DEMO_FLAGS = ["DEMO_GAZE", "GAZE_DEMO"] as const;

export function isGazeDemoEnabled(env: Record<string, string | undefined> | undefined): boolean {
  if (!env) return false;
  return GAZE_DEMO_FLAGS.some((flag) => env[flag] === "1");
}

export const DEMO_GAZE_WIDTH = 1280;
export const DEMO_GAZE_HEIGHT = 720;
export const DEMO_GAZE_OFFSETS = [
  { x: 14, y: 4 },
  { x: 12, y: -2 },
  { x: 9, y: 3 },
] as const;

export function demoGazeFrames(): RgbaFrame[] {
  return DEMO_GAZE_OFFSETS.map((offset, index) =>
    generateSyntheticFace({
      width: DEMO_GAZE_WIDTH,
      height: DEMO_GAZE_HEIGHT,
      leftOffset: offset,
      seed: 1000 + index,
      timestampMs: index * (1000 / 30),
    }).frame,
  );
}

export function createDemoGazeProcessor(env: Record<string, string | undefined> | undefined): GazeCorrectionProcessor | null {
  if (!isGazeDemoEnabled(env)) return null;
  const detector = new DeterministicMockFaceLandmarkDetector({
    width: DEMO_GAZE_WIDTH,
    height: DEMO_GAZE_HEIGHT,
    offsets: DEMO_GAZE_OFFSETS.map((offset) => ({ x: offset.x, y: offset.y })),
    fallbackOffset: { x: 10, y: 0 },
  });
  return new GazeCorrectionProcessor({
    enabled: true,
    strength: 0.85,
    detector,
    outputWidth: DEMO_GAZE_WIDTH,
    outputHeight: DEMO_GAZE_HEIGHT,
    fps: 30,
  });
}

export interface DemoGazeSummary {
  readonly enabled: boolean;
  readonly framesProcessed: number;
  readonly appliedFrames: number;
  readonly passthroughFrames: number;
  readonly detectorName: string;
  readonly detectorStatus: string;
  readonly meanDurationMs: number;
  readonly maxDurationMs: number;
  readonly effectiveStrength: number;
  readonly output: { width: number; height: number; fps: number };
  readonly note: string;
}

/** One deterministic burst proving the demo stage works without a camera. */
export function runDemoGazeStage(
  options: { readonly env?: Record<string, string | undefined>; readonly frames?: readonly RgbaFrame[] } = {},
): DemoGazeSummary {
  const processor = createDemoGazeProcessor(options.env);
  if (!processor) {
    return {
      enabled: false,
      framesProcessed: 0,
      appliedFrames: 0,
      passthroughFrames: 0,
      detectorName: "none",
      detectorStatus: "unavailable",
      meanDurationMs: 0,
      maxDurationMs: 0,
      effectiveStrength: 0,
      output: { width: DEMO_GAZE_WIDTH, height: DEMO_GAZE_HEIGHT, fps: 30 },
      note: "DEMO_GAZE is off; gaze stage skipped (demo output unchanged).",
    };
  }
  const frames = options.frames ?? demoGazeFrames();
  let applied = 0;
  let passthrough = 0;
  let total = 0;
  let max = 0;
  for (const frame of frames) {
    const result = processor.process(frame);
    if (result.metrics.applied) applied += 1;
    else passthrough += 1;
    total += result.metrics.durationMs;
    max = Math.max(max, result.metrics.durationMs);
  }
  return {
    enabled: true,
    framesProcessed: frames.length,
    appliedFrames: applied,
    passthroughFrames: passthrough,
    detectorName: processor.detectorName,
    detectorStatus: processor.detectorStatus,
    meanDurationMs: frames.length > 0 ? total / frames.length : 0,
    maxDurationMs: max,
    effectiveStrength: processor.strength,
    output: { width: processor.outputWidth, height: processor.outputHeight, fps: processor.fps },
    note: "Synthetic 720p frames; DEMO_GAZE hook is ready for the Lead to emit in the demo pipeline.",
  };
}
