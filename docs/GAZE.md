# Gaze correction MVP (W4)

Status: local MVP, no commits. Branch feat-4. Feature is **brand new**, not a
ParakeetAI parity item (target check below). Windows host only for runtime
measurements; no camera/model/virtual-camera driver is required for the MVP.

## 1. Target check (is this parity?)

Evidence: **docs/raw/desktop/gaze-scan.json** (scan script
docs/raw/desktop/gaze-scan.mjs) over the shipped desktop build:

- main.js, preload.js: **0 matches** for gaze/eye/iris/pupil/eyetrack,
  virtual camera (dshow/coremediaio/v4l2loopback), and face-landmark
  (mediapipe/onnx/dlib) terms.
- renderer.js: only generic camera/getUserMedia matches (those are the existing
  **audio** capture paths), **0** gaze/iris/virtual-camera matches.
- native addons: only benign audio/frame strings (num_frames, block_framer,
  resample); **0** gaze/eye/iris/face-landmark/virtual-camera symbols.

Conclusion: W4 is a new capability, not parity. The shipped build has no gaze
correction and no virtual camera.

## 2. What was built

All code is in **artifacts/craft-vita/src/gaze** (pure TypeScript, no DOM/Node
imports) with a standalone preview in **scripts/gaze**.

Pipeline:

    FrameSource (synthetic | camera adapter interface)
      -> fixed output normalization (1280x720 @ 30 fps)
      -> FaceLandmarkDetector (deterministic mock | ONNX stub)
      -> WarpGazeWarper (eye ROI warp + smoothstep feather + EMA smoothing)
      -> output RgbaFrame -> VirtualCameraSink (mock | preview-only | deferred driver stubs)
                               \-> preview canvases / demo metrics

Interfaces (types.ts):

- **FrameSource**: start/read/stop + state (idle/starting/streaming/reconnecting/
  error) + onStateChange. Contract: read() never throws; missing camera,
  camera-in-use and hot-unplug return null with a state transition.
- **FaceLandmarkDetector**: name/status/detect/dispose. Mock is deterministic;
  ONNX adapter is an explicit unavailable stub with the documented tensor
  contract (see detector.ts).
- **GazeWarper**: warp(frame, landmarks, strength) -> {frame, correction,
  applied}. Must never mutate the input frame.
- **VirtualCameraSink**: start/push/stop + status + capabilities +
  deferredReason. Mock records frames; preview-only is clearly labelled
  deferred; DirectShow/CMIO/v4l2 adapters fail closed with exact setup reasons.

Controls and demo integration:

- Strength slider 0..100%, on/off, streaming auto-boost, before/after preview:
  scripts/gaze/preview (built + served by scripts/gaze/preview.mjs).
- Auto-boost: resolveEffectiveStrength(base, streaming) raises strength by
  1.35x while tokens stream, clamped to 1.0. The processor exposes
  setStreaming(bool); session code calls it around token streaming.
- Demo flag: **DEMO_GAZE=1** (also GAZE_DEMO=1) enables
  createDemoGazeProcessor(env) / runDemoGazeStage({env}) in
  **src/gaze/demoGaze.ts**. It is off by default, so existing demo output is
  unchanged. The Lead can wire it into src/demo/pipeline.ts with:

      import { isGazeDemoEnabled, runDemoGazeStage } from "@/gaze/demoGaze";
      if (isGazeDemoEnabled(process.env)) {
        const gaze = runDemoGazeStage();
        emit({ type: "gaze.summary", atMs: 0, mediaMs: 0, stream: null, data: gaze });
      }

  (The demo pipeline file is outside this task's write scope, so make demo
  wiring is left to the Lead as requested.)

## 3. Warp algorithm and smoothing

Per eye (200..300 px wide ROI at 720p):

1. offset = iris - eye center (detector output).
2. desired correction = -offset * effective strength, clamped to 0.35 x eye
   width so extreme detections cannot tear the face.
3. EMA smoothing of the correction across frames: first frame bootstraps
   directly to the measurement (no warm-up ramp), then
   c = c + alpha * (measured - c) with alpha = 0.35. This removes detector
   jitter at one-frame latency.
4. Inverse-mapped bilinear warp inside an ellipse of 0.58 x eye width and
   0.85 x eye height. Blend weight is 1 inside 65% of the radius and a
   smoothstep feather to 0 at the ROI edge; RGB channels are blended, alpha is
   copied (frames are opaque). Pixels outside the two ROIs are byte-identical.
5. Output is copied into a new buffer; the input frame is never mutated.

The hot loop is allocation-free per pixel (no bilinear array allocation, no
cos, no hypot) and only touches two small ROIs; that is what keeps 720p30 under
budget.

## 4. Measured results (synthetic, honest environment numbers)

Source: **docs/evidence/gaze/gaze-evidence.json** and latency.json, produced by
**node scripts/gaze/collect-evidence.cjs** (same code the app imports,
compiled to CJS with the workspace TypeScript). Host: Intel i5-8265U, Node
v24.19.0, win32 x64, 1280x720.

- Displacement reduction toward the eye axis at strength 0.85: **81.3% (left)
  / 81.6% (right)** measured from pixel centroids (target >= 70%). Before
  12.01 px -> after 2.22 px left; 12.00 -> 2.19 px right.
