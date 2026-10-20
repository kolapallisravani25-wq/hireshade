/**
 * Confidence gate (G-039).
 *
 * Decides whether the answer path may answer confidently, should hedge across
 * two readings, or should ask a short clarification. The gate is deliberately
 * conservative: a segment whose confidence is below the threshold never
 * produces a confident answer, so the assistant cannot confidently answer the
 * wrong question.
 *
 * Readings are always derived from the session vocabulary (or the literal
 * transcript), and any named entity present in the transcript is preserved
 * verbatim in the clarification text.
 */
import {
  HIGH_CONFIDENCE_THRESHOLD,
  SEGMENT_CONFIDENCE_THRESHOLD,
  isHighConfidence,
  segmentConfidence,
  type WordToken,
} from "./types";
import { renderText } from "./text";
import type { PronunciationVocabulary } from "./vocabulary";
import { normalizePhrase, resolveConfusable } from "./phonemeMap";
import { phoneticSimilarity } from "./phonetics";
import type { RescueAmbiguity } from "./rescue";

export type GateDecision = "answer" | "hedge" | "clarify";

export interface GateReading {
  text: string;
  source: "literal" | "rescued" | "vocabulary" | "homophone";
  confidence: number;
  /** Canonical term that produced this reading, when applicable. */
  term?: string;
}

export interface ConfidenceGateInput {
  segmentId: string;
  /** Original ASR top-1 text. */
  rawText: string;
  words: readonly WordToken[];
  ambiguities?: readonly RescueAmbiguity[];
  vocabulary?: PronunciationVocabulary;
  /** Session output language; the answer language never changes. */
  sessionLanguage?: string;
  threshold?: number;
}

export interface ConfidenceGateResult {
  segmentId: string;
  decision: GateDecision;
  confidence: number;
  threshold: number;
  /** Best reading, used as the question for the answer path. */
  question: string;
  readings: GateReading[];
  heard?: string;
  didYouMean?: string;
  /** Deterministic clarification sentence ("I heard X — did you mean Y?"). */
  clarificationText?: string;
  /** Deterministic hedge sentence covering every reading. */
  hedgeText?: string;
  answerLanguage: string;
  reason: string;
}

function renderReading(
  rawText: string,
  words: readonly WordToken[],
  start: number,
  end: number,
  replacement: string,
): string {
  const replaced: WordToken[] = [];
  for (let index = 0; index < words.length; index++) {
    if (index === start) {
      replaced.push({ ...words[index]!, raw: replacement, word: replacement });
    } else if (index > start && index < end) {
      // Swallowed by the phrase replacement.
      continue;
    } else {
      replaced.push(words[index]!);
    }
  }
  return renderText(rawText, replaced);
}

function literalText(rawText: string, words: readonly WordToken[]): string {
  return renderText(rawText, words);
}

/**
 * Builds the competing readings for a segment: rescue ambiguities first, then
 * unresolved homophones, then phonetically-near vocabulary terms for any
 * remaining low-confidence word.
 */
