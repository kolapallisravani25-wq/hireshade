/**
 * Evidence renderer for the pronunciation evaluation (G-039).
 *
 * Pure functions: the CI test asserts on the numbers and, when
 * PRONUNCIATION_EVIDENCE_DIR is set, writes these artifacts from the very same
 * metrics object.
 */
import type { PronunciationMetrics } from "./evaluation";

export interface EvidenceInput {
  generatedAt: string;
  testCommand: string;
  metrics: PronunciationMetrics;
  /** Optional wall-clock probe (mock provider with no simulated latency). */
  realWallClockProbe?: { samples: number; medianMs: number; maxMs: number };
}

export function buildMetricsJson(input: EvidenceInput) {
  return {
    schema: "hireshade.pronunciation.metrics.v1",
    generatedAt: input.generatedAt,
    testCommand: input.testCommand,
    corpus: input.metrics.corpus,
    before: {
      intentAccuracy: input.metrics.accuracyBefore,
      falseAnswerRate: input.metrics.falseAnswerRateBefore,
    },
    after: {
      intentAccuracy: input.metrics.accuracyAfter,
      falseAnswerRate: input.metrics.falseAnswerRateAfter,
    },
    targets: { intentAccuracyMin: 0.92, falseAnswerRateMax: 0.03 },
    perProfile: input.metrics.perProfile,
    gate: input.metrics.gate,
    repair: input.metrics.repair,
    rescue: input.metrics.rescue,
    hardRule: input.metrics.hardRule,
    ...(input.realWallClockProbe ? { realWallClockProbe: input.realWallClockProbe } : {}),
  };
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + "%";
}

export function renderReportMarkdown(input: EvidenceInput): string {
  const metrics = input.metrics;
  const profileRows = metrics.perProfile
    .map(
      (profile) =>
        "| " +
        [
          profile.profileId,
          String(profile.n),
          pct(profile.accuracyBefore),
          pct(profile.accuracyAfter),
          pct(profile.falseAnswerRateBefore),
          pct(profile.falseAnswerRateAfter),
        ].join(" | ") +
        " |",
    )
    .join("\n");
  return [
    "# Pronunciation-robust understanding — evidence (G-039)",
    "",
    "Generated: " + input.generatedAt,
    "",
    "Command:",
    "",
    "~~~",
    input.testCommand,
    "~~~",
    "",
    "## Corpus",
    "",
    "- " + metrics.corpus.description,
    "- total utterances: **" + metrics.corpus.total + "**",
    "- accent profiles: **" + metrics.corpus.profiles + "**",
    "- hand-labeled intents: **" + metrics.corpus.intents + "**",
    "",
    "## Headline metrics",
    "",
    "| Path | Intent accuracy | False-answer rate |",
    "|---|---|---|",
    "| BEFORE (rescue/repair/gate disabled) | " + pct(metrics.accuracyBefore) + " | " + pct(metrics.falseAnswerRateBefore) + " |",
    "| AFTER (pronunciation layer on) | **" + pct(metrics.accuracyAfter) + "** | **" + pct(metrics.falseAnswerRateAfter) + "** |",
    "| Target | >= 92.0% | < 3.0% |",
    "",
    "## Per-profile",
    "",
    "| Profile | n | Accuracy before | Accuracy after | False answers before | False answers after |",
    "|---|---|---|---|---|---|",
    profileRows,
    "",
    "## Gate behaviour",
    "",
    "- answered confidently: " + metrics.gate.answer,
    "- hedge (cover both readings): " + metrics.gate.hedge,
    "- clarify (heard X — did you mean Y?): " + metrics.gate.clarify,
    "",
    "## Repair latency (targeted pass, budget " + metrics.repair.budgetMs + " ms)",
    "",
    "- repair calls: " + metrics.repair.calls,
    "- segments repaired: " + metrics.repair.segmentsRepaired,
    "- avg elapsed: " + metrics.repair.avgElapsedMs + " ms",
    "- max elapsed: " + metrics.repair.maxElapsedMs + " ms",
    "- within budget: " + pct(metrics.repair.withinBudgetRate),
    ...(input.realWallClockProbe
      ? [
          "- real wall-clock probe (no simulated latency): median " +
            input.realWallClockProbe.medianMs +
            " ms, max " +
            input.realWallClockProbe.maxMs +
            " ms over " +
            input.realWallClockProbe.samples +
            " runs",
        ]
      : []),
    "",
    "## Rescue",
    "",
    "- replaced spans: " + metrics.rescue.spans + " (" + metrics.rescue.tokens + " tokens)",
    "- by reason: " + JSON.stringify(metrics.rescue.reasons),
    "",
    "## Hard rule — high-confidence tokens untouched",
    "",
    "- utterances checked: " + metrics.hardRule.itemsChecked,
    "- violations: **" + metrics.hardRule.violations + "**",
    "",
    "## Method notes / limitations",
    "",
    "- Accent profiles are deterministic *models* of accent-conditioned ASR errors (no audio, no hosted ASR).",
    "- BEFORE disables the pronunciation layer but keeps the real question detector and its existing STT normalizer.",
    "- AFTER reuses the same detector on the recovered question; intent matching is a hand-authored keyword-group matcher, not a trained classifier.",
    "- Repair latency is measured with the deterministic mock provider (simulated network delay) plus a wall-clock probe; a real LLM will be far slower than 150 ms, which is why the pass is budgeted and falls back to rescue-only output.",
    "- Homophones (cache/cash) are resolved only when context cues decide; otherwise the gate hedges/clarifies instead of guessing.",
    "",
  ].join("\n");
}
