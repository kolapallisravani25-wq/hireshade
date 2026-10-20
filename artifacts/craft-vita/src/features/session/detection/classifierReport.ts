/**
 * Evidence generator for the G-016 question-classifier evaluation.
 *
 * The test in classifierMetrics.test.ts is the CI gate (assertions only).
 * When CLASSIFIER_EVIDENCE_DIR is set it additionally renders:
 *   - metrics.json  (machine-readable confusion matrix + per-category + decisions)
 *   - report.md     (human-readable report with definition/method/limitations)
 *
 * Keeping the renderer pure makes the evidence reproducible from the same
 * numbers the test asserts on.
 */
import {
  DETECTION_CONFIDENCE_THRESHOLD,
  DETECTION_DEFINITION,
  type ClassifierMetrics,
  type UtteranceEvaluation,
} from "./questionDetectionEval";
import { DATASET_DESCRIPTION } from "@/fixtures/classifier/labeledUtterances";

export interface DatasetSplitEvidence {
  name: string;
  purpose: string;
  evaluations: UtteranceEvaluation[];
  metrics: ClassifierMetrics;
}

export interface EvidenceInput {
  generatedAt: string;
  main: DatasetSplitEvidence;
  holdout: DatasetSplitEvidence;
  untouched: DatasetSplitEvidence;
  testCommand: string;
}

/** Every heuristic change made for G-016, kept next to the evidence it produced. */
export const HEURISTIC_CHANGES: Array<{
  file: string;
  change: string;
  rationale: string;
}> = [
  {
    file: "src/lib/intent-detector.ts",
    change:
      "isQuestion(): replaced unanchored substring matching over 20 question words with " +
      "(a) '?' check, (b) start-word check against QUESTION_START_WORDS (wh-words, " +
      "auxiliaries, interview imperatives such as tell/walk/design/give/write/continue), " +
      "and (c) word-boundary matching for EMBEDDED_QUESTION_OPENERS.",
    rationale:
      "Substring matching made statements containing 'how'/'which'/'when'/'explain' fire " +
      "(e.g. 'My code creates a new array ... which causes re-renders', 'I explained how the " +
      "cache invalidation worked') and made unpunctuated imperatives ('Walk me through ...', " +
      "'Design a ...', 'Continue from ...', 'Write a function ...') not fire.",
  },
  {
    file: "src/features/session/detection/activeQuestionDetector.ts",
    change:
      "ADMIN_NOISE_RE rewritten to match explicit call-management phrases only; bare " +
      "device/network words (camera, mic, connection, network, latency, lag, frozen, ...) no " +
      "longer suppress a whole utterance.",
    rationale:
      "The old regex suppressed genuine technical questions such as 'How would you reduce " +
      "tail latency in this service?' or 'How do you debug a frozen UI thread?'. Added " +
      "explicit screen/audio/A-V phrases ('see my screen/cursor', 'share my screen', " +
      "'on mute', 'connection dropped', 'breaking up', 'link in the chat', 'ready to start').",
  },
  {
    file: "src/features/session/detection/activeQuestionDetector.ts",
    change:
      "Added SMALL_TALK_RE and wired it into build(): small talk is treated as noise " +
      "(ignoredNoise=true) and receives the same -0.3 confidence penalty as admin noise.",
    rationale:
      "Pleasantries phrased as questions ('how are you doing today?', \"how's your day going?\", " +
      "'how was your weekend?', 'how do you like the weather?') were confidently detected and " +
      "would have triggered an answer. Requirement: never fire on small talk.",
  },
  {
    file: "src/features/session/detection/questionDetectionEval.ts",
    change:
      "Added the evaluation harness: evaluateUtterance() calls the real detectActiveQuestion() " +
      "live_interim path and applies the documented fire rule " +
      "(source!=none ∧ !ignoredNoise ∧ non-empty activeQuestion/cleanedQuestion ∧ " +
      "confidenceScore > 0.75); computeMetrics() builds utterance-level precision/recall.",
    rationale:
      "G-016 had no labeled set and no metrics. 0.75 was chosen because the detector's own " +
      "ladder puts statements at 0.70 and question-form utterances at 1.00.",
  },
];

