/**
 * Shared types and confidence bands for the pronunciation layer (G-039).
 *
 * Hard rule encoded here: a word at or above HIGH_CONFIDENCE_THRESHOLD is
 * "high confidence" and must never be rewritten by phonetic rescue or by the
 * repair pass. Both layers filter on the same predicate, and tests assert it.
 */
import type {
  AsrNBestAlternative,
  AsrWord,
  AsrWordAlternative,
} from "../../../../api-server/src/lib/mocks/types";

/** Words at or above this confidence are never touched (hard rule). */
export const HIGH_CONFIDENCE_THRESHOLD = 0.82;

/** Below this a word is in the low band (repair/gate target). */
export const LOW_CONFIDENCE_THRESHOLD = 0.62;

/** Segment confidence needed for a confident answer. */
export const SEGMENT_CONFIDENCE_THRESHOLD = 0.78;

/** Hard wall-clock budget for the targeted repair pass. */
export const REPAIR_BUDGET_MS = 150;

export type ConfidenceBand = "high" | "uncertain" | "low";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "uncertain";
  return "low";
}

export function isHighConfidence(confidence: number): boolean {
  return confidence >= HIGH_CONFIDENCE_THRESHOLD;
}

export type WordProvenance = "asr" | "derived" | "rescued" | "repaired";

/** One word with its confidence and provenance as it moves through the layer. */
export interface WordToken {
  index: number;
  /** Display text (may contain punctuation on the first/last word). */
  raw: string;
  /** Word without surrounding punctuation. */
  word: string;
  /** Lowercase letters/digits only. */
  normalized: string;
  confidence: number;
  band: ConfidenceBand;
  startMs?: number;
  endMs?: number;
  alternatives: AsrWordAlternative[];
  provenance: WordProvenance;
  /** Canonical vocabulary term this word now represents, when known. */
  canonical?: string;
}

export interface TranscriptSegment {
  segmentId: string;
  /** Text exactly as the ASR emitted it. */
  rawText: string;
  /** Current best text (starts equal to rawText). */
  text: string;
  words: WordToken[];
  alternatives?: AsrNBestAlternative[];
  language: string;
}

export interface SegmentInput {
  segmentId: string;
  text: string;
  words?: AsrWord[];
  alternatives?: AsrNBestAlternative[];
  language?: string;
}

/** Weighted mean confidence with a penalty for the share of non-high words. */
export function segmentConfidence(words: readonly WordToken[]): number {
  if (!words.length) return 0;
  const mean = words.reduce((sum, word) => sum + word.confidence, 0) / words.length;
  const lowRatio =
    words.filter((word) => !isHighConfidence(word.confidence)).length / words.length;
  return Math.max(0, Math.min(1, mean - 0.25 * lowRatio));
}
