import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createMockAsrProvider } from "../../../api-server/src/lib/mocks/mockAsr";
import { createMockLlmProvider } from "../../../api-server/src/lib/mocks/mockLlm";
import { createDemoSessionCreate } from "../../../api-server/src/lib/mocks/targetContracts";
import { degradeTranscript } from "../../../api-server/src/lib/pronunciation/degradation";
import type { AsrEvent, AsrProvider } from "../../../api-server/src/lib/mocks/types";
import { buildVocabulary } from "@/features/pronunciation";
import { GENERATOR_SCRIPT, allFixturesExist, getFixture, loadFixtureWavBytes } from "./fixtures";
import { parseWav } from "./wav";
import { runDemoPipeline, type PipelineStreamInput } from "./pipeline";

function ensureFixtures(): void {
  if (allFixturesExist()) return;
  const run = spawnSync(process.execPath, [GENERATOR_SCRIPT], { encoding: "utf8" });
  if (run.status !== 0) throw new Error("fixture generation failed: " + run.stdout + run.stderr);
}

function stream(streamId: "mic" | "screen", fixtureId: string): PipelineStreamInput {
  const fixture = getFixture(fixtureId);
  return { stream: streamId, fixture, audio: parseWav(loadFixtureWavBytes(fixture)) };
}

const VOCABULARY = buildVocabulary({
  resumeText:
    "Demo Candidate - Senior Backend Engineer. Redis-backed rate limiter for an Express API, sliding-window counters, Postgres, Node.js, TypeScript.",
  jobDescription: "Senior backend engineer: Node.js/TypeScript services, Redis, Postgres, rate limiting.",
  companyNames: ["Northwind Labs"],
});

function degradedAsr(profile: "south_indian" | "east_asian"): AsrProvider {
  const inner = createMockAsrProvider();
  const decorate = (events: AsrEvent[]): AsrEvent[] =>
    events.map((event) => {
      if (!event.isFinal) return event;
      const degraded = degradeTranscript(event.text, profile, { seed: event.segmentId });
      return {
        ...event,
        text: degraded.text,
        words: degraded.words,
        alternatives: degraded.alternatives,
      };
    });
  return {
    id: "degraded-mock-asr",
    kind: "mock",
    isConfigured: () => true,
    openStream(options) {
      const stream = inner.openStream(options);
      return {
        pushAudio: (pcm) => decorate(stream.pushAudio(pcm)),
        endAudio: () => decorate(stream.endAudio()),
        close: () => stream.close(),
      };
    },
  };
}

const noopSleep = async () => {};

function run(streams: PipelineStreamInput[], asr: AsrProvider) {
  return runDemoPipeline({
    sessionId: "pronunciation-pipeline-test",
    sessionCreate: createDemoSessionCreate(),
    model: "gpt-5",
    streams,
    asr,
    llm: createMockLlmProvider({ sleep: noopSleep, firstTokenDelayMs: 0 }),
    speed: 30,
    tickMs: 5,
    maxWallMs: 15_000,
    pronunciation: { vocabulary: VOCABULARY, sessionLanguage: "en" },
  });
}

describe("demo pipeline pronunciation flag (G-039)", () => {
  it("is opt-in: default pipeline behaviour is unchanged", async () => {
    ensureFixtures();
    const result = await runDemoPipeline({
      sessionId: "default",
      sessionCreate: createDemoSessionCreate(),
      model: "gpt-5",
      streams: [stream("mic", "demo-mic"), stream("screen", "demo-screen")],
      asr: createMockAsrProvider(),
      llm: createMockLlmProvider({ sleep: noopSleep, firstTokenDelayMs: 0 }),
      speed: 30,
      tickMs: 5,
      maxWallMs: 15_000,
    });
    expect(result.events.some((event) => event.type === "pronunciation.understanding")).toBe(false);
  });

  it("rescues degraded ASR words before the real detector and emits understanding events", async () => {
    ensureFixtures();
    const result = await run([stream("mic", "demo-mic"), stream("screen", "demo-screen")], degradedAsr("south_indian"));
    const understanding = result.events.filter(
      (event) => event.type === "pronunciation.understanding" && event.stream === "screen",
    );
    expect(understanding.length).toBe(2);
    expect(
      understanding.every((event) =>
        ["answer", "hedge", "clarify"].includes(String(event.data["decision"])),
      ),
    ).toBe(true);
    // First question is confidently recovered; the second degrades a non-domain
    // word, so the gate asks for a clarification instead of confidently guessing.
    expect(understanding.some((event) => event.data["decision"] === "answer")).toBe(true);
    expect(understanding.some((event) => event.data["decision"] === "clarify")).toBe(true);
    expect(result.questions.length).toBeGreaterThanOrEqual(1);
    for (const question of result.questions) {
      expect(question.question.toLowerCase()).toContain("redis");
    }
    const finals = result.streams.find((item) => item.stream === "screen")!.finals;
    expect(finals.every((final) => final.pronunciation !== undefined)).toBe(true);
    expect(finals.some((final) => final.suppressionReason === "pronunciation_clarification")).toBe(true);
  });

  it("suppresses the answer and emits a clarification when the gate is ambiguous", async () => {
    ensureFixtures();
    const inner = createMockAsrProvider();
    const ambiguous: AsrProvider = {
      id: "ambiguous-asr",
      kind: "mock",
      isConfigured: () => true,
      openStream(options) {
        const stream = inner.openStream(options);
        const rewrite = (events: AsrEvent[]): AsrEvent[] =>
          events.map((event) =>
            event.isFinal
              ? {
                  ...event,
                  text: "did you cash it",
                  words: [
                    { word: "did", confidence: 0.95 },
                    { word: "you", confidence: 0.95 },
                    { word: "cash", confidence: 0.35 },
                    { word: "it", confidence: 0.9 },
                  ],
                  alternatives: [{ text: "did you cash it", confidence: 0.4 }],
                }
              : event,
          );
        return {
          pushAudio: (pcm) => rewrite(stream.pushAudio(pcm)),
          endAudio: () => rewrite(stream.endAudio()),
          close: () => stream.close(),
        };
      },
    };
    const result = await run([stream("mic", "demo-mic"), stream("screen", "demo-screen")], ambiguous);
    const decisions = result.events
      .filter((event) => event.type === "pronunciation.understanding")
      .map((event) => event.data["decision"]);
    expect(decisions).toContain("clarify");
    expect(result.questions).toHaveLength(0);
    const screen = result.streams.find((item) => item.stream === "screen")!;
    expect(screen.finals.every((final) => final.suppressionReason === "pronunciation_clarification")).toBe(true);
  });
});