export const KNOWN_LIMITATIONS: string[] = [
  "Measured at single-utterance level only. Multi-sentence merged STT snapshots are exercised " +
    "by the existing detector tests but are not scored in this dataset.",
  "The untouched check set contains one residual false positive: 'Is my audio coming through?' " +
    "('audio coming through' is not yet in ADMIN_NOISE_RE). It was deliberately left unfixed " +
    "so the check set remains an honest post-freeze measurement; main-set thresholds are unaffected.",
  "Heuristics are declarative regex/word-list rules, not a trained model. The rules were derived " +
    "from the main set (and a later robustness pass informed by the holdout set); the untouched " +
    "set is the closest thing to a blind measurement here.",
  "The detector's confidence score is coarse (0.70 statement band vs 1.00 question band); the " +
    "0.75 threshold is a separating band, not a calibrated probability.",
];

/**
 * Measured BEFORE any G-016 heuristic change, with the same harness and
 * threshold. Recorded from the baseline probe run. The corpus at that moment
 * was the 115-utterance version of the main set (the five technical hard
 * positives dq-27..dq-31 were appended after the baseline was captured).
 */
export const PRE_TUNING_BASELINE = {
  corpus: "115-utterance main set (before dq-27..dq-31 were appended)",
  precision: 0.8197,
  recall: 0.8929,
  confusion: { tp: 50, fp: 11, fn: 6, tn: 48 },
};

function pct(value: number | null): string {
  return value === null ? "n/a" : (value * 100).toFixed(1) + "%";
}

function f2(value: number): string {
  return value.toFixed(4);
}

function decisionRows(evaluations: readonly UtteranceEvaluation[]): string {
  return evaluations
    .map((evaluation) => {
      const { utterance, detected, result } = evaluation;
      const verdict = utterance.label === 1 ? "question" : "non-question";
      return (
        "| " +
        [
          utterance.id,
          utterance.category,
          verdict,
          detected ? "FIRED" : "silent",
          f2(result.confidenceScore),
          result.ignoredNoise ? "yes" : "no",
          utterance.text.replace(/\|/g, "\\|"),
        ].join(" | ") +
        " |"
      );
    })
    .join("\n");
}

function splitJson(split: DatasetSplitEvidence) {
  return {
    purpose: split.purpose,
    corpus: {
      total: split.metrics.total,
      positives: split.metrics.positives,
      negatives: split.metrics.negatives,
    },
    confusionMatrix: split.metrics.confusion,
    metrics: {
      precision: split.metrics.precision,
      recall: split.metrics.recall,
      f1: split.metrics.f1,
      accuracy: split.metrics.accuracy,
    },
    perCategory: split.metrics.perCategory.map((category) => ({
      category: category.category,
      label: category.label,
      n: category.n,
      tp: category.tp,
      fp: category.fp,
      fn: category.fn,
      tn: category.tn,
      precision: category.precision,
      recall: category.recall,
      falsePositiveRate: category.falsePositiveRate,
      detectionRate: category.detectionRate,
    })),
    falsePositives: split.metrics.falsePositives,
    falseNegatives: split.metrics.falseNegatives,
    decisions: split.evaluations.map((evaluation) => ({
      id: evaluation.utterance.id,
      text: evaluation.utterance.text,
      category: evaluation.utterance.category,
      label: evaluation.utterance.label,
      detected: evaluation.detected,
      confidenceScore: evaluation.result.confidenceScore,
      ignoredNoise: evaluation.result.ignoredNoise,
      source: evaluation.result.source,
      cleanedQuestion: evaluation.result.cleanedQuestion,
      decisionReason: evaluation.reason,
    })),
  };
}

export function buildMetricsJson(input: EvidenceInput) {
  return {
    schema: "hireshade.question-classifier.metrics.v1",
    generatedAt: input.generatedAt,
    testCommand: input.testCommand,
    detector: {
      entrypoint: "detectActiveQuestion({ liveInterimText, allMessages: [], cutoffTimestamp: 0 })",
      files: [
        "artifacts/craft-vita/src/features/session/detection/activeQuestionDetector.ts",
        "artifacts/craft-vita/src/lib/intent-detector.ts",
        "artifacts/craft-vita/src/lib/semantic-classifier.ts (read for scope; not on the fire path)",
      ],
      confidenceThreshold: DETECTION_CONFIDENCE_THRESHOLD,
      detectionDefinition: DETECTION_DEFINITION,
      networkCalls: 0,
      llmCalls: 0,
    },
    corpus: {
      description: DATASET_DESCRIPTION,
      total: input.main.metrics.total,
      positives: input.main.metrics.positives,
      negatives: input.main.metrics.negatives,
      file: "artifacts/craft-vita/src/fixtures/classifier/labeledUtterances.ts",
    },
    confusionMatrix: input.main.metrics.confusion,
    metrics: {
      precision: input.main.metrics.precision,
      recall: input.main.metrics.recall,
      f1: input.main.metrics.f1,
      accuracy: input.main.metrics.accuracy,
    },
    ciAssertions: {
      precisionAtLeast: 0.85,
      recallAtLeast: 0.9,
      negativeCategoryFalsePositivesAtMost: 0,
      positiveCategoryRecallAtLeast: 0.9,
    },
    preTuningBaseline: PRE_TUNING_BASELINE,
    main: splitJson(input.main),
    holdout: splitJson(input.holdout),
    untouchedCheck: splitJson(input.untouched),
    heuristicChanges: HEURISTIC_CHANGES,
    knownLimitations: KNOWN_LIMITATIONS,
  };
}

