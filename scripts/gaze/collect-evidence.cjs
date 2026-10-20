"use strict";

/**
 * Collect honest W4 gaze evidence (synthetic displacement reduction, EMA
 * jitter, 720p30 extra latency, pass-through identity).
 *
 * The gaze modules are pure TypeScript; this script compiles them to CommonJS
 * with the workspace TypeScript compiler (no network, no bundler), then measures
 * the exact same code the app imports.
 *
 * Usage: node scripts/gaze/collect-evidence.cjs [--out docs/evidence/gaze]
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const gazeSrc = path.join(repoRoot, "artifacts", "craft-vita", "src", "gaze");
const outArgIndex = process.argv.indexOf("--out");
const outDir = outArgIndex >= 0 ? path.resolve(process.argv[outArgIndex + 1]) : path.join(repoRoot, "docs", "evidence", "gaze");
const buildDir = path.join(outDir, "build");

function requireTypeScript() {
  try {
    return require(require.resolve("typescript", { paths: [repoRoot] }));
  } catch (error) {
    throw new Error("typescript is required (run pnpm install at the repo root): " + error.message);
  }
}

function compile() {
  const ts = requireTypeScript();
  const sources = fs
    .readdirSync(gazeSrc)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(gazeSrc, name));
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const program = ts.createProgram(sources, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    outDir: buildDir,
    rootDir: gazeSrc,
    esModuleInterop: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    const messages = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    throw new Error("gaze modules failed to compile:\n" + messages.join("\n"));
  }
  const emit = program.emit();
  if (emit.emitSkipped) throw new Error("TypeScript emit was skipped");
  return fs.readdirSync(buildDir).filter((name) => name.endsWith(".js"));
}

function loadBuild() {
  const modules = path.join(buildDir, "index.js");
  return require(modules);
}

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

let gaze = null;

function measureReduction() {
  const width = 640;
  const height = 360;
  const offset = { x: 12, y: 3 };
  const face = gaze.generateSyntheticFace({ width, height, leftOffset: offset, seed: 17 });
  const warper = new gaze.WarpGazeWarper();
  const result = warper.warp(face.frame, face.landmarks, 0.85);
  const eyes = [
    { name: "left", geometry: face.geometry.left, landmarks: face.landmarks.leftEye },
    { name: "right", geometry: face.geometry.right, landmarks: face.landmarks.rightEye },
  ];
  const measurements = eyes.map((eye) => {
    const before = gaze.measureIrisCenter(face.frame, eye.geometry);
    const after = gaze.measureIrisCenter(result.frame, eye.geometry);
    const beforeDistance = gaze.distance(before, eye.landmarks.center);
    const afterDistance = gaze.distance(after, eye.landmarks.center);
    return {
      eye: eye.name,
      requested_offset_px: { x: round(eye.landmarks.iris.x - eye.landmarks.center.x, 2), y: round(eye.landmarks.iris.y - eye.landmarks.center.y, 2) },
      measured_before_offset_px: { x: round(before.x - eye.landmarks.center.x, 3), y: round(before.y - eye.landmarks.center.y, 3) },
      measured_after_offset_px: { x: round(after.x - eye.landmarks.center.x, 3), y: round(after.y - eye.landmarks.center.y, 3) },
      displacement_before_px: round(beforeDistance, 3),
      displacement_after_px: round(afterDistance, 3),
      reduction: round(1 - afterDistance / beforeDistance, 4),
    };
  });
  return {
    frame: { width, height },
    strength: 0.85,
    correction_px: { left: { x: round(result.correction.left.x, 3), y: round(result.correction.left.y, 3) }, right: { x: round(result.correction.right.x, 3), y: round(result.correction.right.y, 3) } },
    measurements,
    min_reduction: Math.min(...measurements.map((measurement) => measurement.reduction)),
    target: ">= 0.70 displacement reduction toward the eye axis",
    pass: measurements.every((measurement) => measurement.reduction >= 0.7),
  };
}

function measureJitter() {
  const width = 640;
  const height = 360;
  const face = gaze.generateSyntheticFace({ width, height, leftOffset: { x: 0, y: 0 }, seed: 23 });
  const detector = new gaze.JitteringMockFaceLandmarkDetector({
    width,
    height,
    fallbackOffset: { x: 10, y: 0 },
    jitterAmplitude: 2,
    jitterSeed: 3,
  });
  const warper = new gaze.WarpGazeWarper({ emaAlpha: 0.35 });
  const raw = [];
  const smoothed = [];
  for (let index = 0; index < 90; index += 1) {
    const landmarks = detector.detect(face.frame);
    raw.push(landmarks.leftEye.iris.x - landmarks.leftEye.center.x);
    const result = warper.warp(face.frame, landmarks, 0.85);
    smoothed.push(result.correction.left.x);
  }
  const rawStd = gaze.standardDeviation(raw.slice(1));
  const smoothedStd = gaze.standardDeviation(smoothed.slice(1));
  return {
    frames: raw.length,
    ema_alpha: 0.35,
    synthetic_jitter_amplitude_px: 2,
    raw_offset_stddev_px: round(rawStd, 4),
    smoothed_correction_stddev_px: round(smoothedStd, 4),
    target: "smoothed jitter < 1 px stddev",
    pass: smoothedStd < 1,
  };
}

function measureLatency() {
  const width = 1280;
  const height = 720;
  const frame = gaze.generateSyntheticFace({ width, height, leftOffset: { x: 14, y: 3 }, seed: 29 }).frame;
  const detector = new gaze.DeterministicMockFaceLandmarkDetector({
    width,
    height,
    offsets: Array.from({ length: 200 }, (_, index) => ({ x: 14 - (index % 6) * 0.2, y: 3 })),
    fallbackOffset: { x: 12, y: 3 },
  });
  const processor = new gaze.GazeCorrectionProcessor({
    enabled: true,
    strength: 0.85,
    detector,
    outputWidth: width,
    outputHeight: height,
    fps: 30,
  });
  for (let warmup = 0; warmup < 8; warmup += 1) processor.process(frame);
  const durations = [];
  for (let index = 0; index < 60; index += 1) {
    const result = processor.process(frame);
    if (!result.metrics.applied) throw new Error("latency run unexpectedly passed through: " + result.metrics.passthroughReason);
    durations.push(result.metrics.durationMs);
  }
  durations.sort((a, b) => a - b);
  const mean = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const p50 = percentile(durations, 0.5);
  const p95 = percentile(durations, 0.95);
  const max = durations[durations.length - 1];
  return {
    resolution: { width, height },
    fps: 30,
    iterations: durations.length,
    warmup_frames: 8,
    percentiles: { p50_ms: round(p50, 3), p95_ms: round(p95, 3), max_ms: round(max, 3), mean_ms: round(mean, 3), min_ms: round(durations[0], 3) },
    budget_ms: 25,
    headroom_at_p95_ms: round(25 - p95, 3),
    target: "p95 extra processing time < 25 ms/frame at 720p30",
    pass: p95 < 25,
  };
}

function measurePassThrough() {
  const width = 640;
  const height = 360;
  const frame = gaze.generateSyntheticFace({ width, height, leftOffset: { x: 10, y: 2 }, seed: 31 }).frame;
  const original = Buffer.from(frame.data);
  const disabled = new gaze.GazeCorrectionProcessor({
    enabled: false,
    detector: new gaze.DeterministicMockFaceLandmarkDetector({ width, height }),
  });
  const disabledResult = disabled.process(frame);
  const unavailable = new gaze.GazeCorrectionProcessor({ detector: new gaze.OnnxFaceLandmarkDetector() });
  const unavailableResult = unavailable.process(frame);
  const identical = (result) => result.frame === frame && Buffer.from(result.frame.data).equals(original);
  return {
    disabled: { identical_bytes: identical(disabledResult), reason: disabledResult.metrics.passthroughReason },
    detector_unavailable: { identical_bytes: identical(unavailableResult), reason: unavailableResult.metrics.passthroughReason },
    target: "output bytes identical on disabled/failing detector",
    pass: identical(disabledResult) && identical(unavailableResult),
  };
}

function measureBoost() {
  const idle = gaze.resolveEffectiveStrength(0.85, false);
  const streaming = gaze.resolveEffectiveStrength(0.85, true);
  return {
    idle: round(idle, 4),
    streaming: round(streaming, 4),
    clamped: round(gaze.resolveEffectiveStrength(0.9, true), 4),
    target: "streaming boost raises strength and clamps at 1.0",
    pass: streaming > idle && streaming <= 1 && gaze.resolveEffectiveStrength(0.9, true) === 1,
  };
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const emitted = compile();
  gaze = loadBuild();
  const reduction = measureReduction();
  const jitter = measureJitter();
  const latency = measureLatency();
  const passthrough = measurePassThrough();
  const boost = measureBoost();
  const results = {
    generated_at: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform + " " + process.arch,
      cpu: os.cpus()[0] ? os.cpus()[0].model : "unknown",
      resolution: "1280x720",
      compiled_modules: emitted,
    },
    target_check: {
      source: "docs/raw/desktop/gaze-scan.json (Lead scan of the shipped ParakeetAI build)",
      result: "0 gaze/eye/iris/virtual-camera matches in main/renderer/preload and all four native addons; brand-new feature, not parity.",
    },
    synthetic_displacement_reduction: reduction,
    smoothing_jitter: jitter,
    latency_720p30: latency,
    pass_through: passthrough,
    streaming_boost: boost,
    overall_pass: reduction.pass && jitter.pass && latency.pass && passthrough.pass && boost.pass,
  };
  fs.writeFileSync(path.join(outDir, "gaze-evidence.json"), JSON.stringify(results, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outDir, "latency.json"), JSON.stringify({
    generated_at: results.generated_at,
    environment: results.environment,
    latency: latency,
  }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(results, null, 2));
  if (!results.overall_pass) {
    console.error("[gaze-evidence] FAILED one or more targets");
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error("[gaze-evidence] " + (error && error.message ? error.message : error));
  process.exitCode = 1;
}
