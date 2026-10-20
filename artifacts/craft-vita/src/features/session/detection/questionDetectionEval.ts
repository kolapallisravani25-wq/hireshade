/**
 * Question-classifier evaluation harness (G-016).
 *
 * WHAT IS MEASURED
 * ----------------
 * The production auto-trigger path is `detectActiveQuestion` fed the
 * stabilized transcript snapshot as `liveInterimText` (see
 * activeQuestionDetector.test.ts "Mini-Phase B" and useFloatingSession: the
 * auto path never feeds raw interim state). For every labeled utterance this
 * harness calls that exact function — no mocks, no network, no LLM — and
 * records one binary decision:
 *
 *   DETECTED  ⇔  source !== "none"
 *             ∧  ignoredNoise === false
 *             ∧  activeQuestion.trim() !== ""
 *             ∧  cleanedQuestion.trim() !== ""
 *             ∧  confidenceScore > DETECTION_CONFIDENCE_THRESHOLD
 *
 * i.e. the assistant would surface a question and start answering it. Every
 * other outcome is NOT_DETECTED. `confidenceScore > threshold` (strict) is
 * deliberate: baseline statement confidence sits at 0.70 and question
 * confidence at 1.00, so 0.75 is the documented separating band.
 *
 * Precision = TP / (TP + FP)  — of the utterances we fired on, how many were
 *                               really answerable questions.
 * Recall    = TP / (TP + FN)  — of the answerable questions, how many fired.
 *
 * All metrics are computed at UTTTERANCE level (one utterance = one decision).
 * No averaging over categories.
 */

import {
  detectActiveQuestion,
  type ActiveQuestionDetectionResult,
} from "./activeQuestionDetector";
import type { LabeledUtterance, UtteranceCategory } from "@/fixtures/classifier/labeledUtterances";

/**
 * Confidence cut used to turn a detector result into a fire/no-fire decision.
 *
 * Chosen from the detector's own scoring ladder:
 *   - statement, no question form ........ 0.70 (0.5 + 0.1 len>10 + 0.1 len>20)
 *   - question form / question mark ...... 1.00 (0.5 + 0.3 + 0.1 + 0.1 + 0.2,
 *                                          then +0.15 question bonus, clamped)
 * 0.75 sits strictly between the two bands, so it rejects statements while
 * keeping every question-form utterance.
 */
export const DETECTION_CONFIDENCE_THRESHOLD = 0.75;

export interface UtteranceEvaluation {
  utterance: LabeledUtterance;
  detected: boolean;
  result: ActiveQuestionDetectionResult;
  /** Human-readable explanation of the firing decision (for evidence/FP-FN lists). */
  reason: string;
}

function decideDetection(result: ActiveQuestionDetectionResult): {
  detected: boolean;
  reason: string;
} {
  const hasQuestionText =
    result.activeQuestion.trim().length > 0 && result.cleanedQuestion.trim().length > 0;

  if (result.source === "none") {
    return { detected: false, reason: "no source (no transcript to classify)" };
  }
  if (result.ignoredNoise) {
    return { detected: false, reason: "ignoredNoise (filler/admin/suppressed)" };
  }
  if (!hasQuestionText) {
    return { detected: false, reason: "empty activeQuestion/cleanedQuestion" };
  }
  if (result.confidenceScore <= DETECTION_CONFIDENCE_THRESHOLD) {
    return {
      detected: false,
      reason: `confidence ${result.confidenceScore.toFixed(2)} <= threshold ${DETECTION_CONFIDENCE_THRESHOLD}`,
    };
  }
  return {
    detected: true,
    reason: `confidence ${result.confidenceScore.toFixed(2)} > threshold ${DETECTION_CONFIDENCE_THRESHOLD}`,
  };
}

/** Run the REAL detector over one utterance and apply the documented firing rule. */
export function evaluateUtterance(utterance: LabeledUtterance): UtteranceEvaluation {
  const result = detectActiveQuestion({
    liveInterimText: utterance.text,
    allMessages: [],
    cutoffTimestamp: 0,
  });
  const { detected, reason } = decideDetection(result);
  return { utterance, detected, result, reason };
}

export interface ConfusionMatrix {
  /** Label 1, detected. */
  tp: number;
  /** Label 0, detected. */
  fp: number;
  /** Label 1, not detected. */
  fn: number;
  /** Label 0, not detected. */
  tn: number;
}

export interface CategoryMetrics {
  category: UtteranceCategory;
  label: "positive" | "negative";
  n: number;
  /** Positives in this category (0 for negative categories). */
  positives: number;
  /** Negatives in this category (0 for positive categories). */
  negatives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Defined only when the category has actual positives. */
  recall: number | null;
  /** Defined only when the category has predicted positives. */
  precision: number | null;
  f1: number | null;
  /** For negative categories: FP / n. For positive: null. */
  falsePositiveRate: number | null;
  /** For positive categories: TP / n. For negative: null. */
  detectionRate: number | null;
}

