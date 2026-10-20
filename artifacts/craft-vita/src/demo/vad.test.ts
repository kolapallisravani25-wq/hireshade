import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  GENERATOR_SCRIPT,
  allFixturesExist,
  getFixture,
  loadFixtureWavBytes,
} from "./fixtures.js";
import { parseWav } from "./wav.js";
import { DEFAULT_VAD_CONFIG, detectSpeechSegments, frameRms } from "./vad.js";

const FRAME_SAMPLES = 160; // 10 ms at 16 kHz
const SILENCE_SAMPLES = 11_200; // 700 ms endpoint

function ensureFixtures(): void {
  if (allFixturesExist()) return;
  const run = spawnSync(process.execPath, [GENERATOR_SCRIPT], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`fixture generation failed (status ${run.status}): ${run.stdout}\n${run.stderr}`);
  }
}

function loadFixture(id: string) {
  const def = getFixture(id);
  const audio = parseWav(loadFixtureWavBytes(def));
  return { def, audio, result: detectSpeechSegments(audio.samples) };
}

/** Builds deterministic tone/silence PCM for synthetic boundary checks. */
function synth(spec: Array<{ startMs: number; endMs: number; amplitude?: number }>, durationMs: number): Int16Array {
  const rate = 16_000;
  const samples = new Int16Array(Math.round((durationMs / 1000) * rate));
  for (const s of spec) {
    const start = Math.round((s.startMs / 1000) * rate);
    const end = Math.min(samples.length, Math.round((s.endMs / 1000) * rate));
    const amp = s.amplitude ?? 0.45;
    for (let i = start; i < end; i++) {
      const t = i / rate;
      samples[i] = Math.round((amp * Math.sin(2 * Math.PI * 220 * t) + amp * 0.45 * Math.sin(2 * Math.PI * 660 * t)) * 32_767);
    }
  }
  return samples;
}

describe("detectSpeechSegments on fixture WAVs", () => {
  it("reports frame-exact boundaries and 700 ms endpoints on vad-boundary.wav", () => {
    ensureFixtures();
    const { result } = loadFixture("vad-boundary");
    expect(result.segments).toHaveLength(2);

    expect(result.segments[0]).toMatchObject({
      startSample: 6_400, // 0.400 s
      endSample: 22_400, // 1.400 s
      startMs: 400,
      endMs: 1_400,
    });
    expect(result.segments[0]!.endSample - result.segments[0]!.startSample).toBe(16_000);

    expect(result.segments[1]).toMatchObject({
      startSample: 33_600, // 2.100 s (after exactly 700 ms silence)
      endSample: 51_200, // 3.200 s
      startMs: 2_100,
      endMs: 3_200,
    });

    expect(result.endpoints.map((e) => e.endpointSample)).toEqual([
      22_400 + SILENCE_SAMPLES, // 2.100 s
      51_200 + SILENCE_SAMPLES, // 3.900 s
    ]);
    expect(result.endpoints.every((e) => e.trailingSilenceMs === 700)).toBe(true);
    expect(result.endpoints.every((e) => e.closedBy === "silence")).toBe(true);
  });

  it("splits only at the endpoint threshold, not shorter gaps", () => {
    // 300 ms gap: same utterance (endpointing keeps it open).
    const merged = detectSpeechSegments(
      synth(
        [
          { startMs: 200, endMs: 500 },
          { startMs: 800, endMs: 1_100 },
        ],
        2_000,
      ),
    );
    expect(merged.segments).toHaveLength(1);
    expect(merged.segments[0]).toMatchObject({ startSample: 3_200, endSample: 17_600 });

    // Exactly 700 ms gap: two utterances.
    const split = detectSpeechSegments(
      synth(
        [
          { startMs: 200, endMs: 500 },
          { startMs: 1_200, endMs: 1_500 },
        ],
        2_500,
      ),
    );
    expect(split.segments).toHaveLength(2);
    expect(split.endpoints[0]!.endpointSample).toBe(8_000 + SILENCE_SAMPLES);
    expect(split.segments[1]!.startSample).toBe(8_000 + SILENCE_SAMPLES);
  });

  it("detects the two interviewer questions in demo-screen.wav", () => {
    ensureFixtures();
    const { result } = loadFixture("demo-screen");
    expect(result.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [600, 1_600],
      [2_300, 3_300],
    ]);
    expect(result.segments.map((s) => [s.startSample, s.endSample])).toEqual([
      [9_600, 25_600],
      [36_800, 52_800],
    ]);
    expect(result.endpoints.map((e) => e.endpointMs)).toEqual([2_300, 4_000]);
    expect(result.durationMs).toBe(4_600);
  });

  it("detects the candidate channel in demo-mic.wav", () => {
    ensureFixtures();
    const { result } = loadFixture("demo-mic");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ startMs: 3_500, endMs: 3_750 });
    expect(result.endpoints[0]).toMatchObject({ endpointMs: 4_450, closedBy: "silence" });
  });

  it("discards sub-minSpeech bursts (vad-short-burst.wav)", () => {
    ensureFixtures();
    const { result } = loadFixture("vad-short-burst");
    expect(result.segments).toEqual([]);
    expect(result.endpoints).toEqual([]);
    // The burst really is present (energy above threshold) but is only ~9
    // frames (90 ms) long — below the 120 ms minSpeech gate, so it is dropped
    // rather than becoming a 700 ms endpoint. (ffmpeg's between() is inclusive
    // at the end timestamp, hence the 9th frame.)
    const activeFrames = result.frames.filter((f) => f.active);
    expect(activeFrames).toHaveLength(9);
    expect(activeFrames[0]!.startSample).toBe(16_000);
    expect(activeFrames.length).toBeLessThan(result.config.minSpeechMs / result.config.frameMs);
  });

  it("reports frame count and exact frame energies", () => {
    ensureFixtures();
    const { audio, result } = loadFixture("vad-boundary");
    expect(result.frames).toHaveLength(Math.ceil(audio.samples.length / FRAME_SAMPLES));
    expect(result.frames[0]!.rms).toBe(0);
    expect(result.frames[40]!.active).toBe(true); // 0.400 s
    expect(result.frames[39]!.active).toBe(false); // 0.390 s
    expect(result.frames[140]!.active).toBe(false); // 1.400 s is the first silent frame
    expect(frameRms(audio.samples, 0, FRAME_SAMPLES)).toBe(0);
  });

  it("uses the documented default config (700 ms endpoint, 10 ms frames)", () => {
    expect(DEFAULT_VAD_CONFIG).toMatchObject({
      sampleRate: 16_000,
      frameMs: 10,
      endSilenceMs: 700,
      minSpeechMs: 120,
    });
  });

  it("rejects an invalid sample rate", () => {
    expect(() => detectSpeechSegments(new Int16Array(160), { sampleRate: 0 })).toThrow(/sampleRate/);
  });
});
