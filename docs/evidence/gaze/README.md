# W4 gaze correction evidence

Branch feat-4, no commits. Existing GAP_MATRIX/DECISIONS/TEST_REPORT untouched.

## Files

- gaze-evidence.json — synthetic displacement reduction, EMA jitter, 720p30
  latency, pass-through identity, streaming boost, target-check summary.
- latency.json — latency subset with environment details.
- preview.png — Electron-rendered screenshot of the standalone preview
  (1304x721, 271537 bytes); stats show 14.15 px -> 2.39 px (83.1% reduction)
  and 1.9 ms steady-state processing for the synthetic 640x360 frame.
- preview-dist/ — built preview bundle (index.html + assets).
- build/ — CommonJS build of the pure modules used by collect-evidence.cjs
  (regenerated artifact).

## Exact commands and results

1. Unit tests (deterministic, no hardware/network):

       cd artifacts/craft-vita
       pnpm exec vitest run src/gaze
       -> 10 files / 57 tests passed, EXITCODE=0
       pnpm exec vitest run
       -> 44 files / 479 tests passed, EXITCODE=0 (gaze + existing suite)
       pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 \
         --module ESNext --moduleResolution Bundler src/gaze/types.ts ... src/gaze/index.ts
       -> EXITCODE=0 (typecheck-gaze-scope.log; all 11 gaze modules)

   IMPORTANT: the full-project tsc run (typecheck.log) turned RED only because
   another teammate's in-flight src/features/pronunciation/* files were being
   written concurrently in this shared worktree (makeWordToken / readonly
   VocabularyEntry errors). No error references src/gaze/**. Re-run the full
   project typecheck after the concurrent edits land.

   Note: the in-suite latency test asserts best-of-3 batches because it runs
   inside a parallel 479-test suite on a shared machine (observed contention
   outliers). Authoritative isolated numbers are in latency.json from the
   collector (p95 6.3 ms).

2. Honest measurements:

       node scripts/gaze/collect-evidence.cjs
       -> overall_pass: true
          displacement reduction: 0.8129 (left) / 0.8156 (right), target >= 0.70
          jitter: raw stddev 1.1139 px -> smoothed 0.3657 px, target < 1 px
          latency 720p30: p50 3.538 ms, p95 6.301 ms, max 10.445 ms
          pass-through bytes identical: disabled=true, detector-unavailable=true
          streaming boost: 0.85 -> 1.0 (clamped)
       Environment: Intel i5-8265U, win32 x64, Node v24.19.0.

3. Preview build + HTTP smoke test:

       node scripts/gaze/preview.mjs --no-serve
       -> vite v7.3.3, 14 modules transformed, built in ~0.4 s
          docs/evidence/gaze/preview-dist/index.html + assets/index-*.js
       node scripts/gaze/preview.mjs   (serves http://127.0.0.1:8765)
       Invoke-WebRequest / -> 200 (3028 bytes); assets/index-*.js -> 200 (13033 bytes)

4. Preview screenshot:

       Remove-Item Env:ELECTRON_RUN_AS_NODE
       electron scripts/gaze/capture-preview.cjs
       -> wrote docs/evidence/gaze/preview.png (271537 bytes)
          stats: On / strength 85% / applied:true / 14.15 px -> 2.39 px
          (reduction 83.1%) / 640x360 @30fps / processing 1.90 ms

## Target check

docs/raw/desktop/gaze-scan.json (produced by docs/raw/desktop/gaze-scan.mjs)
scans shipped main.js, preload.js, renderer.js and the extracted native addons
for gaze/eye/iris/eyetrack, virtual camera (dshow/directshow/coremediaio/CMIO/
v4l2loopback) and face-landmark (mediapipe/onnx/dlib) patterns:

- main.js / preload.js: no matches.
- renderer.js: only generic camera/getUserMedia matches (existing AUDIO capture),
  no gaze/iris/virtual-camera matches.
- native addons: only benign audio "frame"/resampler strings, no gaze/eye/iris/
  face-landmark/virtual-camera symbols.

Therefore W4 is a brand-new local MVP, not parity work.

## Platform matrix / deferrals

- Windows DirectShow virtual camera: DEFERRED. Requires MSVC-built COM filter
  DLL + elevated regsvr32 registration (or signed installer). No DLL/project in
  this repo and COM registration cannot be performed from this environment.
  Exact reason: DIRECTSHOW_DEFERRED_REASON in src/gaze/virtualCamera.ts.
- macOS CMIO DAL: DEFERRED (needs Developer ID-signed bundle in
  /Library/CoreMediaIO/Plug-Ins/DAL); no macOS host.
- Linux v4l2loopback: DEFERRED (modprobe v4l2loopback + YUV writing); no Linux
  host.
- Shipped: MockVirtualCameraSink (records frames) and DeferredVirtualCameraSink
  (preview-only, clearly labelled, never pretends to create a device).

## Limitations

Synthetic faces only; ONNX detector is an unavailable stub (no model/runtime);
no real camera adapter wired yet; latency measured on the pure TS pipeline and
the Electron preview, not a full OS virtual-camera loop.