export interface MisclassifiedUtterance {
  id: string;
  text: string;
  category: UtteranceCategory;
  confidenceScore: number;
  cleanedQuestion: string;
  reason: string;
}

export interface ClassifierMetrics {
  /** Documented confidence cut used for the decision. */
  threshold: number;
  /** Utterance-level definition of "detected" (kept in the artifact for auditability). */
  detectionDefinition: string;
  total: number;
  positives: number;
  negatives: number;
  confusion: ConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  perCategory: CategoryMetrics[];
  falsePositives: MisclassifiedUtterance[];
  falseNegatives: MisclassifiedUtterance[];
}

export const DETECTION_DEFINITION =
  'detected ⇔ source !== "none" ∧ ignoredNoise === false ∧ activeQuestion non-empty ∧ ' +
  "cleanedQuestion non-empty ∧ confidenceScore > DETECTION_CONFIDENCE_THRESHOLD (strict)";

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function nullableRatio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

const CATEGORY_ORDER: UtteranceCategory[] = [
  "direct_question",
  "indirect_question",
  "follow_up",
  "coding_discussion",
  "statement",
  "small_talk",
  "interviewer_admin",
];

export function evaluateDataset(dataset: readonly LabeledUtterance[]): UtteranceEvaluation[] {
  return dataset.map(evaluateUtterance);
}

export function computeMetrics(evaluations: readonly UtteranceEvaluation[]): ClassifierMetrics {
  const confusion: ConfusionMatrix = { tp: 0, fp: 0, fn: 0, tn: 0 };
  const byCategory = new Map<UtteranceCategory, CategoryMetrics>();
  const falsePositives: MisclassifiedUtterance[] = [];
  const falseNegatives: MisclassifiedUtterance[] = [];

  for (const category of CATEGORY_ORDER) {
    byCategory.set(category, {
      category,
      label: category.startsWith("direct_") ||
        category.startsWith("indirect_") ||
        category === "follow_up"
        ? "positive"
        : "negative",
      n: 0,
      positives: 0,
      negatives: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
      recall: null,
      precision: null,
      f1: null,
      falsePositiveRate: null,
      detectionRate: null,
    });
  }

  for (const evaluation of evaluations) {
    const { utterance, detected, result, reason } = evaluation;
    const actual = utterance.label === 1;
    const category = byCategory.get(utterance.category);
    if (!category) {
      throw new Error(`Unknown category: ${utterance.category}`);
    }
    category.n += 1;
    if (actual) category.positives += 1;
    else category.negatives += 1;

    if (actual && detected) {
      confusion.tp += 1;
      category.tp += 1;
    } else if (actual && !detected) {
      confusion.fn += 1;
      category.fn += 1;
      falseNegatives.push({
        id: utterance.id,
        text: utterance.text,
        category: utterance.category,
        confidenceScore: result.confidenceScore,
        cleanedQuestion: result.cleanedQuestion,
        reason,
      });
    } else if (!actual && detected) {
      confusion.fp += 1;
      category.fp += 1;
      falsePositives.push({
        id: utterance.id,
        text: utterance.text,
        category: utterance.category,
        confidenceScore: result.confidenceScore,
        cleanedQuestion: result.cleanedQuestion,
        reason,
      });
    } else {
      confusion.tn += 1;
      category.tn += 1;
    }
  }

  const perCategory = Array.from(byCategory.values())
    .filter((category) => category.n > 0)
    .map((category) => {
      const precision = nullableRatio(category.tp, category.tp + category.fp);
      const recall = nullableRatio(category.tp, category.tp + category.fn);
      const f1 =
        precision !== null && recall !== null && precision + recall > 0
          ? (2 * precision * recall) / (precision + recall)
          : null;
      return {
        ...category,
        precision,
        recall,
        f1,
        falsePositiveRate: nullableRatio(category.fp, category.n),
        detectionRate: nullableRatio(category.tp, category.n),
      };
    });

  const precision = ratio(confusion.tp, confusion.tp + confusion.fp);
  const recall = ratio(confusion.tp, confusion.tp + confusion.fn);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    threshold: DETECTION_CONFIDENCE_THRESHOLD,
    detectionDefinition: DETECTION_DEFINITION,
    total: evaluations.length,
    positives: confusion.tp + confusion.fn,
    negatives: confusion.tp + confusion.fp + confusion.fn + confusion.tn - (confusion.tp + confusion.fn),
    confusion,
    precision,
    recall,
    f1,
    accuracy: ratio(confusion.tp + confusion.tn, evaluations.length),
    perCategory,
    falsePositives,
    falseNegatives,
  };
}

export function evaluateLabeledDataset(dataset: readonly LabeledUtterance[]): {
  evaluations: UtteranceEvaluation[];
  metrics: ClassifierMetrics;
} {
  const evaluations = evaluateDataset(dataset);
  return { evaluations, metrics: computeMetrics(evaluations) };
}
