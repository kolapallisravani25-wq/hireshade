#!/usr/bin/env node
/**
 * Generates the 16 kHz mono PCM WAV fixtures used by the VAD/demo harness.
 *
 * ffmpeg is the generator (the repo already depends on it for media work):
 * each fixture is a deterministic sum of tone bursts at exact sample offsets so
 * the VAD can be asserted frame-exactly. The WAVs are gitignored (*.wav);
 * artifacts/craft-vita/src/demo/fixtures/fixtures.json is the committed source
 * of truth for boundaries and scripted transcripts.
 *
 * Usage: node scripts/demo/generate-fixtures.mjs [--force]
 */
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const fixtureDir = path.join(repoRoot, "artifacts", "craft-vita", "src", "demo", "fixtures");
const manifestPath = path.join(fixtureDir, "fixtures.json");
const force = process.argv.includes("--force");

function ffmpegAvailable() {
  const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return probe.status === 0;
}

function toneExpression(segments, fixtureId) {
  if (!segments.length) return "0";
  return segments
    .map((segment) => {
      const amplitude = segment.amplitude ?? 0.45;
      const start = (segment.startMs / 1000).toFixed(6);
      const end = (segment.endMs / 1000).toFixed(6);
      const expr =
        `${amplitude}*sin(2*PI*220*t)+${(amplitude * 0.45).toFixed(6)}*sin(2*PI*660*t)`;
      return `if(between(t,${start},${end}),${expr},0)`;
    })
    .join("+");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!ffmpegAvailable()) {
  console.error("[fixtures] ffmpeg is required to generate fixture WAVs but was not found on PATH");
  process.exit(2);
}
mkdirSync(fixtureDir, { recursive: true });

const results = [];
for (const fixture of manifest.fixtures) {
  const outPath = path.join(fixtureDir, fixture.wav);
  if (existsSync(outPath) && !force) {
    results.push({ id: fixture.id, wav: fixture.wav, skipped: true, bytes: statSync(outPath).size });
    continue;
  }
  const durationSec = (fixture.durationMs / 1000).toFixed(3);
  const source = `aevalsrc='${toneExpression(fixture.segments)}':s=${manifest.sampleRate}:d=${durationSec}`;
  const args = [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    source,
    "-ac",
    "1",
    "-ar",
    String(manifest.sampleRate),
    "-c:a",
    "pcm_s16le",
    outPath,
  ];
  const run = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (run.status !== 0) {
    console.error(`[fixtures] ffmpeg failed for ${fixture.id}\n${run.stderr ?? ""}`);
    process.exit(1);
  }
  results.push({ id: fixture.id, wav: fixture.wav, bytes: statSync(outPath).size });
}

console.log(JSON.stringify({ fixtureDir, sampleRate: manifest.sampleRate, results }, null, 2));