- Jitter: synthetic detector noise amplitude 2 px; raw offset stddev 1.114 px
  -> EMA-smoothed correction stddev **0.366 px** (target < 1 px).
- Extra latency at 720p30 (60 timed frames, 8 warmup): **p50 3.54 ms, p95
  6.30 ms, max 10.45 ms, mean 4.14 ms** (budget 25 ms; 18.7 ms headroom at
  p95). This is the pure processing pipeline in Node, not a claim about a
  browser/Electron renderer frame; the Electron preview measured 1.9 ms for the
  same synthetic frame in its steady state (preview.png stats).
- Pass-through: disabled processor and unavailable ONNX detector return the
  exact input frame object with **byte-identical RGBA** (verified with Buffer
  equality, and the vitest suite asserts identity + bytes).
- Fixed output: 1280x720 @ 30 fps; timestamps quantized to the fps grid.
- Streaming boost: 0.85 idle -> 1.0 streaming; 0.9 -> 1.0 (clamped).

Tests: **10 files / 57 tests**, deterministic, no network/hardware
(artifacts/craft-vita/src/gaze/*.test.ts).

## 5. Robustness

| Scenario | Behavior |
|---|---|
| Correction off | pass-through: same frame object, identical bytes, reason "disabled" |
| Detector unavailable (ONNX stub) | pass-through, reason "detector-unavailable" |
| Detector throws / returns null / low confidence | pass-through with reason; error captured in lastProcessingError |
| Warper throws | pass-through, original bytes untouched |
| Invalid frame (bad dimensions/buffer) | pass-through, never resizes or throws |
| Camera missing (NotFoundError) | ResilientFrameSource: state error, read() returns null |
| Camera in use (NotReadableError) | state reconnecting, read() returns null, resumes automatically |
| Hot-unplug (AbortError/step) | frame -> null -> frame; reconnecting -> streaming; no mangled frames |
| Wrong-size frame pushed to sink | sink rejects and reports error instead of recording |

The processor contract is explicit: **every failure path returns the ORIGINAL
frame object**. A partially warped frame cannot reach the sink.

## 6. Virtual camera: platform matrix and deferred work

Shipped in this MVP: mock sink (tests/demo) and **preview-only** sink that
reports status "deferred" with the exact setup reason; no fake success.

| Platform | Technology | State in this build | Required setup |
|---|---|---|---|
| Windows | DirectShow COM filter DLL | **DEFERRED**: no DLL in repo, no elevated COM registration | MSVC x64 build (DirectShow BaseClasses) -> regsvr32 DLL from an Administrator prompt (HKLM/HKCU CLSID + CLSID_VideoInputDeviceCategory) or signed installer -> restart Zoom/Teams/Meet -> Authenticode-sign for distribution |
| macOS | CoreMediaIO DAL plugin | **DEFERRED** (no macOS host) | Xcode bundle signed with Developer ID -> /Library/CoreMediaIO/Plug-Ins/DAL -> restart coreaudiod |
| Linux | v4l2loopback | **DEFERRED** (no Linux host) | modprobe v4l2loopback video_nr=10 exclusive_caps=1 -> write YUV420 to /dev/video10 -> udev/video group permission |

Why Windows DirectShow is not shipped here: it needs an MSVC-built native COM
filter plus an elevated registration step. This environment has no DirectShow
project/DLL, and COM registration cannot be performed from the agent session;
shipping a fake sink would break Zoom/Meet silently. The exact reason string is
**DIRECTSHOW_DEFERRED_REASON** in virtualCamera.ts and the setup guide is
returned by virtualCameraSetupGuide("win32").

## 7. Preview

    node scripts/gaze/preview.mjs            # builds and serves http://127.0.0.1:8765
    node scripts/gaze/preview.mjs --no-serve # build only (CI)

The page renders the real modules: synthetic face on the left, warped output on
the right, strength slider, on/off and streaming-boost toggles, live stats
(iris displacement reduction, effective strength, frame size/fps, processing
time). Evidence screenshot: **docs/evidence/gaze/preview.png** (captured with
scripts/gaze/capture-preview.cjs using Electron offscreen rendering; stats show
14.15 px -> 2.39 px, 83.1% reduction, 1.9 ms).

## 8. Repro

    pnpm --dir artifacts/craft-vita exec vitest run src/gaze
    node scripts/gaze/collect-evidence.cjs
    node scripts/gaze/preview.mjs --no-serve
    # screenshot (ELECTRON_RUN_AS_NODE must be unset):
    electron scripts/gaze/capture-preview.cjs

## 9. Limitations / deferred list

1. Real face detector + model are not included: ONNX adapter is a documented
   stub (no model, no onnxruntime dependency, no face detector/crop step).
   Until then, real camera input would pass through unchanged.
2. Virtual camera drivers are deferred per the table above; only mock/preview
   sinks ship.
3. Browser/Electron camera adapter (getUserMedia -> VideoFrame -> RgbaFrame) is
   an interface only; the preview/demo/tests use synthetic frames.
4. Latency measured on the pure TS pipeline (Node) + Electron preview steady
   state; no claim for 4K, GPU, or other CPUs.
5. Synthetic faces only: no real-person validation of visual quality, no
   per-user calibration, no eye-contact preservation beyond 2D re-centering.
6. The demo flag hook is ready but make demo/run-demo wiring is the Lead's step
   (src/demo is outside this task's write scope).
