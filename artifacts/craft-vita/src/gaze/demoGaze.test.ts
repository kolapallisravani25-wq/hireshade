import { describe, expect, it } from "vitest";
import {
  DEMO_GAZE_OFFSETS,
  createDemoGazeProcessor,
  demoGazeFrames,
  isGazeDemoEnabled,
  runDemoGazeStage,
} from "./demoGaze";

describe("demo gaze flag", () => {
  it("is off by default and for unrelated env vars", () => {
    expect(isGazeDemoEnabled({})).toBe(false);
    expect(isGazeDemoEnabled(undefined)).toBe(false);
    expect(isGazeDemoEnabled({ DEMO_GAZE: "0" })).toBe(false);
    expect(createDemoGazeProcessor({})).toBeNull();
    expect(runDemoGazeStage({ env: {} }).enabled).toBe(false);
  });

  it("is enabled by DEMO_GAZE=1 or GAZE_DEMO=1", () => {
    expect(isGazeDemoEnabled({ DEMO_GAZE: "1" })).toBe(true);
    expect(isGazeDemoEnabled({ GAZE_DEMO: "1" })).toBe(true);
    const processor = createDemoGazeProcessor({ DEMO_GAZE: "1" });
    expect(processor).not.toBeNull();
    expect(processor!.outputWidth).toBe(1280);
    expect(processor!.fps).toBe(30);
  });

  it("runs a deterministic mock burst for the demo pipeline", () => {
    const summary = runDemoGazeStage({ env: { DEMO_GAZE: "1" } });
    expect(summary.enabled).toBe(true);
    expect(summary.framesProcessed).toBe(DEMO_GAZE_OFFSETS.length);
    expect(summary.appliedFrames).toBe(DEMO_GAZE_OFFSETS.length);
    expect(summary.passthroughFrames).toBe(0);
    expect(summary.detectorStatus).toBe("ready");
    expect(summary.output).toEqual({ width: 1280, height: 720, fps: 30 });
    expect(summary.meanDurationMs).toBeGreaterThanOrEqual(0);
    expect(summary.maxDurationMs).toBeLessThan(250);
    expect(demoGazeFrames()).toHaveLength(3);
  });

  it("is byte-deterministic across runs", () => {
    const a = demoGazeFrames();
    const b = demoGazeFrames();
    for (let index = 0; index < a.length; index += 1) {
      expect(Buffer.from(a[index]!.data).equals(Buffer.from(b[index]!.data))).toBe(true);
    }
  });
});
