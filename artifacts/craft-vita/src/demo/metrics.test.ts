import { describe, expect, it } from "vitest";
import {
  DEMO_LATENCY_BUDGETS,
  evaluateLatencyBudget,
  percentile,
  summarize,
  type LatencySample,
} from "./metrics.js";

function sample(overrides: Partial<LatencySample> = {}): LatencySample {
  return {
    runId: "run-1",
    model: "gpt-5",
    questionId: "screen:0",
    question: "Can you explain Redis rate limiting?",
    partialLatencyMs: 250,
    silenceToQuestionMs: 710,
    questionToFirstTokenMs: 520,
    questionToAnswerVisibleMs: 2_000,
    ...overrides,
  };
}

describe("percentile", () => {
  it("uses linear interpolation", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 6);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([100, 200], 0)).toBe(100);
    expect(percentile([100, 200], 100)).toBe(200);
  });

  it("rejects empty input", () => {
    expect(() => percentile([], 50)).toThrow(/empty/);
  });
});

describe("summarize", () => {
  it("reports count/min/p50/p95/max/mean", () => {
    expect(summarize([100, 200, 300, 400])).toEqual({
      count: 4,
      minMs: 100,
      p50Ms: 250,
      p95Ms: 385,
      maxMs: 400,
      meanMs: 250,
    });
  });
});

describe("evaluateLatencyBudget", () => {
  it("passes when every budget is met", () => {
    const report = evaluateLatencyBudget([sample(), sample({ questionToAnswerVisibleMs: 2_400 })]);
    expect(report.pass).toBe(true);
    expect(report.checks.map((c) => c.pass)).toEqual([true, true, true, true, true]);
    expect(report.metrics.questionToAnswerVisibleMs.p50Ms).toBe(2_200);
  });

  it("fails answer-visible p50 above 3000 ms", () => {
    const report = evaluateLatencyBudget([
      sample({ questionToAnswerVisibleMs: 3_200 }),
      sample({ questionToAnswerVisibleMs: 4_600 }),
    ]);
    expect(report.pass).toBe(false);
    const p50Check = report.checks.find((c) => c.metric === "answerVisibleMs" && c.statistic === "p50")!;
    expect(p50Check.pass).toBe(false);
    expect(p50Check.actualMs).toBeGreaterThan(p50Check.thresholdMs);
  });

  it("fails answer-visible p95 above 5000 ms even when p50 passes", () => {
    const samples = [
      ...Array.from({ length: 18 }, () => 1_000),
      6_000,
      6_100,
    ].map((ms) => sample({ questionToAnswerVisibleMs: ms }));
    const report = evaluateLatencyBudget(samples);
    const p50 = report.checks.find((c) => c.metric === "answerVisibleMs" && c.statistic === "p50")!;
    const p95 = report.checks.find((c) => c.metric === "answerVisibleMs" && c.statistic === "p95")!;
    expect(p50.pass).toBe(true);
    expect(p95.pass).toBe(false);
    expect(report.pass).toBe(false);
  });

  it("fails partial/silence/first-token max overruns", () => {
    const report = evaluateLatencyBudget([
      sample({ partialLatencyMs: 700, silenceToQuestionMs: 900, questionToFirstTokenMs: 1_800 }),
    ]);
    expect(report.pass).toBe(false);
    expect(report.checks.filter((c) => !c.pass).map((c) => c.metric)).toEqual([
      "partialLatencyMs",
      "silenceToQuestionMs",
      "questionToFirstTokenMs",
    ]);
  });

  it("groups metrics by model", () => {
    const report = evaluateLatencyBudget([
      sample({ model: "gpt-5", questionToAnswerVisibleMs: 1_800 }),
      sample({ model: "anthropic/claude-haiku-4.5", questionToAnswerVisibleMs: 2_500 }),
      sample({ model: "anthropic/claude-haiku-4.5", questionToAnswerVisibleMs: 2_600 }),
    ]);
    expect(Object.keys(report.byModel).sort()).toEqual(["anthropic/claude-haiku-4.5", "gpt-5"]);
    expect(report.byModel["gpt-5"]!.questionToAnswerVisibleMs.count).toBe(1);
    expect(report.byModel["anthropic/claude-haiku-4.5"]!.questionToAnswerVisibleMs.count).toBe(2);
    expect(report.budgets).toEqual(DEMO_LATENCY_BUDGETS);
  });

  it("rejects an empty sample set", () => {
    expect(() => evaluateLatencyBudget([])).toThrow(/no samples/);
  });
});
