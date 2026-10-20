/**
 * Pronunciation-robust understanding orchestrator (G-039).
 *
 * Segment pipeline (all self-contained, no rewrite of the demo/detector):
 *
 *   ASR final (text + word confidence + n-best)
 *     -> code-switch hint (primary/secondary languages, answer language pinned)
 *     -> phonetic rescue (low-confidence tokens only, against the vocabulary)
 *     -> targeted repair pass (only if non-high confidence words remain, <150 ms)
 *     -> confidence gate (answer / hedge / clarify; never confidently wrong)
 *
 * The result exposes finalText for the existing question detector, plus the
 * gate decision and diagnostics for the overlay/demo.
 */
import type { AsrNBestAlternative, AsrWord } from "../../../../api-server/src/lib/mocks/types";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  SEGMENT_CONFIDENCE_THRESHOLD,
  isHighConfidence,
  segmentConfidence,
  type WordToken,
} from "./types";
import { renderText, wordsFromAsr } from "./text";
import type { PronunciationVocabulary } from "./vocabulary";
import {
  rescueLowConfidenceWords,
  type RescueResult,
} from "./rescue";
import {
  repairLowConfidenceSegment,
  type RepairPassResult,
  type RepairProvider,
} from "./repair";
import {
  decideConfidenceGate,
  type ConfidenceGateResult,
} from "./confidenceGate";
import { detectCodeSwitch, type CodeSwitchResult } from "./codeSwitch";

export interface PronunciationSegmentInput {
  segmentId: string;
  text: string;
  words?: AsrWord[];
  alternatives?: AsrNBestAlternative[];
  language?: string;
}

export interface PronunciationUnderstandingOptions {
  vocabulary: PronunciationVocabulary;
  repairProvider?: RepairProvider;
  priorTurns?: readonly string[];
  /** Session output language; the answer language is pinned to this. */
  sessionLanguage?: string;
  gateThreshold?: number;
  repairBudgetMs?: number;
  highConfidenceThreshold?: number;
  /** Injectable clock for deterministic latency totals. */
  now?: () => number;
  resumeContext?: string;
  jobDescription?: string;
}

export interface PronunciationUnderstandingResult {
  segmentId: string;
  rawText: string;
  /** Text downstream consumers should classify/answer (after rescue + repair). */
  finalText: string;
  words: WordToken[];
  codeSwitch: CodeSwitchResult;
  rescue: RescueResult;
  repair: RepairPassResult;
  gate: ConfidenceGateResult;
  answerLanguage: string;
  confidence: number;
  /** True when every high-confidence input word survived unchanged. */
  highConfidenceUntouched: boolean;
  lowConfidenceRemaining: number;
  elapsedMs: number;
}

export async function understandTranscript(
  input: PronunciationSegmentInput,
  options: PronunciationUnderstandingOptions,
): Promise<PronunciationUnderstandingResult> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const sessionLanguage = options.sessionLanguage ?? "en";
  const words = wordsFromAsr(input.text, input.words);
  const codeSwitch = detectCodeSwitch(input.text, sessionLanguage);
  const rescue = rescueLowConfidenceWords(words, options.vocabulary, {
    highConfidenceThreshold: options.highConfidenceThreshold,
  });

  const hasLowConfidence = rescue.words.some((word) => !isHighConfidence(word.confidence));
  let repair: RepairPassResult;
  if (hasLowConfidence && options.repairProvider) {
    repair = await repairLowConfidenceSegment(rescue.words, options.repairProvider, {
      budgetMs: options.repairBudgetMs,
      now,
      vocabulary: options.vocabulary,
      priorTurns: options.priorTurns,
      sessionLanguage,
      highConfidenceThreshold: options.highConfidenceThreshold,
      resumeContext: options.resumeContext,
      jobDescription: options.jobDescription,
    });
  } else {
    repair = {
      words: rescue.words,
      request: null,
      applied: [],
      rejected: [],
      elapsedMs: 0,
      withinBudget: true,
      timedOut: false,
      providerId: null,
      skippedHighConfidence: !hasLowConfidence,
    };
  }

  const finalWords = repair.words;
  const finalText = renderText(input.text, finalWords);
  const gate = decideConfidenceGate({
    segmentId: input.segmentId,
    rawText: input.text,
    words: finalWords,
    ambiguities: rescue.ambiguities,
    vocabulary: options.vocabulary,
    sessionLanguage,
    threshold: options.gateThreshold ?? SEGMENT_CONFIDENCE_THRESHOLD,
  });

  // Rescue refuses to touch high-confidence words in the first place, and the
  // repair applier rejects any suggestion covering one, so the rescue assertion
  // is the end-to-end hard-rule check.
  const highConfidenceUntouched = rescue.highConfidenceUntouched;

  return {
    segmentId: input.segmentId,
    rawText: input.text,
    finalText,
    words: finalWords,
    codeSwitch,
    rescue,
    repair,
    gate,
    answerLanguage: gate.answerLanguage,
    confidence: segmentConfidence(finalWords),
    highConfidenceUntouched,
    lowConfidenceRemaining: finalWords.filter((word) => !isHighConfidence(word.confidence)).length,
    elapsedMs: Math.max(0, Math.round((now() - started) * 100) / 100),
  };
}
