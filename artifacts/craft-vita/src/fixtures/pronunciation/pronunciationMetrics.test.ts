import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runPronunciationEvaluation,
  type PronunciationMetrics,
} from "./evaluation";
import { buildMetricsJson, renderReportMarkdown } from "./report";
import { CORPUS_BASES, INTENT_SPECS } from "./corpus";

/**
 * G-039 regression gate.
 *
 * Recomputes BEFORE/AFTER intent accuracy and false-answer rate on the 192-item
 * degraded corpus with the real local question detector (no network, no LLM).
 * Fails CI if AFTER drops below 0.92, the false-answer rate reaches 0.03, the
 * pronunciation layer mutates a high-confidence token, or the repair pass
 * exceeds its 150 ms budget.
 *
 * Evidence regeneration (does not run in normal CI):
 *   PRONUNCIATION_EVIDENCE_DIR=../../docs/evidence/pronunciation pnpm exec vitest run \
 *     src/fixtures/pronunciation/pronunciationMetrics.test.ts
 */
function core(metrics: PronunciationMetrics) {
  return {
    accuracyBefore: metrics.accuracyBefore,
    accuracyAfter: metrics.accuracyAfter,
    falseAnswerRateBefore: metrics.falseAnswerRateBefore,
    falseAnswerRateAfter: metrics.falseAnswerRateAfter,
    perProfile: metrics.perProfile,
    gate: metrics.gate,
    repair: metrics.repair,
    hardRule: metrics.hardRule,
    total: metrics.corpus.total,
  };
}

describe("pronunciation-robust understanding — corpus gate (G-039)", () => {
  let metrics: PronunciationMetrics;
  let again: PronunciationMetrics;

  it("is deterministic and large enough", async () => {
    metrics = await runPronunciationEvaluation();
    again = await runPronunciationEvaluation();
    expect(core(metrics)).toEqual(core(again));
    expect(metrics.corpus.total).toBeGreaterThanOrEqual(150);
    expect(metrics.corpus.total).toBe(CORPUS_BASES.length * 4);
    expect(metrics.corpus.profiles).toBe(4);
    expect(metrics.corpus.intents).toBe(INTENT_SPECS.length);
  });

  it("reaches intent accuracy >= 0.92 AFTER and beats BEFORE", () => {
    expect(metrics.accuracyAfter).toBeGreaterThanOrEqual(0.92);
    expect(metrics.accuracyAfter).toBeGreaterThan(metrics.accuracyBefore);
    expect(metrics.accuracyBefore).toBeLessThan(0.92);
    for (const profile of metrics.perProfile) {
      expect(profile.accuracyAfter, profile.profileId).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("keeps the false-answer rate below 0.03 AFTER and well above it BEFORE", () => {
    expect(metrics.falseAnswerRateAfter).toBeLessThan(0.03);
    expect(metrics.falseAnswerRateBefore).toBeGreaterThan(0.03);
    for (const profile of metrics.perProfile) {
      expect(profile.falseAnswerRateAfter, profile.profileId).toBeLessThan(0.03);
    }
  });

  it("never mutates high-confidence tokens (hard rule)", () => {
    expect(metrics.hardRule.itemsChecked).toBe(metrics.corpus.total);
    expect(metrics.hardRule.violations).toBe(0);
  });

  it("keeps the targeted repair pass under the 150 ms budget", () => {
    expect(metrics.repair.budgetMs).toBe(150);
    expect(metrics.repair.maxElapsedMs).toBeLessThan(150);
    expect(metrics.repair.withinBudgetRate).toBe(1);
    expect(metrics.repair.calls).toBeGreaterThan(0);
  });

  it("actually gates ambiguous items instead of answering everything", () => {
    const gated = metrics.gate.hedge + metrics.gate.clarify;
    expect(gated).toBeGreaterThan(0);
    expect(metrics.gate.answer + gated).toBe(metrics.corpus.total);
    expect(metrics.rescue.spans).toBeGreaterThan(0);
  });

  it("renders reproducible evidence when PRONUNCIATION_EVIDENCE_DIR is set", () => {
    const evidenceDir = process.env.PRONUNCIATION_EVIDENCE_DIR;
    if (!evidenceDir) return;
    const absoluteDir = path.resolve(evidenceDir);
    fs.mkdirSync(absoluteDir, { recursive: true });
    const input = {
      generatedAt: new Date().toISOString(),
      testCommand:
        "pnpm --dir artifacts/craft-vita exec vitest run src/fixtures/pronunciation/pronunciationMetrics.test.ts",
      metrics,
    };
    fs.writeFileSync(path.join(absoluteDir, "metrics.json"), JSON.stringify(buildMetricsJson(input), null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(absoluteDir, "report.md"), renderReportMarkdown(input), "utf8");
    const written = JSON.parse(fs.readFileSync(path.join(absoluteDir, "metrics.json"), "utf8"));
    expect(written.after.intentAccuracy).toBe(metrics.accuracyAfter);
    expect(written.after.falseAnswerRate).toBe(metrics.falseAnswerRateAfter);
  });
});
