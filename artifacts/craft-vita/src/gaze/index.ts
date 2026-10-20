/**
 * Gaze correction barrel (W4).
 *
 * Import from "@/gaze" in app/preview code and from "../../gaze" in scripts.
 * The MVP is pure TypeScript: no camera, model or virtual-camera driver is
 * required for tests, the demo hook or the preview.
 */
export type {
  EyeLandmarks,
  FaceLandmarkDetector,
  FaceLandmarkDetectorStatus,
  FaceLandmarks,
  FrameSource,
  FrameSourceState,
  GazeFrameMetrics,
  GazeWarper,
  Point,
  RgbaFrame,
  VirtualCameraCapabilities,
  VirtualCameraConfig,
  VirtualCameraSink,
  VirtualCameraStatus,
  WarpCorrection,
  WarpResult,
} from "./types";

export {
  DeterministicMockFaceLandmarkDetector,
  JitteringMockFaceLandmarkDetector,
  OnnxFaceLandmarkDetector,
  createFaceLandmarkDetector,
} from "./detector";
export type {
  JitterMockOptions,
  MockFaceLandmarkDetectorOptions,
  OnnxFaceLandmarkDetectorOptions,
} from "./detector";

export {
  DEFAULT_EMA_ALPHA,
  EmaFilter,
  alphaForTimeConstant,
  clampAlpha,
  standardDeviation,
} from "./smoothing";

export { WarpGazeWarper, desiredIrisCorrection, featherWeight } from "./warp";
export type { WarpGazeWarperOptions } from "./warp";

export {
  DEFAULT_OUTPUT_HEIGHT,
  DEFAULT_OUTPUT_WIDTH,
  DEFAULT_FPS,
  DEFAULT_STREAMING_BOOST,
  GazeCorrectionProcessor,
  frameIntervalMs,
  quantizeTimestamp,
  resizeFrame,
  resolveEffectiveStrength,
} from "./processor";
export type { GazeProcessResult, GazeProcessorConfig } from "./processor";

export {
  ResilientFrameSource,
  ScriptedFrameSource,
  SyntheticFrameSource,
  cameraFailureFromError,
  describeCameraFailure,
} from "./frameSource";
export type { CameraFailure, ScriptedFrameSourceOptions, ScriptedFrameSourceStep } from "./frameSource";

export {
  CMIODAL_DEFERRED_REASON,
  DIRECTSHOW_DEFERRED_REASON,
  DeferredVirtualCameraSink,
  MockVirtualCameraSink,
  V4L2_DEFERRED_REASON,
  createCmioDalVirtualCameraSink,
  createDefaultVirtualCameraSink,
  createDirectShowVirtualCameraSink,
  createV4l2LoopbackVirtualCameraSink,
  createVirtualCameraSink,
  currentGazePlatform,
  virtualCameraSetupGuide,
} from "./virtualCamera";
export type { GazePlatform, VirtualCameraSetupGuide, VirtualCameraSinkMode } from "./virtualCamera";

export {
  DEFAULT_PREVIEW_STATE,
  clampStrength,
  createPreviewState,
  describePreview,
  previewEffectiveStrength,
  setPreviewStreaming,
  setPreviewStrength,
  togglePreviewEnabled,
} from "./previewState";
export type { GazePreviewState } from "./previewState";

export {
  DEMO_GAZE_HEIGHT,
  DEMO_GAZE_OFFSETS,
  DEMO_GAZE_WIDTH,
  GAZE_DEMO_FLAGS,
  createDemoGazeProcessor,
  demoGazeFrames,
  isGazeDemoEnabled,
  runDemoGazeStage,
} from "./demoGaze";
export type { DemoGazeSummary } from "./demoGaze";

export { distance, generateSyntheticFace, measureIrisCenter, syntheticEyeGeometry } from "./syntheticFace";
export type { EyeGeometry, SyntheticFace, SyntheticFaceGeometry, SyntheticFaceOptions } from "./syntheticFace";
