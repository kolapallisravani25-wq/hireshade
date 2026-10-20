import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  LABELED_UTTERANCES,
  NEGATIVE_CATEGORIES,
  POSITIVE_CATEGORIES,
} from "@/fixtures/classifier/labeledUtterances";
import { HOLDOUT_UTTERANCES } from "@/fixtures/classifier/holdoutUtterances";
import { UNTOUCHED_CHECK_UTTERANCES } from "@/fixtures/classifier/untouchedCheckUtterances";
import {
  DETECTION_CONFIDENCE_THRESHOLD,
  evaluateLabeledDataset,
} from "./questionDetectionEval";
import { buildMetricsJson, renderReportMarkdown } from "./classifierReport";

/**
 * G-016 regression gate.
 *
 * Recomputes question-classifier precision/recall with the REAL local detector
 * (no network, no LLM calls) and fails CI if either drops below the required
 * bar or if any hard-negative category starts firing.
 *
 * Evidence regeneration (does not run in normal CI):
 *   CLASSIFIER_EVIDENCE_DIR=../../docs/evidence/classifier pnpm exec vitest run \
 *     src/features/session/detection/classifierMetrics.test.ts
 */
describe("question classifier — labeled-set precision/recall gate (G-016)", () => {
  const main = evaluateLabeledDataset(LABELED_UTTERANCES);
  const holdout = evaluateLabeledDataset(HOLDOUT_UTTERANCES);
  const untouched = evaluateLabeledDataset(UNTOUCHED_CHECK_UTTERANCES);

  it("has a sufficiently large, category-complete labeled dataset", () => {
    expect(main.metrics.total).toBeGreaterThanOrEqual(80);
    const categories = new Set(main.metrics.perCategory.map((category) => category.category));
    for (const category of [...POSITIVE_CATEGORIES, ...NEGATIVE_CATEGORIES]) {
      expect(categories.has(category)).toBe(true);
    }
    expect(main.metrics.positives).toBeGreaterThanOrEqual(30);
    expect(main.metrics.negatives).toBeGreaterThanOrEqual(30);
  });

  it("classifies with precision >= 0.85 and recall >= 0.90 at utterance level", () => {
    expect(main.metrics.precision).toBeGreaterThanOrEqual(0.85);
    expect(main.metrics.recall).toBeGreaterThanOrEqual(0.9);
    // Belt-and-braces: the confusion matrix must agree with the totals.
    const { tp, fp, fn, tn } = main.metrics.confusion;
    expect(tp + fn).toBe(main.metrics.positives);
    expect(fp + tn).toBe(main.metrics.negatives);
    expect(tp + fp + fn + tn).toBe(main.metrics.total);
  });

  it("never fires on small talk, interviewer admin, statements, or coding discussion", () => {
    const negativeCategories = main.metrics.perCategory.filter(
      (category) => category.label === "negative",
    );
    expect(negativeCategories.length).toBe(NEGATIVE_CATEGORIES.length);
    for (const category of negativeCategories) {
      expect(category.fp, `${category.category}: ${JSON.stringify(main.metrics.falsePositives)}`).toBe(0);
      expect(category.falsePositiveRate).toBe(0);
    }
  });

  it("detects every hard-positive category with recall >= 0.90", () => {
    const positiveCategories = main.metrics.perCategory.filter(
      (category) => category.label === "positive",
    );
    expect(positiveCategories.length).toBe(POSITIVE_CATEGORIES.length);
    for (const category of positiveCategories) {
      expect(category.recall ?? 0, category.category).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("generalizes to the holdout and untouched-check sets (same thresholds)", () => {
    expect(holdout.metrics.precision).toBeGreaterThanOrEqual(0.85);
    expect(holdout.metrics.recall).toBeGreaterThanOrEqual(0.9);
    expect(untouched.metrics.precision).toBeGreaterThanOrEqual(0.85);
    expect(untouched.metrics.recall).toBeGreaterThanOrEqual(0.9);
  });

  it("documents the fire decision threshold used by the harness", () => {
    expect(DETECTION_CONFIDENCE_THRESHOLD).toBe(0.75);
  });

  it("renders reproducible evidence when CLASSIFIER_EVIDENCE_DIR is set", () => {
    const evidenceDir = process.env.CLASSIFIER_EVIDENCE_DIR;
    if (!evidenceDir) {
      // Normal CI run: assertions above are the gate; no filesystem writes.
      return;
    }

    const input = {
      generatedAt: new Date().toISOString(),
      testCommand:
        "pnpm --dir artifacts/craft-vita exec vitest run src/features/session/detection/classifierMetrics.test.ts",
      main: {
        name: "main",
        purpose: "CI assertion baseline (labeled dataset).",
        evaluations: main.evaluations,
        metrics: main.metrics,
      },
      holdout: {
        name: "holdout",
        purpose: "Generalization probe; first pass informed two small-talk fixes and one admin fix.",
        evaluations: holdout.evaluations,
        metrics: holdout.metrics,
      },
      untouched: {
        name: "untouched-check",
        purpose: "Authored and evaluated once after all rules were frozen.",
        evaluations: untouched.evaluations,
        metrics: untouched.metrics,
      },
    };

    const absoluteDir = path.resolve(evidenceDir);
    fs.mkdirSync(absoluteDir, { recursive: true });
    fs.writeFileSync(
      path.join(absoluteDir, "metrics.json"),
      JSON.stringify(buildMetricsJson(input), null, 2) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(absoluteDir, "report.md"),
      renderReportMarkdown(input),
      "utf8",
    );

    // The evidence must contain the numbers the test just asserted on.
    expect(fs.existsSync(path.join(absoluteDir, "metrics.json"))).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(absoluteDir, "metrics.json"), "utf8"),
    );
    expect(written.metrics.precision).toBe(main.metrics.precision);
    expect(written.metrics.recall).toBe(main.metrics.recall);
    expect(written.confusionMatrix).toEqual(main.metrics.confusion);
  });
});
