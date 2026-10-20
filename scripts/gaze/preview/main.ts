/**
 * Standalone gaze-correction preview (W4).
 *
 * Uses the real gaze modules (synthetic face -> mock detector -> warp -> EMA)
 * so the before/after canvases show exactly what the pipeline produces. Slider,
 * on/off and streaming boost mirror the future settings UI.
 */
import {
  DeterministicMockFaceLandmarkDetector,
  GazeCorrectionProcessor,
  createPreviewState,
  describePreview,
  distance,
  generateSyntheticFace,
  measureIrisCenter,
  setPreviewStreaming,
  setPreviewStrength,
  togglePreviewEnabled,
  type GazePreviewState,
  type RgbaFrame,
} from "../../../artifacts/craft-vita/src/gaze/index";

const WIDTH = 640;
const HEIGHT = 360;

const beforeCanvas = document.getElementById("before") as HTMLCanvasElement;
const afterCanvas = document.getElementById("after") as HTMLCanvasElement;
const strengthInput = document.getElementById("strength") as HTMLInputElement;
const strengthValue = document.getElementById("strengthValue")!;
const enabledInput = document.getElementById("enabled") as HTMLInputElement;
const streamingInput = document.getElementById("streaming") as HTMLInputElement;
const moveInput = document.getElementById("move") as HTMLInputElement;
const stats = document.getElementById("stats")!;

let state: GazePreviewState = createPreviewState({ strength: 0.85 });
const processor = new GazeCorrectionProcessor({
  enabled: true,
  strength: state.strength,
  detector: new DeterministicMockFaceLandmarkDetector({ width: WIDTH, height: HEIGHT }),
  outputWidth: WIDTH,
  outputHeight: HEIGHT,
  fps: 30,
});

function paint(canvas: HTMLCanvasElement, frame: RgbaFrame): void {
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = context.createImageData(frame.width, frame.height);
  image.data.set(frame.data);
  context.putImageData(image, 0, 0);
}

function render(): void {
  const offset = moveInput.checked ? { x: 14, y: 2 } : { x: 0, y: 0 };
  const face = generateSyntheticFace({ width: WIDTH, height: HEIGHT, leftOffset: offset, seed: 7 });
  // The mock detector must report the same off-axis position that was rendered.
  processor.setDetector(
    new DeterministicMockFaceLandmarkDetector({
      width: WIDTH,
      height: HEIGHT,
      offsets: [{ x: offset.x, y: offset.y }],
      fallbackOffset: { x: offset.x, y: offset.y },
    }),
  );
  processor.reset();
  processor.setEnabled(state.enabled);
  processor.setStrength(state.strength);
  processor.setStreaming(state.streaming);
  // Warm the hot loop so the displayed duration is steady-state, not JIT.
  processor.process(face.frame);
  const result = processor.process(face.frame);
  paint(beforeCanvas, face.frame);
  paint(afterCanvas, result.frame);

  const before = measureIrisCenter(face.frame, face.geometry.left);
  const after = measureIrisCenter(result.frame, face.geometry.left);
  const beforeOffset = before ? distance(before, face.geometry.left.center) : 0;
  const afterOffset = after ? distance(after, face.geometry.left.center) : 0;
  const reduction = beforeOffset > 0 ? (1 - afterOffset / beforeOffset) * 100 : 0;

  strengthValue.textContent = Math.round(state.strength * 100) + "%";
  stats.textContent = [
    describePreview(state),
    "applied: " + result.metrics.applied + " (reason: " + (result.metrics.passthroughReason ?? "none") + ")",
    "effective strength: " + Math.round(result.metrics.effectiveStrength * 100) + "%",
    "iris displacement: " + beforeOffset.toFixed(2) + "px -> " + afterOffset.toFixed(2) + "px (reduction " + reduction.toFixed(1) + "%)",
    "frame: " + result.frame.width + "x" + result.frame.height + " @ " + processor.fps + "fps · processing " + result.metrics.durationMs.toFixed(2) + "ms",
  ].join("\n");
}

strengthInput.addEventListener("input", () => {
  state = setPreviewStrength(state, Number(strengthInput.value) / 100);
  render();
});
enabledInput.addEventListener("change", () => {
  state = togglePreviewEnabled(state);
  render();
});
streamingInput.addEventListener("change", () => {
  state = setPreviewStreaming(state, streamingInput.checked);
  render();
});
moveInput.addEventListener("change", render);

render();
