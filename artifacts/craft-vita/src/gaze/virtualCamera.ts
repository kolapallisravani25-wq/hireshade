/**
 * Virtual camera sinks (W4).
 *
 * Reality check: exposing a new camera device to Zoom/Meet/Teams needs a
 * platform driver, not just an app API. This MVP ships:
 *   - MockVirtualCameraSink: deterministic sink for tests/demo (records frames).
 *   - DeferredVirtualCameraSink: explicitly preview-only; start() succeeds and
 *     status === "deferred" with the exact setup reason, so the app can show
 *     "Preview only — virtual camera requires the driver build/registration".
 *   - DirectShow / CMIO / v4l2loopback adapters: typed stubs that fail closed
 *     with the exact deferred reason. No fake success.
 *
 * Windows DirectShow DLL registration is DEFERRED: it needs an MSVC-built COM
 * filter DLL plus elevated registration (regsvr32 as Administrator) or a signed
 * installer, none of which exist in this repo/environment.
 */
import type { RgbaFrame, VirtualCameraCapabilities, VirtualCameraConfig, VirtualCameraSink, VirtualCameraStatus } from "./types";

export type GazePlatform = "win32" | "darwin" | "linux" | "unknown";

export function currentGazePlatform(platform: string | undefined): GazePlatform {
  if (platform === "win32" || platform === "darwin" || platform === "linux") return platform;
  return "unknown";
}

export const DIRECTSHOW_DEFERRED_REASON =
  "Windows DirectShow virtual-camera DLL is DEFERRED: it requires an MSVC-built COM filter DLL (x64, DirectShow BaseClasses) and elevated COM registration (regsvr32 from an Administrator prompt, or a signed installer writing HKLM/HKCU CLSID + filter category). Neither the DLL nor an elevated registration step exists in this environment, so only mock/preview sinks are shipped. Build/register setup is documented in docs/GAZE.md.";

export const CMIODAL_DEFERRED_REASON =
  "macOS CMIO DAL virtual camera is DEFERRED: it requires an Xcode-built CoreMediaIO DAL plugin bundle, Developer ID signing, installation under /Library/CoreMediaIO/Plug-Ins/DAL, and a coreaudiod restart. No macOS host/build is available here. See docs/GAZE.md.";

export const V4L2_DEFERRED_REASON =
  "Linux v4l2loopback virtual camera is DEFERRED: it requires the v4l2loopback kernel module (modprobe v4l2loopback video_nr=10 exclusive_caps=1), root/kernel headers, and YUV frame writing to /dev/video10. No Linux host is available here. See docs/GAZE.md.";

export interface VirtualCameraSetupGuide {
  readonly platform: GazePlatform;
  readonly supportedInThisBuild: boolean;
  readonly deferred: boolean;
  readonly reason: string;
  readonly steps: readonly string[];
}

export function virtualCameraSetupGuide(platform: GazePlatform): VirtualCameraSetupGuide {
  switch (platform) {
    case "win32":
      return {
        platform,
        supportedInThisBuild: false,
        deferred: true,
        reason: DIRECTSHOW_DEFERRED_REASON,
        steps: [
          "Build the DirectShow virtual-camera filter DLL with MSVC (Visual Studio Build Tools, x64, DirectShow BaseClasses).",
          "Register the COM filter with elevation: regsvr32 <path>\\GazeVirtualCamera.dll from an Administrator prompt (or an installer writing HKLM/HKCU CLSID + CLSID_VideoInputDeviceCategory).",
          "Restart the consuming app (Zoom/Teams/Meet) so it re-enumerates camera devices.",
          "Sign the DLL/installer (Authenticode) before distribution; unsigned drivers/installers trigger SmartScreen/AV warnings.",
        ],
      };
    case "darwin":
      return {
        platform,
        supportedInThisBuild: false,
        deferred: true,
        reason: CMIODAL_DEFERRED_REASON,
        steps: [
          "Build a CoreMediaIO DAL plugin bundle with Xcode.",
          "Sign it with a Developer ID certificate and install to /Library/CoreMediaIO/Plug-Ins/DAL.",
          "Restart coreaudiod (or reboot) so apps can enumerate the camera.",
        ],
      };
    case "linux":
      return {
        platform,
        supportedInThisBuild: false,
        deferred: true,
        reason: V4L2_DEFERRED_REASON,
        steps: [
          "Install kernel headers and build/load v4l2loopback: modprobe v4l2loopback video_nr=10 exclusive_caps=1.",
          "Write YUV420 frames to /dev/video10 at the configured resolution/fps.",
          "Grant the app permission (video group / udev rule).",
        ],
      };
    default:
      return {
        platform,
        supportedInThisBuild: false,
        deferred: true,
        reason: "Virtual camera is unsupported on this platform in the MVP.",
        steps: ["Use the mock sink for tests and preview-only mode for the UI."],
      };
  }
}

function baseCapabilities(platform: GazePlatform): VirtualCameraCapabilities {
  return {
    realCameraDevice: false,
    maxWidth: 1280,
    maxHeight: 720,
    fps: 30,
    platform,
  };
}

function validateFrame(frame: RgbaFrame, config: VirtualCameraConfig): string | null {
  if (!frame || !(frame.data instanceof Uint8ClampedArray)) return "invalid frame";
  if (frame.data.length !== frame.width * frame.height * 4) return "frame buffer size mismatch";
  if (frame.width !== config.width || frame.height !== config.height) {
    return "frame is " + frame.width + "x" + frame.height + " but sink was started for " + config.width + "x" + config.height;
  }
  return null;
}

