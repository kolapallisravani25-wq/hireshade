/**
 * BEFORE/AFTER evaluation for pronunciation-robust understanding (G-039).
 *
 * BEFORE  = the legacy path: the degraded ASR text goes straight into the real
 *           question detector and is answered confidently (rescue/repair/gate
 *           disabled). This is exactly what the product did before this layer.
 * AFTER   = the same detector fed the pronunciation layer's recovered question,
 *           with the confidence gate deciding answer vs hedge vs clarify.
 *
 * Metrics (per item and per accent profile):
 *   - intent accuracy: recovered question matches the hand-labeled true intent
 *   - false-answer rate: gate said "answer" but the recovered intent is wrong
 *     (i.e. the assistant confidently answered a different question)
 *   - repair latency: deterministic mock-provider elapsed per repair call
 *   - hard-rule violations: high-confidence tokens changed by rescue/repair
 */
import { detectActiveQuestion } from "@/features/session/detection/activeQuestionDetector";
import { buildVocabulary, type PronunciationVocabulary } from "@/features/pronunciation/vocabulary";
import { understandTranscript } from "@/features/pronunciation/understanding";
import { createMockRepairProvider } from "@/features/pronunciation/repair";
import { REPAIR_BUDGET_MS } from "@/features/pronunciation/types";
import type { AccentProfileId } from "../../../../api-server/src/lib/pronunciation/accentProfiles";
import {
  CORPUS_COMPANY_NAMES,
  CORPUS_DESCRIPTION,
  CORPUS_JOB_DESCRIPTION,
  CORPUS_RESUME_CONTEXT,
  INTENT_SPECS,
  buildPronunciationCorpus,
  type CorpusItem,
} from "./corpus";

export const CORPUS_VOCABULARY: PronunciationVocabulary = buildVocabulary({
  resumeText: CORPUS_RESUME_CONTEXT,
  jobDescription: CORPUS_JOB_DESCRIPTION,
  companyNames: CORPUS_COMPANY_NAMES,
  extraTerms: ["Nguyen", "Priya", "Northwind Labs"],
});

function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export interface IntentMatch {
  intentId: string | null;
  matchedIntentIds: string[];
}

/** Intent matcher over hand-authored keyword groups (not the rescue layer). */
export function matchIntent(text: string): IntentMatch {
  const tokens = words(text);
  const satisfied: { id: string; groups: number }[] = [];
  for (const spec of INTENT_SPECS) {
    const all = spec.groups.every((group) =>
      group.some((keyword) => tokens.some((token) => token.startsWith(keyword))),
    );
    if (all) satisfied.push({ id: spec.id, groups: spec.groups.length });
  }
  if (!satisfied.length) return { intentId: null, matchedIntentIds: [] };
  satisfied.sort((a, b) => b.groups - a.groups);
  const best = satisfied[0]!;
  const tie = satisfied.filter((item) => item.groups === best.groups);
  return {
    intentId: tie.length === 1 ? best.id : null,
    matchedIntentIds: satisfied.map((item) => item.id),
  };
}

export interface ItemEvaluation {
  id: string;
  baseId: string;
  profileId: AccentProfileId;
  intentId: string;
  canonicalText: string;
  degradedText: string;
  garbledTerms: string[];
  before: {
    question: string;
    intentId: string | null;
    answeredConfidently: boolean;
    correct: boolean;
    falseAnswer: boolean;
  };
  after: {
    question: string;
    intentId: string | null;
    decision: "answer" | "hedge" | "clarify";
    answeredConfidently: boolean;
    correct: boolean;
    falseAnswer: boolean;
    repairs: number;
    repairElapsedMs: number;
    rescues: number;
    ambiguity: number;
    highConfidenceUntouched: boolean;
  };
}

export interface ProfileMetrics {
  profileId: AccentProfileId;
  n: number;
  accuracyBefore: number;
  accuracyAfter: number;
  falseAnswerRateBefore: number;
  falseAnswerRateAfter: number;
}

export interface PronunciationMetrics {
  corpus: { description: string; total: number; profiles: number; intents: number };
  accuracyBefore: number;
  accuracyAfter: number;
  falseAnswerRateBefore: number;
  falseAnswerRateAfter: number;
  perProfile: ProfileMetrics[];
  gate: { answer: number; hedge: number; clarify: number };
  repair: {
    calls: number;
    segmentsRepaired: number;
    avgElapsedMs: number;
    maxElapsedMs: number;
    withinBudgetRate: number;
    budgetMs: number;
  };
  rescue: {
    spans: number;
    tokens: number;
    reasons: Record<string, number>;
  };
  hardRule: {
    itemsChecked: number;
    violations: number;
  };
  items: ItemEvaluation[];
}