function collectReadings(input: ConfidenceGateInput, question: string): GateReading[] {
  const words = input.words;
  const readings: GateReading[] = [
    { text: question, source: "literal", confidence: segmentConfidence(words) },
  ];

  for (const ambiguity of input.ambiguities ?? []) {
    for (const [index, reading] of ambiguity.readings.entries()) {
      readings.push({
        text: renderReading(input.rawText, words, ambiguity.start, ambiguity.end, reading),
        source: "homophone",
        confidence: Math.max(0.2, (ambiguity.scores[index] ?? 0.6) * 0.9),
        term: reading,
      });
    }
  }

  const contextWords = words.map((word) => word.word);
  for (const word of words) {
    if (isHighConfidence(word.confidence)) continue;
    if (word.canonical) continue;
    const homophone = resolveConfusable(word.word, contextWords);
    if (homophone && !homophone.resolved && homophone.candidates.length >= 2) {
      for (const candidate of homophone.candidates.slice(0, 2)) {
        readings.push({
          text: renderReading(input.rawText, words, word.index, word.index + 1, candidate),
          source: "homophone",
          confidence: Math.max(0.2, word.confidence),
          term: candidate,
        });
      }
    }
  }

  // Phonetically-near vocabulary terms for still-unresolved low words.
  if (input.vocabulary) {
    for (const word of words) {
      if (isHighConfidence(word.confidence) || word.canonical) continue;
      const nearby: { canonical: string; similarity: number }[] = [];
      for (const entry of input.vocabulary.entries) {
        if (entry.normalized.includes(" ")) continue;
        const similarity = phoneticSimilarity(word.word, entry.normalized);
        if (similarity >= 0.5) nearby.push({ canonical: entry.canonical, similarity });
      }
      nearby.sort((a, b) => b.similarity - a.similarity);
      const best = nearby[0];
      if (!best) continue;
      readings.push({
        text: renderReading(input.rawText, words, word.index, word.index + 1, best.canonical),
        source: "vocabulary",
        confidence: Math.max(0.2, word.confidence + 0.2 * best.similarity),
        term: best.canonical,
      });
    }
  }

  // Dedupe by text, keeping the highest confidence first.
  const seen = new Set<string>();
  return readings.filter((reading) => {
    const key = normalizePhrase(reading.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function decideConfidenceGate(input: ConfidenceGateInput): ConfidenceGateResult {
  const threshold = input.threshold ?? SEGMENT_CONFIDENCE_THRESHOLD;
  const sessionLanguage = input.sessionLanguage ?? "en";
  const confidence = segmentConfidence(input.words);
  const question = literalText(input.rawText, input.words);
  const readings = collectReadings(input, question);
  const materialReadings = readings.slice(1);

  // A recorded rescue ambiguity always has at least two competing canonical
  // readings, even when one of them spells the transcript literally (cash vs
  // cache). Ask the clarification in that case instead of hedging.
  const primaryAmbiguity = input.ambiguities?.find((item) => item.readings.length >= 2);
  if (primaryAmbiguity) {
    const first = primaryAmbiguity.readings[0]!;
    const second = primaryAmbiguity.readings[1]!;
    const firstText = renderReading(
      input.rawText,
      input.words,
      primaryAmbiguity.start,
      primaryAmbiguity.end,
      first,
    );
    const secondText = renderReading(
      input.rawText,
      input.words,
      primaryAmbiguity.start,
      primaryAmbiguity.end,
      second,
    );
    const ambiguityReadings: GateReading[] = [
      { text: firstText, source: "homophone", confidence: primaryAmbiguity.scores[0] ?? 0.6, term: first },
      { text: secondText, source: "homophone", confidence: primaryAmbiguity.scores[1] ?? 0.6, term: second },
    ];
    return {
      segmentId: input.segmentId,
      decision: "clarify",
      confidence,
      threshold,
      question: firstText,
      readings: [readings[0]!, ...ambiguityReadings],
      heard: primaryAmbiguity.heard,
      didYouMean: first,
      clarificationText:
        'I heard: "' + primaryAmbiguity.heard + '" - did you mean "' + first + '" or "' + second + '"?',
      answerLanguage: sessionLanguage,
      reason: "low confidence " + confidence.toFixed(2) + " with competing canonical readings",
    };
  }

  if (confidence >= threshold && materialReadings.length === 0) {
    return {
      segmentId: input.segmentId,
      decision: "answer",
      confidence,
      threshold,
      question,
      readings,
      answerLanguage: sessionLanguage,
      reason: "confidence " + confidence.toFixed(2) + " >= " + threshold + "; no material ambiguity",
    };
  }

  if (materialReadings.length >= 1) {
    const heard = input.ambiguities?.[0]
      ? input.ambiguities[0].heard
      : (input.words.find((word) => !isHighConfidence(word.confidence))?.word ?? question);
    const best = materialReadings[0]!;
    const second = materialReadings[1];

    if (second) {
      const clarificationText =
        'I heard: "' + heard + '" - did you mean "' + displayReading(best) + '" or "' + displayReading(second) + '"?';
      return {
        segmentId: input.segmentId,
        decision: "clarify",
        confidence,
        threshold,
        question: best.text,
        readings,
        heard,
        didYouMean: displayReading(best),
        clarificationText,
        answerLanguage: sessionLanguage,
        reason:
          "low confidence " + confidence.toFixed(2) + " with " + materialReadings.length + " competing readings",
      };
    }

    const hedgeText =
      'I may have misheard that. I heard "' + heard + '". If you meant "' + displayReading(best) + '", I will answer that; if not, please repeat the key term.';
    return {
      segmentId: input.segmentId,
      decision: "hedge",
      confidence,
      threshold,
      question: best.text,
      readings,
      heard,
      didYouMean: displayReading(best),
      hedgeText,
      answerLanguage: sessionLanguage,
      reason: "low confidence " + confidence.toFixed(2) + " with one repaired reading",
    };
  }

  const lowBandWords = input.words.filter((word) => word.band === "low");
  if (confidence >= threshold || lowBandWords.length === 0) {
    return {
      segmentId: input.segmentId,
      decision: "answer",
      confidence,
      threshold,
      question,
      readings,
      answerLanguage: sessionLanguage,
      reason:
        confidence >= threshold
          ? "confidence " + confidence.toFixed(2) + " >= " + threshold
          : "no material ambiguity and no low-band words (mean " + confidence.toFixed(2) + ")",
    };
  }

  // Low-band words with no vocabulary alternative: never answer confidently.
  const heard = lowBandWords[0]?.word ?? question;
  return {
    segmentId: input.segmentId,
    decision: "hedge",
    confidence,
    threshold,
    question,
    readings,
    heard,
    hedgeText:
      'I want to make sure I answer the right question - I heard "' + heard + '". Can you confirm the key term?',
    answerLanguage: sessionLanguage,
    reason: "low confidence " + confidence.toFixed(2) + " with no vocabulary alternative",
  };
}

function displayReading(reading: GateReading): string {
  if (reading.term) return reading.term;
  return reading.text.trim();
}

/** True when a word may not be touched by rescue/repair (exported for tests). */
export function isProtected(word: WordToken): boolean {
  return word.confidence >= HIGH_CONFIDENCE_THRESHOLD;
}
