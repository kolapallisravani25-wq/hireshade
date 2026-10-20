import { describe, expect, it } from "vitest";
import {
  CMIODAL_DEFERRED_REASON,
  DIRECTSHOW_DEFERRED_REASON,
  DeferredVirtualCameraSink,
  V4L2_DEFERRED_REASON,
  MockVirtualCameraSink,
  createCmioDalVirtualCameraSink,
  createDirectShowVirtualCameraSink,
  createV4l2LoopbackVirtualCameraSink,
  createVirtualCameraSink,
  virtualCameraSetupGuide,
} from "./virtualCamera";
import { generateSyntheticFace } from "./syntheticFace";

const config = { width: 640, height: 360, fps: 30 };
const frame = generateSyntheticFace({ width: 640, height: 360, leftOffset: { x: 0, y: 0 } }).frame;

describe("virtual camera sinks", () => {
  it("mock sink records pushed frames and validates start order", async () => {
    const sink = new MockVirtualCameraSink("win32");
    await expect(sink.push(frame)).rejects.toThrow(/start/);
    await sink.start(config);
    expect(sink.status).toBe("streaming");
    await sink.push(frame);
    await sink.push({ ...frame, timestampMs: 33 });
    expect(sink.pushCount).toBe(2);
    expect(sink.capabilities.realCameraDevice).toBe(false);
    await sink.stop();
    expect(sink.status).toBe("stopped");
  });

  it("mock sink rejects wrongly sized frames and never records them", async () => {
    const sink = new MockVirtualCameraSink();
    await sink.start(config);
    await expect(sink.push(generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 0, y: 0 } }).frame)).rejects.toThrow(/640x360/);
    expect(sink.status).toBe("error");
    expect(sink.pushCount).toBe(0);
  });

  it("preview-only sink is explicitly deferred with the exact DirectShow reason", async () => {
    const sink = new DeferredVirtualCameraSink("win32");
    await sink.start(config);
    expect(sink.status).toBe("deferred");
    expect(sink.deferredReason).toBe(DIRECTSHOW_DEFERRED_REASON);
    expect(sink.deferredReason).toMatch(/MSVC/);
    expect(sink.deferredReason).toMatch(/regsvr32/);
    await sink.push(frame);
    expect(sink.previewCount).toBe(1);
    expect(sink.setupGuide.steps.length).toBeGreaterThan(2);
  });

  it("DirectShow adapter fails closed with build+registration instructions", async () => {
    const sink = createDirectShowVirtualCameraSink();
    expect(sink.status).toBe("deferred");
    await expect(sink.start(config)).rejects.toThrow(/regsvr32/);
    expect(sink.deferredReason).toMatch(/elevated/);
  });

  it("documents macOS and Linux adapters as deferred", async () => {
    await expect(createCmioDalVirtualCameraSink().start(config)).rejects.toThrow(/DAL/);
    await expect(createV4l2LoopbackVirtualCameraSink().start(config)).rejects.toThrow(/v4l2loopback/);
    expect(CMIODAL_DEFERRED_REASON).toMatch(/CoreMediaIO/);
    expect(V4L2_DEFERRED_REASON).toMatch(/modprobe/);
  });

  it("setup guide is platform specific", () => {
    expect(virtualCameraSetupGuide("win32").steps.join(" ")).toMatch(/DirectShow/);
    expect(virtualCameraSetupGuide("darwin").steps.join(" ")).toMatch(/CoreMediaIO/);
    expect(virtualCameraSetupGuide("linux").steps.join(" ")).toMatch(/v4l2loopback/);
    expect(virtualCameraSetupGuide("unknown").deferred).toBe(true);
  });

  it("factory returns the requested sink mode", () => {
    expect(createVirtualCameraSink({ mode: "mock", platform: "win32" })).toBeInstanceOf(MockVirtualCameraSink);
    expect(createVirtualCameraSink({ mode: "preview-only", platform: "win32" })).toBeInstanceOf(DeferredVirtualCameraSink);
    expect(createVirtualCameraSink({ mode: "directshow" }).kind).toBe("directshow-deferred");
  });
});