export function renderReportMarkdown(input: EvidenceInput): string {
  const { main, holdout, untouched } = input;
  const m = main.metrics;

  const categoryRows = m.perCategory
    .map(
      (category) =>
        "| " +
        [
          category.category,
          category.label,
          category.n,
          category.tp,
          category.fp,
          category.fn,
          category.tn,
          pct(category.precision),
          pct(category.recall),
          pct(category.falsePositiveRate),
        ].join(" | ") +
        " |",
    )
    .join("\n");

  const changes = HEURISTIC_CHANGES.map(
    (entry, index) =>
      `${index + 1}. **\`${entry.file}\`** — ${entry.change}\n\n   _Why:_ ${entry.rationale}`,
  ).join("\n\n");

  const limitations = KNOWN_LIMITATIONS.map((limitation) => `- ${limitation}`).join("\n");

  const fpList =
    m.falsePositives.length === 0
      ? "_None._"
      : m.falsePositives
          .map((fp) => `- \`${fp.id}\` (${fp.category}): "${fp.text}" → conf ${f2(fp.confidenceScore)}`)
          .join("\n");

  const fnList =
    m.falseNegatives.length === 0
      ? "_None._"
      : m.falseNegatives
          .map((fn) => `- \`${fn.id}\` (${fn.category}): "${fn.text}" → conf ${f2(fn.confidenceScore)}`)
          .join("\n");

  return `# Question Classifier Evaluation (G-016)

Generated: ${input.generatedAt}
Branch: \`complete-build\` (working tree, uncommitted)
Detector: real local heuristics — **no network calls, no LLM calls**.

## 1. What is measured

The production auto-trigger path is \`detectActiveQuestion\` fed the stabilized
transcript snapshot as \`liveInterimText\` (the auto path never feeds raw interim
state). For each utterance the harness calls that exact function and records one
binary decision:

> **DETECTED** ⇔ \`source !== "none"\`
> ∧ \`ignoredNoise === false\`
> ∧ \`activeQuestion.trim() !== ""\`
> ∧ \`cleanedQuestion.trim() !== ""\`
> ∧ \`confidenceScore > ${DETECTION_CONFIDENCE_THRESHOLD}\` (strict)

Every other outcome is NOT_DETECTED. Metrics are at **utterance level**:

- **Precision** = TP / (TP + FP) — of the utterances the system fired on, how many were answerable questions.
- **Recall** = TP / (TP + FN) — of the answerable questions, how many fired.

Threshold rationale: the detector's own scoring ladder puts plain statements at
0.70 (0.5 + 0.1 length>10 + 0.1 length>20) and question-form utterances at 1.00,
so 0.75 is a documented separating band, not a calibrated probability.

## 2. Corpus

${DATASET_DESCRIPTION}

| Split | Utterances | Positives | Negatives |
|---|---|---|---|
| Main labeled set (CI assertion) | ${main.metrics.total} | ${main.metrics.positives} | ${main.metrics.negatives} |
| Holdout (generalization probe) | ${holdout.metrics.total} | ${holdout.metrics.positives} | ${holdout.metrics.negatives} |
| Untouched check (post-freeze, run once) | ${untouched.metrics.total} | ${untouched.metrics.positives} | ${untouched.metrics.negatives} |

Hard negatives in the main set: small talk (${main.metrics.perCategory.find((c) => c.category === "small_talk")?.n}), interviewer call admin (${main.metrics.perCategory.find((c) => c.category === "interviewer_admin")?.n}), candidate statements (${main.metrics.perCategory.find((c) => c.category === "statement")?.n}), coding discussion (${main.metrics.perCategory.find((c) => c.category === "coding_discussion")?.n}).
Hard positives: unpunctuated indirect questions (${main.metrics.perCategory.find((c) => c.category === "indirect_question")?.n}) and follow-ups (${main.metrics.perCategory.find((c) => c.category === "follow_up")?.n}).

## 3. Result — main labeled set

| Metric | Value | Required |
|---|---|---|
| Precision | **${f2(m.precision)}** (${pct(m.precision)}) | ≥ 0.85 |
| Recall | **${f2(m.recall)}** (${pct(m.recall)}) | ≥ 0.90 |
| F1 | ${f2(m.f1)} | — |
| Accuracy | ${f2(m.accuracy)} (${pct(m.accuracy)}) | — |

**PASS.**

### Before vs after tuning (same harness, same threshold)

| Corpus | Precision | Recall | TP | FP | FN | TN |
|---|---|---|---|---|---|---|
| ${PRE_TUNING_BASELINE.corpus} | ${f2(PRE_TUNING_BASELINE.precision)} | ${f2(PRE_TUNING_BASELINE.recall)} | ${PRE_TUNING_BASELINE.confusion.tp} | ${PRE_TUNING_BASELINE.confusion.fp} | ${PRE_TUNING_BASELINE.confusion.fn} | ${PRE_TUNING_BASELINE.confusion.tn} |
| Main set after tuning (${m.total} utterances) | ${f2(m.precision)} | ${f2(m.recall)} | ${m.confusion.tp} | ${m.confusion.fp} | ${m.confusion.fn} | ${m.confusion.tn} |

The baseline row is a recorded measurement, not a reconstruction: it was captured
with the same evaluate/harness/threshold before any rule change (11 false
positives: embedded question words in statements, small talk, admin; 6 false
negatives: unpunctuated imperatives such as "Walk me through ..." and "Design a ...").
The five extra utterances in the final corpus were added afterwards to cover
technical questions that the old admin regex suppressed.

### Confusion matrix (rows = ground truth, columns = prediction)

|  | Predicted question | Predicted non-question |
|---|---|---|
| **Actual question** | TP = ${m.confusion.tp} | FN = ${m.confusion.fn} |
| **Actual non-question** | FP = ${m.confusion.fp} | TN = ${m.confusion.tn} |

### Per-category breakdown

| Category | Polarity | N | TP | FP | FN | TN | Precision | Recall | FP rate |
|---|---|---|---|---|---|---|---|---|---|
${categoryRows}

Every negative category has a 0% false-positive rate on the main set, including
small talk and interviewer admin — \`ignoredNoise\` blocks them before confidence
is considered.

False positives on the main set: ${fpList}

False negatives on the main set: ${fnList}

### Secondary splits (not CI gates on their own)

| Split | Precision | Recall | F1 | FP | FN |
|---|---|---|---|---|---|
| Holdout | ${f2(holdout.metrics.precision)} | ${f2(holdout.metrics.recall)} | ${f2(holdout.metrics.f1)} | ${holdout.metrics.confusion.fp} | ${holdout.metrics.confusion.fn} |
| Untouched check | ${f2(untouched.metrics.precision)} | ${f2(untouched.metrics.recall)} | ${f2(untouched.metrics.f1)} | ${untouched.metrics.confusion.fp} | ${untouched.metrics.confusion.fn} |

The holdout set is *pseudo-independent*: its first pass surfaced two small-talk
gaps and one admin gap that were then fixed, so it is reported as a robustness
probe. The untouched check set was authored and evaluated only after all rules
were frozen; its single residual false positive is documented below.

## 4. Heuristic changes (minimal, no LLM, no network)

${changes}

## 5. Known limitations

${limitations}

## 6. Reproduction

\`\`\`bash
# CI gate (assertions only)
cd artifacts/craft-vita
pnpm exec vitest run src/features/session/detection/classifierMetrics.test.ts

# Regenerate this report + metrics.json
CLASSIFIER_EVIDENCE_DIR=../../docs/evidence/classifier pnpm exec vitest run src/features/session/detection/classifierMetrics.test.ts

# Whole frontend suite (must stay green)
pnpm --dir artifacts/craft-vita test
\`\`\`

## 7. Per-utterance decisions (main set)

| ID | Category | Expected | Decision | Confidence | Ignored as noise | Utterance |
|---|---|---|---|---|---|---|
${decisionRows(main.evaluations)}
`;
}
