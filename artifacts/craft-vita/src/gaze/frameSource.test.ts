import { describe, expect, it } from "vitest";
import {
  ResilientFrameSource,
  ScriptedFrameSource,
  SyntheticFrameSource,
  cameraFailureFromError,
  describeCameraFailure,
} from "./frameSource";
import { generateSyntheticFace } from "./syntheticFace";

const frame = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 0, y: 0 } }).frame;

describe("frame sources", () => {
  it("synthetic source yields frames and tracks state", async () => {
    const source = new SyntheticFrameSource({ width: 320, height: 180, offsets: [{ x: 2, y: 0 }, { x: 4, y: 0 }] });
    const states: string[] = [];
    source.onStateChange((state) => states.push(state));
    await source.start();
    expect(source.state).toBe("streaming");
    const first = await source.read();
    const second = await source.read();
    expect(first?.width).toBe(320);
    expect(second?.timestampMs).toBeGreaterThan(first!.timestampMs);
    await source.stop();
    expect(source.state).toBe("idle");
    expect(states).toContain("streaming");
  });

  it("camera missing / in use / hot-unplug never throw out of the pipeline", async () => {
    const missing = new ResilientFrameSource(
      new ScriptedFrameSource({ rootWidth: 320, rootHeight: 180, startError: "camera-missing", steps: [] }),
    );
    await expect(missing.start()).resolves.toBeUndefined();
    expect(missing.state).toBe("error");
    expect(await missing.read()).toBeNull();

    const unplug = new ResilientFrameSource(
      new ScriptedFrameSource({
        rootWidth: 320,
        rootHeight: 180,
        steps: [{ frame }, { error: "camera-lost" }, { frame }],
      }),
    );
    await unplug.start();
    expect(await unplug.read()).not.toBeNull();
    expect(await unplug.read()).toBeNull();
    expect(unplug.state).toBe("reconnecting");
    // Hot-plug/reconnect resumes with real frames again.
    expect(await unplug.read()).not.toBeNull();
    expect(unplug.state).toBe("streaming");

    const inUse = new ResilientFrameSource(
      new ScriptedFrameSource({ rootWidth: 320, rootHeight: 180, startError: "camera-in-use", steps: [] }),
    );
    await inUse.start();
    expect(inUse.state).toBe("reconnecting");
    expect(await inUse.read()).toBeNull();
  });

  it("maps DOMException-style errors to stable reasons", () => {
    expect(cameraFailureFromError({ name: "NotFoundError" })).toBe("camera-missing");
    expect(cameraFailureFromError({ name: "NotReadableError" })).toBe("camera-in-use");
    expect(cameraFailureFromError({ name: "NotAllowedError" })).toBe("permission-denied");
    expect(cameraFailureFromError({ name: "AbortError" })).toBe("camera-lost");
    expect(cameraFailureFromError(new Error("boom"))).toBe("unknown");
    expect(describeCameraFailure("camera-in-use")).toMatch(/another application/);
    expect(describeCameraFailure("camera-missing")).toMatch(/No camera/);
  });

  it("scripted source reports a state listener unsubscribe", async () => {
    const source = new ScriptedFrameSource({ rootWidth: 10, rootHeight: 10, steps: [{ frame }] });
    const seen: string[] = [];
    const unsubscribe = source.onStateChange((state) => seen.push(state));
    await source.start();
    unsubscribe();
    await source.read();
    expect(seen).toEqual(["streaming"]);
  });

  it("a failing source produces pass-through frames (processor integration contract)", async () => {
    // The frame source contract: null on failure. The processor is responsible
    // for pass-through; here we assert the source never yields partial frames.
    const source = new ResilientFrameSource(
      new ScriptedFrameSource({ rootWidth: 320, rootHeight: 180, steps: [{ error: "camera-in-use" }, { frame }] }),
    );
    await source.start();
    expect(await source.read()).toBeNull();
    const recovered = await source.read();
    expect(recovered).not.toBeNull();
    expect(recovered!.data.length).toBe(recovered!.width * recovered!.height * 4);
  });
});