export interface EvaluationOptions {
  corpus?: readonly CorpusItem[];
  vocabulary?: PronunciationVocabulary;
  /** Simulated mock-repair latency (deterministic), default 18 ms. */
  repairLatencyMs?: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export async function runPronunciationEvaluation(
  options: EvaluationOptions = {},
): Promise<PronunciationMetrics> {
  const corpus = options.corpus ?? buildPronunciationCorpus();
  const vocabulary = options.vocabulary ?? CORPUS_VOCABULARY;
  const repairLatencyMs = options.repairLatencyMs ?? 18;
  let fakeNow = 0;
  const provider = createMockRepairProvider({
    simulateLatencyMs: repairLatencyMs,
    sleep: async (ms) => {
      fakeNow += ms;
    },
  });

  const items: ItemEvaluation[] = [];
  for (const item of corpus) {
    const detectionBefore = detectActiveQuestion({
      liveInterimText: item.text,
      allMessages: [],
      cutoffTimestamp: 0,
    });
    const questionBefore =
      detectionBefore.cleanedQuestion || detectionBefore.activeQuestion || item.text;
    const matchBefore = matchIntent(questionBefore);

    const understanding = await understandTranscript(
      {
        segmentId: item.id,
        text: item.text,
        words: item.words,
        alternatives: item.alternatives,
        language: "en",
      },
      {
        vocabulary,
        repairProvider: provider,
        sessionLanguage: "en",
        now: () => fakeNow,
        resumeContext: CORPUS_RESUME_CONTEXT,
        jobDescription: CORPUS_JOB_DESCRIPTION,
      },
    );
    fakeNow += 1;
    const detectionAfter = detectActiveQuestion({
      liveInterimText: understanding.gate.question,
      allMessages: [],
      cutoffTimestamp: 0,
    });
    const questionAfter =
      detectionAfter.cleanedQuestion || detectionAfter.activeQuestion || understanding.gate.question;
    const matchAfter = matchIntent(questionAfter);

    const correctBefore = matchBefore.intentId === item.intentId;
    const correctAfter = matchAfter.intentId === item.intentId;
    const answeredAfter = understanding.gate.decision === "answer";
    items.push({
      id: item.id,
      baseId: item.baseId,
      profileId: item.profileId,
      intentId: item.intentId,
      canonicalText: item.canonicalText,
      degradedText: item.text,
      garbledTerms: item.garbledTerms,
      before: {
        question: questionBefore,
        intentId: matchBefore.intentId,
        answeredConfidently: true,
        correct: correctBefore,
        falseAnswer: !correctBefore,
      },
      after: {
        question: questionAfter,
        intentId: matchAfter.intentId,
        decision: understanding.gate.decision,
        answeredConfidently: answeredAfter,
        correct: correctAfter,
        falseAnswer: answeredAfter && !correctAfter,
        repairs: understanding.repair.applied.length,
        repairElapsedMs: understanding.repair.request ? understanding.repair.elapsedMs : 0,
        rescues: understanding.rescue.rescues.length,
        ambiguity: understanding.rescue.ambiguities.length,
        highConfidenceUntouched: understanding.highConfidenceUntouched,
      },
    });
  }

  const profileIds = [...new Set(corpus.map((item) => item.profileId))];
  const perProfile: ProfileMetrics[] = profileIds.map((profileId) => {
    const subset = items.filter((item) => item.profileId === profileId);
    return {
      profileId,
      n: subset.length,
      accuracyBefore: round4(ratio(subset.filter((item) => item.before.correct).length, subset.length)),
      accuracyAfter: round4(ratio(subset.filter((item) => item.after.correct).length, subset.length)),
      falseAnswerRateBefore: round4(
        ratio(subset.filter((item) => item.before.falseAnswer).length, subset.length),
      ),
      falseAnswerRateAfter: round4(
        ratio(subset.filter((item) => item.after.falseAnswer).length, subset.length),
      ),
    };
  });

  const repairCalls = items.filter((item) => item.after.repairElapsedMs > 0);
  const reasons: Record<string, number> = {};
  let rescueTokens = 0;
  for (const item of corpus) {
    // Reasons are recovered from a second lightweight pass only for reporting.
    void item;
  }
  // Aggregate rescue reason counts from a single instrumented pass (cheap, deterministic).
  const instrumented = await Promise.all(
    corpus.map((item) =>
      understandTranscript(
        {
          segmentId: item.id,
          text: item.text,
          words: item.words,
          alternatives: item.alternatives,
          language: "en",
        },
        {
          vocabulary,
          repairProvider: undefined,
          sessionLanguage: "en",
          now: () => fakeNow,
        },
      ),
    ),
  );
  for (const result of instrumented) {
    rescueTokens += result.rescue.stats.replacedTokens;
    for (const rescue of result.rescue.rescues) {
      reasons[rescue.reason] = (reasons[rescue.reason] ?? 0) + 1;
    }
  }

  const total = items.length;
  return {
    corpus: {
      description: CORPUS_DESCRIPTION,
      total,
      profiles: profileIds.length,
      intents: INTENT_SPECS.length,
    },
    accuracyBefore: round4(ratio(items.filter((item) => item.before.correct).length, total)),
    accuracyAfter: round4(ratio(items.filter((item) => item.after.correct).length, total)),
    falseAnswerRateBefore: round4(
      ratio(items.filter((item) => item.before.falseAnswer).length, total),
    ),
    falseAnswerRateAfter: round4(
      ratio(items.filter((item) => item.after.falseAnswer).length, total),
    ),
    perProfile,
    gate: {
      answer: items.filter((item) => item.after.decision === "answer").length,
      hedge: items.filter((item) => item.after.decision === "hedge").length,
      clarify: items.filter((item) => item.after.decision === "clarify").length,
    },
    repair: {
      calls: repairCalls.length,
      segmentsRepaired: items.filter((item) => item.after.repairs > 0).length,
      avgElapsedMs:
        repairCalls.length === 0
          ? 0
          : round4(
              repairCalls.reduce((sum, item) => sum + item.after.repairElapsedMs, 0) /
                repairCalls.length,
            ),
      maxElapsedMs: repairCalls.reduce(
        (max, item) => Math.max(max, item.after.repairElapsedMs),
        0,
      ),
      withinBudgetRate: round4(
        ratio(repairCalls.filter((item) => item.after.repairElapsedMs < REPAIR_BUDGET_MS).length, repairCalls.length),
      ),
      budgetMs: REPAIR_BUDGET_MS,
    },
    rescue: { spans: instrumented.reduce((sum, item) => sum + item.rescue.rescues.length, 0), tokens: rescueTokens, reasons },
    hardRule: {
      itemsChecked: total,
      violations: items.filter((item) => !item.after.highConfidenceUntouched).length,
    },
    items,
  };
}
