import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  GENERATOR_SCRIPT,
  allFixturesExist,
  fixtureWavPath,
  getFixture,
  loadFixtureWavBytes,
} from "./fixtures.js";
import { parseWav } from "./wav.js";

function ensureFixtures(): void {
  if (allFixturesExist()) return;
  const run = spawnSync(process.execPath, [GENERATOR_SCRIPT], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`fixture generation failed (status ${run.status}): ${run.stdout}\n${run.stderr}`);
  }
}

describe("parseWav", () => {
  it("parses every generated fixture as 16 kHz mono PCM16", () => {
    ensureFixtures();
    for (const fixture of ["demo-screen", "demo-mic", "vad-boundary", "vad-short-burst"]) {
      const def = getFixture(fixture);
      expect(existsSync(fixtureWavPath(def))).toBe(true);
      const audio = parseWav(loadFixtureWavBytes(def));
      expect(audio.sampleRate).toBe(16_000);
      expect(audio.channels).toBe(1);
      expect(audio.samples.length).toBe(Math.round((def.durationMs / 1000) * 16_000));
      expect(audio.durationMs).toBe(def.durationMs);
    }
  });

  it("rejects non-WAV input", () => {
    expect(() => parseWav(new Uint8Array(64))).toThrow(/RIFF|too short/);
  });
});
