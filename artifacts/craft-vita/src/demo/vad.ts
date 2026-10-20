/**
 * Energy-based VAD + endpointing over 16 kHz mono PCM (G-014).
 *
 * Contract:
 *   - frames are 10 ms (160 samples at 16 kHz);
 *   - a frame is active when its normalised RMS exceeds the threshold;
 *   - runs shorter than minSpeechMs are discarded as clicks/noise;
 *   - an utterance continues across gaps shorter than endSilenceMs and is split
 *     only when the silence gap reaches the endpoint threshold (default 700 ms);
 *   - segment boundaries are reported in exact samples so fixture WAVs can be
 *     asserted frame-exactly.
 */

export interface VadConfig {
  sampleRate: number;
  frameMs: number;
  /** Normalised RMS threshold in [0,1] (int16 is divided by 32768). */
  energyThreshold: number;
  minSpeechMs: number;
  /** Silence that closes an utterance (endpoint), e.g. 700 ms. */
  endSilenceMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: 16_000,
  frameMs: 10,
  energyThreshold: 0.01,
  minSpeechMs: 120,
  endSilenceMs: 700,
};

export interface VadFrame {
  index: number;
  startSample: number;
  endSample: number;
  rms: number;
  active: boolean;
}

export interface SpeechSegment {
  index: number;
  startSample: number;
  endSample: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface EndpointEvent {
  segmentIndex: number;
  /** Last sample that belongs to speech. */
  silenceStartSample: number;
  /** Sample at which the endpoint is declared (speech end + silence window). */
  endpointSample: number;
  endpointMs: number;
  trailingSilenceMs: number;
  closedBy: "silence" | "end_of_audio";
}

export interface VadResult {
  config: VadConfig;
  frames: VadFrame[];
  segments: SpeechSegment[];
  endpoints: EndpointEvent[];
  durationMs: number;
}

export function frameRms(samples: Int16Array, start: number, end: number): number {
  const count = Math.max(0, end - start);
  if (count === 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i]! / 32_768;
    sum += v * v;
  }
  return Math.sqrt(sum / count);
}

export function detectSpeechSegments(
  samples: Int16Array,
  overrides: Partial<VadConfig> = {},
): VadResult {
  const config: VadConfig = { ...DEFAULT_VAD_CONFIG, ...overrides };
  if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
    throw new Error(`vad: invalid sampleRate ${String(config.sampleRate)}`);
  }
  const frameSamples = Math.max(1, Math.round((config.sampleRate * config.frameMs) / 1000));
  const minSpeechFrames = Math.max(1, Math.round(config.minSpeechMs / config.frameMs));
  const silenceSamples = Math.round((config.sampleRate * config.endSilenceMs) / 1000);
  const totalSamples = samples.length;
  const durationMs = (totalSamples / config.sampleRate) * 1000;

  const frames: VadFrame[] = [];
  for (let start = 0; start < totalSamples; start += frameSamples) {
    const end = Math.min(totalSamples, start + frameSamples);
    const rms = frameRms(samples, start, end);
    frames.push({
      index: frames.length,
      startSample: start,
      endSample: end,
      rms,
      active: rms >= config.energyThreshold,
    });
  }

  // Group active frames into runs of [startFrame, endFrame) first.
  interface Run {
    startFrame: number;
    endFrame: number;
  }
  const runs: Run[] = [];
  for (const frame of frames) {
    if (!frame.active) continue;
    const last = runs[runs.length - 1];
    if (last && last.endFrame === frame.index) last.endFrame = frame.index + 1;
    else runs.push({ startFrame: frame.index, endFrame: frame.index + 1 });
  }
  // Drop too-short runs (clicks, door slams, keyboard).
  const speechRuns = runs.filter((r) => r.endFrame - r.startFrame >= minSpeechFrames);

  // Endpointing: keep extending an utterance while the gap is < silence window.
  const segments: SpeechSegment[] = [];
  let current: { startFrame: number; endFrame: number } | null = null;
  for (const run of speechRuns) {
    if (!current) {
      current = { ...run };
      continue;
    }
    const gapSamples = (run.startFrame - current.endFrame) * frameSamples;
    if (gapSamples >= silenceSamples) {
      segments.push(makeSegment(current, segments.length, frameSamples, totalSamples, config));
      current = { ...run };
    } else {
      current.endFrame = run.endFrame;
    }
  }
  if (current) segments.push(makeSegment(current, segments.length, frameSamples, totalSamples, config));

  const endpoints: EndpointEvent[] = segments.map((segment, i) => {
    const next = segments[i + 1];
    const naturalEndpoint = segment.endSample + silenceSamples;
    const endpointSample = Math.min(
      totalSamples,
      next ? Math.min(naturalEndpoint, next.startSample) : naturalEndpoint,
    );
    return {
      segmentIndex: segment.index,
      silenceStartSample: segment.endSample,
      endpointSample,
      endpointMs: (endpointSample / config.sampleRate) * 1000,
      trailingSilenceMs: ((endpointSample - segment.endSample) / config.sampleRate) * 1000,
      // A normal 700 ms endpoint is "silence"; a segment clamped by the next
      // utterance or by end-of-audio means the silence window could not complete.
      closedBy: endpointSample < naturalEndpoint ? "end_of_audio" : "silence",
    };
  });

  return { config, frames, segments, endpoints, durationMs };
}

function makeSegment(
  run: { startFrame: number; endFrame: number },
  index: number,
  frameSamples: number,
  totalSamples: number,
  config: VadConfig,
): SpeechSegment {
  const startSample = run.startFrame * frameSamples;
  const endSample = Math.min(totalSamples, run.endFrame * frameSamples);
  return {
    index,
    startSample,
    endSample,
    startMs: (startSample / config.sampleRate) * 1000,
    endMs: (endSample / config.sampleRate) * 1000,
    durationMs: ((endSample - startSample) / config.sampleRate) * 1000,
  };
}
