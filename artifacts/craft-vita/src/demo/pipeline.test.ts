import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createMockAsrProvider } from "../../../api-server/src/lib/mocks/mockAsr.js";
import { DEMO_LLM_ANSWER, createMockLlmProvider } from "../../../api-server/src/lib/mocks/mockLlm.js";
import { createDemoSessionCreate } from "../../../api-server/src/lib/mocks/targetContracts.js";
import {
  GENERATOR_SCRIPT,
  allFixturesExist,
  getFixture,
  loadFixtureWavBytes,
} from "./fixtures.js";
import { parseWav } from "./wav.js";
import { runDemoPipeline, type PipelineStreamInput } from "./pipeline.js";

function ensureFixtures(): void {
  if (allFixturesExist()) return;
  const run = spawnSync(process.execPath, [GENERATOR_SCRIPT], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`fixture generation failed: ${run.stdout}\n${run.stderr}`);
}

function stream(streamId: "mic" | "screen", fixtureId: string): PipelineStreamInput {
  const fixture = getFixture(fixtureId);
  return { stream: streamId, fixture, audio: parseWav(loadFixtureWavBytes(fixture)) };
}

const noopSleep = async () => {};

function makePipeline(overrides: Partial<Parameters<typeof runDemoPipeline>[0]> = {}) {
  return runDemoPipeline({
    sessionId: "test-run-1",
    sessionCreate: createDemoSessionCreate(),
    model: "gpt-5",
    streams: [stream("mic", "demo-mic"), stream("screen", "demo-screen")],
    asr: createMockAsrProvider(),
    llm: createMockLlmProvider({ sleep: noopSleep, firstTokenDelayMs: 0 }),
    speed: 30,
    tickMs: 5,
    maxWallMs: 15_000,
    ...overrides,
  });
}

describe("runDemoPipeline (keyless)", () => {
  it("drives fixture audio through VAD -> mock ASR -> real detector -> real prompt -> mock LLM", async () => {
    ensureFixtures();
    const result = await makePipeline();

    // Two questions answered, from the screen-share channel only.
    expect(result.questions).toHaveLength(2);
    expect(result.questions.map((q) => q.question)).toEqual([
      expect.stringContaining("rate limiter"),
      expect.stringContaining("Redis is unavailable"),
    ]);
    expect(result.questions.every((q) => q.answer === DEMO_LLM_ANSWER)).toBe(true);
    expect(result.answer).toBe(DEMO_LLM_ANSWER);

    // Real prompt builder output (not a stub).
    expect(result.prompt).toContain("You are the HireShade interview answer engine.");
    expect(result.prompt).toContain("Session answer preferences");

    // Both audio sources ran through the target pcm_f32le transport.
    expect(result.streams).toHaveLength(2);
    for (const outcome of result.streams) {
      expect(outcome.encoding).toBe("pcm_f32le");
      expect(outcome.bytesFed).toBeGreaterThan(0);
    }
    const screen = result.streams.find((s) => s.stream === "screen")!;
    const mic = result.streams.find((s) => s.stream === "mic")!;
    expect(screen.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [600, 1_600],
      [2_300, 3_300],
    ]);
    expect(mic.segments.map((s) => [s.startMs, s.endMs])).toEqual([[3_500, 3_750]]);
    expect(mic.finals[0]).toMatchObject({
      answerSuppressed: true,
      suppressionReason: "candidate_channel",
    });

    // Latency fields are populated and non-negative.
    for (const question of result.questions) {
      expect(question.partialLatencyMs).toBeGreaterThanOrEqual(0);
      expect(question.silenceToQuestionMs).toBeGreaterThanOrEqual(0);
      expect(question.questionToFirstTokenMs).toBeGreaterThanOrEqual(0);
      expect(question.questionToAnswerVisibleMs).toBeGreaterThanOrEqual(0);
      expect(question.promptChars).toBe(result.prompt.length);
    }
  });

  it("emits the target-aligned event vocabulary in order", async () => {
    ensureFixtures();
    const result = await makePipeline();
    const types = result.events.map((e) => e.type);

    for (const expected of [
      "session.start",
      "stream.start",
      "vad.segment",
      "asr.partial",
      "asr.final",
      "asr.end_of_utterance",
      "question.detected",
      "prompt.built",
      "answer.first_token",
      "answer.delta",
      "answer.final",
      "session.end",
    ]) {
      expect(types).toContain(expected);
    }

    const partial = result.events.find((e) => e.type === "asr.partial" && e.stream === "screen")!;
    expect(partial.data["targetMessage"]).toBe("AddPartialTranscript");
    const final = result.events.find((e) => e.type === "asr.final" && e.stream === "screen")!;
    expect(final.data["targetMessage"]).toBe("AddTranscript");
    const endpoint = result.events.find((e) => e.type === "asr.end_of_utterance")!;
    expect((endpoint.data["target"] as { message: string }).message).toBe("EndOfUtterance");

    const start = result.events.find((e) => e.type === "session.start")!;
    const target = start.data["target"] as {
      asr: { transport: string; encoding: string; streams: { id: string }[] };
      llm: { transport: string; headers: Record<string, string> };
    };
    expect(target.asr.transport).toBe("websocket");
    expect(target.asr.encoding).toBe("pcm_f32le");
    expect(target.asr.streams.map((s) => s.id)).toEqual(["mic", "screen"]);
    expect(target.llm.transport).toBe("sse");
    expect(target.llm.headers["X-Accel-Buffering"]).toBe("no");

    // Event timestamps are monotonic in wall-clock terms.
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.atMs).toBeGreaterThanOrEqual(result.events[i - 1]!.atMs - 1);
    }
  });

  it("orders first token before the final answer for each question", async () => {
    ensureFixtures();
    const result = await makePipeline();
    const questions = result.events.filter((e) => e.type === "question.detected");
    expect(questions).toHaveLength(2);
    // The first answer completes before the second question is detected in this fixture.
    const firstFinal = result.events.find((e) => e.type === "answer.final")!;
    expect(result.events.indexOf(firstFinal)).toBeGreaterThan(result.events.indexOf(questions[0]!));

    const firstToken = result.events.find((e) => e.type === "answer.first_token")!;
    expect(firstToken.data["model"]).toBe("gpt-5");
    const firstQuestion = questions[0]!;
    expect(firstToken.atMs).toBeGreaterThanOrEqual(firstQuestion.atMs);
  });

  it("surfaces LLM failures as answer.error instead of hanging", async () => {
    ensureFixtures();
    const result = await makePipeline({
      llm: createMockLlmProvider({ sleep: noopSleep, failWith: new Error("provider exploded") }),
    });
    const errors = result.events.filter((e) => e.type === "answer.error");
    expect(errors).toHaveLength(2);
    expect(errors[0]!.data["message"]).toContain("provider exploded");
    expect(result.questions).toHaveLength(0);
  });

  it("fails loudly when the fixture script and the VAD disagree", async () => {
    ensureFixtures();
    // Screen script (2 segments) paired with the 1-segment mic audio: VAD finds
    // one utterance where the script expects two.
    const screenFixture = getFixture("demo-screen");
    const micAudio = parseWav(loadFixtureWavBytes(getFixture("demo-mic")));
    await expect(
      makePipeline({
        streams: [{ stream: "screen", fixture: screenFixture, audio: micAudio }],
        asr: createMockAsrProvider(),
      }),
    ).rejects.toThrow(/VAD found 1 segment\(s\).*script has 2/);
  });
});