/** Deterministic in-memory sink: records frames so tests/demo can assert flow. */
export class MockVirtualCameraSink implements VirtualCameraSink {
  readonly kind = "mock";
  readonly capabilities: VirtualCameraCapabilities;
  private currentStatus: VirtualCameraStatus = "stopped";
  private config: VirtualCameraConfig | null = null;
  private frames: RgbaFrame[] = [];

  constructor(platform: GazePlatform = "win32") {
    this.capabilities = { ...baseCapabilities(platform), realCameraDevice: false };
  }

  get status(): VirtualCameraStatus {
    return this.currentStatus;
  }

  get pushedFrames(): readonly RgbaFrame[] {
    return this.frames;
  }

  get pushCount(): number {
    return this.frames.length;
  }

  async start(config: VirtualCameraConfig): Promise<void> {
    if (!Number.isInteger(config.width) || !Number.isInteger(config.height) || config.width <= 0 || config.height <= 0) {
      this.currentStatus = "error";
      throw new Error("MockVirtualCameraSink: invalid configuration");
    }
    this.config = config;
    this.frames = [];
    this.currentStatus = "streaming";
  }

  async push(frame: RgbaFrame): Promise<void> {
    if (this.currentStatus !== "streaming" || !this.config) {
      throw new Error("MockVirtualCameraSink: start() must be called before push()");
    }
    const invalid = validateFrame(frame, this.config);
    if (invalid) {
      this.currentStatus = "error";
      throw new Error("MockVirtualCameraSink: " + invalid);
    }
    this.frames.push(frame);
  }

  async stop(): Promise<void> {
    this.currentStatus = "stopped";
    this.config = null;
  }
}

/**
 * Preview-only sink: no OS camera device is created. Frames are retained so the
 * UI can render "this is what the virtual camera would output".
 */
export class DeferredVirtualCameraSink implements VirtualCameraSink {
  readonly kind = "preview-only";
  readonly capabilities: VirtualCameraCapabilities;
  readonly deferredReason: string;
  private currentStatus: VirtualCameraStatus = "deferred";
  private previewFrames: RgbaFrame[] = [];
  private setup: VirtualCameraSetupGuide;

  constructor(platform: GazePlatform = "win32") {
    this.setup = virtualCameraSetupGuide(platform);
    this.capabilities = baseCapabilities(platform);
    this.deferredReason = this.setup.reason;
  }

  get status(): VirtualCameraStatus {
    return this.currentStatus;
  }

  get previewCount(): number {
    return this.previewFrames.length;
  }

  get setupGuide(): VirtualCameraSetupGuide {
    return this.setup;
  }

  async start(_config: VirtualCameraConfig): Promise<void> {
    // Deliberately succeeds: the app keeps running and shows preview-only mode.
    this.currentStatus = "deferred";
  }

  async push(frame: RgbaFrame): Promise<void> {
    if (this.currentStatus !== "deferred" && this.currentStatus !== "streaming") return;
    this.previewFrames.push(frame);
    if (this.previewFrames.length > 8) this.previewFrames.shift();
  }

  async stop(): Promise<void> {
    this.currentStatus = "stopped";
  }
}

function deferredAdapter(kind: string, reason: string, platform: GazePlatform): VirtualCameraSink {
  const capabilities = baseCapabilities(platform);
  return {
    kind,
    status: "deferred",
    capabilities,
    deferredReason: reason,
    async start(): Promise<void> {
      throw new Error(reason);
    },
    async push(): Promise<void> {
      throw new Error(reason);
    },
    async stop(): Promise<void> {
      // Nothing was started.
    },
  };
}

export function createDirectShowVirtualCameraSink(): VirtualCameraSink {
  return deferredAdapter("directshow-deferred", DIRECTSHOW_DEFERRED_REASON, "win32");
}

export function createCmioDalVirtualCameraSink(): VirtualCameraSink {
  return deferredAdapter("cmio-dal-deferred", CMIODAL_DEFERRED_REASON, "darwin");
}

export function createV4l2LoopbackVirtualCameraSink(): VirtualCameraSink {
  return deferredAdapter("v4l2loopback-deferred", V4L2_DEFERRED_REASON, "linux");
}

export type VirtualCameraSinkMode = "mock" | "preview-only" | "directshow" | "cmio-dal" | "v4l2loopback";

export function createVirtualCameraSink(options: {
  readonly mode: VirtualCameraSinkMode;
  readonly platform?: GazePlatform;
}): VirtualCameraSink {
  const platform = options.platform ?? "unknown";
  switch (options.mode) {
    case "mock":
      return new MockVirtualCameraSink(platform);
    case "preview-only":
      return new DeferredVirtualCameraSink(platform);
    case "directshow":
      return createDirectShowVirtualCameraSink();
    case "cmio-dal":
      return createCmioDalVirtualCameraSink();
    case "v4l2loopback":
      return createV4l2LoopbackVirtualCameraSink();
    default:
      return new DeferredVirtualCameraSink(platform);
  }
}

/** Best sink for the current environment without any driver work. */
export function createDefaultVirtualCameraSink(platformInput?: string): VirtualCameraSink {
  const platform = currentGazePlatform(platformInput);
  if (platform === "win32") return new DeferredVirtualCameraSink(platform);
  return new DeferredVirtualCameraSink(platform);
}
