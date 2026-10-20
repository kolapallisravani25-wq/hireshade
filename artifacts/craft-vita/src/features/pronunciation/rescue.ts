/**
 * Phonetic rescue for low-confidence tokens (G-039).
 *
 * HARD RULE: a word at or above HIGH_CONFIDENCE_THRESHOLD is never rewritten
 * here, and never participates in a multi-word phrase rewrite. Only lower-
 * confidence words are matched - first as phrases against the session
 * vocabulary / known decoder confusions, then as single words by
 *   1. exact known-variant match (the strongest signal),
 *   2. Double Metaphone equivalence,
 *   3. bounded edit distance,
 *   4. homophone context resolution ("cash" near "invalidate" -> cache),
 *   5. n-best alternatives supplied by the ASR.
 *
 * Every replacement is drawn from the session vocabulary. Competing readings
 * above the ambiguity gap are reported instead of guessed.
 */
import {
  HIGH_CONFIDENCE_THRESHOLD,
  isHighConfidence,
  type WordToken,
} from "./types";
import { makeWordToken } from "./text";
import type { PronunciationVocabulary, VocabularyEntry } from "./vocabulary";
import { normalizePhrase, domainTermsForVariant, resolveConfusable } from "./phonemeMap";
import { editDistance, phoneticKey, phoneticSimilarity } from "./phonetics";

export type RescueReason =
  | "exact_vocabulary"
  | "variant"
  | "phonetic"
  | "n_best"
  | "homophone_context";

export interface RescueOptions {
  highConfidenceThreshold?: number;
  /** Minimum candidate score to accept a replacement (default 0.72). */
  minScore?: number;
  /** Two readings closer than this are ambiguous and are not applied (0.04). */
  ambiguityGap?: number;
  /** Maximum words in a single phrase replacement (default 4). */
  maxPhraseLength?: number;
  /** Edit-distance budget for one token (default 2). */
  maxEditDistance?: number;
}

export interface TokenRescue {
  /** Word index span in the input array (inclusive start, exclusive end). */
  start: number;
  end: number;
  original: string;
  replacement: string;
  canonical: string;
  score: number;
  reason: RescueReason;
  confidenceBefore: number;
  confidenceAfter: number;
}

export interface RescueAmbiguity {
  start: number;
  end: number;
  heard: string;
  readings: string[];
  scores: number[];
}

export interface RescueStats {
  tokens: number;
  highConfidenceTokens: number;
  lowConfidenceTokens: number;
  replacedSpans: number;
  replacedTokens: number;
  recognisedUnchanged: number;
  nBestUsed: number;
  phraseMatches: number;
}

export interface RescueResult {
  words: WordToken[];
  rescues: TokenRescue[];
  ambiguities: RescueAmbiguity[];
  /** True when no input high-confidence word was changed (always asserted). */
  highConfidenceUntouched: boolean;
  stats: RescueStats;
}

interface Candidate {
  canonical: string;
  score: number;
  reason: RescueReason;
  entry?: VocabularyEntry;
  nBest?: boolean;
}

const RESCUED_CONFIDENCE = 0.88;

function candidateKey(candidate: Candidate): string {
  return candidate.canonical.toLowerCase();
}

function addCandidate(list: Candidate[], candidate: Candidate): void {
  const existing = list.find((item) => candidateKey(item) === candidateKey(candidate));
  if (!existing) {
    list.push(candidate);
    return;
  }
  if (candidate.score > existing.score) {
    existing.score = candidate.score;
    existing.reason = candidate.reason;
    existing.entry = candidate.entry ?? existing.entry;
    existing.nBest = candidate.nBest ?? existing.nBest;
  }
}

function phraseEntries(
  vocabulary: PronunciationVocabulary,
  phrase: string,
): readonly VocabularyEntry[] {
  return [
    ...(vocabulary.variants.get(phrase) ?? []),
    ...(vocabulary.byNormalized.get(phrase) ?? []),
  ].filter((entry, index, all) => all.indexOf(entry) === index);
}

function tokenCandidates(
  token: WordToken,
  context: readonly WordToken[],
  vocabulary: PronunciationVocabulary,
  options: Required<RescueOptions>,
): { candidates: Candidate[]; homophone: ReturnType<typeof resolveConfusable> } {
  const candidates: Candidate[] = [];
  const normalized = normalizePhrase(token.word);
  if (!normalized) return { candidates, homophone: null };

  // 1. Known decoder confusion / vocabulary alias.
  for (const entry of phraseEntries(vocabulary, normalized)) {
    addCandidate(candidates, {
      canonical: entry.canonical,
      score: 0.97,
      reason: entry.normalized === normalized ? "exact_vocabulary" : "variant",
      entry,
    });
  }
  for (const term of domainTermsForVariant(normalized)) {
    addCandidate(candidates, { canonical: term.canonical, score: 0.96, reason: "variant" });
  }
  // Exact surface recognition: canonical casing is applied, spelling is not changed.
  for (const entry of vocabulary.byNormalized.get(normalized) ?? []) {
    addCandidate(candidates, {
      canonical: entry.canonical,
      score: 0.99,
      reason: "exact_vocabulary",
      entry,
    });
  }

  // 2. Double Metaphone equivalence against single-token vocabulary entries.
  const key = phoneticKey(token.word);
  if (key) {
    for (const entry of vocabulary.byPhonetic.get(key) ?? []) {
      if (entry.normalized.includes(" ")) continue;
      const similarity = phoneticSimilarity(token.word, entry.normalized);
      if (similarity < 1) continue;
      addCandidate(candidates, {
        canonical: entry.canonical,
        score: 0.9,
        reason: "phonetic",
        entry,
      });
    }
  }

  // 3. Bounded edit distance (only for reasonably long words).
  if (normalized.length >= 4) {
    const maxDistance = options.maxEditDistance;
    for (const entry of vocabulary.entries) {
      if (entry.normalized.includes(" ")) continue;
      if (Math.abs(entry.normalized.length - normalized.length) > maxDistance) continue;
      const distance = editDistance(normalized, entry.normalized, maxDistance);
      if (distance === 0 || distance > maxDistance) continue;
      addCandidate(candidates, {
        canonical: entry.canonical,
        score: 0.82 - 0.12 * distance,
        reason: "phonetic",
        entry,
      });
    }
  }

  // 4. Homophone context resolution (cache/cash, SQL/sequel families).
  const contextWords = context
    .filter((word) => word.index !== token.index)
    .map((word) => word.word);
  const homophone = resolveConfusable(token.word, contextWords);
  if (homophone) {
    if (homophone.resolved) {
      addCandidate(candidates, {
        canonical: homophone.resolved,
        score: 0.99,
        reason: "homophone_context",
      });
      for (const candidate of candidates) {
        if (candidateKey(candidate) !== candidateKey({ canonical: homophone.resolved, score: 0, reason: "exact_vocabulary" })) {
          candidate.score = Math.min(candidate.score, 0.86);
        }
      }
    }
  }

  // 5. n-best alternatives supplied by the ASR.
  for (const alternative of token.alternatives) {
    const alt = normalizePhrase(alternative.word);
    if (!alt || alt === normalized) continue;
    for (const entry of phraseEntries(vocabulary, alt)) {
      addCandidate(candidates, {
        canonical: entry.canonical,
        score: 0.9 * Math.min(1, Math.max(0, alternative.confidence + 0.2)),
        reason: "n_best",
        entry,
        nBest: true,
      });
    }
    for (const term of domainTermsForVariant(alt)) {
      addCandidate(candidates, { canonical: term.canonical, score: 0.88, reason: "n_best", nBest: true });
    }
  }

  return { candidates, homophone };
}

function normalizeRescueOptions(options: RescueOptions = {}): Required<RescueOptions> {
  return {
    highConfidenceThreshold: options.highConfidenceThreshold ?? HIGH_CONFIDENCE_THRESHOLD,
    minScore: options.minScore ?? 0.72,
    ambiguityGap: options.ambiguityGap ?? 0.04,
    maxPhraseLength: options.maxPhraseLength ?? 4,
    maxEditDistance: options.maxEditDistance ?? 2,
  };
}

export function rescueLowConfidenceWords(
  inputWords: readonly WordToken[],
  vocabulary: PronunciationVocabulary,
  options: RescueOptions = {},
): RescueResult {
  const opts = normalizeRescueOptions(options);
  const context = [...inputWords];
  const rescues: TokenRescue[] = [];
  const ambiguities: RescueAmbiguity[] = [];
  const out: WordToken[] = [];
  const stats: RescueStats = {
    tokens: inputWords.length,
    highConfidenceTokens: 0,
    lowConfidenceTokens: 0,
    replacedSpans: 0,
    replacedTokens: 0,
    recognisedUnchanged: 0,
    nBestUsed: 0,
    phraseMatches: 0,
  };

  let index = 0;
  while (index < inputWords.length) {
    const word = inputWords[index]!;
    if (isHighConfidence(word.confidence)) {
      stats.highConfidenceTokens += 1;
      out.push(word);
      index += 1;
      continue;
    }
    stats.lowConfidenceTokens += 1;

    // Phrase-first: longest span of non-high words that matches a known alias.
    let matched = false;
    const maxSpan = Math.min(opts.maxPhraseLength, inputWords.length - index);
    for (let span = maxSpan; span >= 2; span--) {
      const slice = inputWords.slice(index, index + span);
      if (slice.some((item) => isHighConfidence(item.confidence))) continue;
      const phrase = normalizePhrase(slice.map((item) => item.word).join(" "));
      if (!phrase) continue;
      const entries = phraseEntries(vocabulary, phrase);
      const direct = domainTermsForVariant(phrase);
      const canonical =
        [...entries].sort((a, b) => b.weight - a.weight)[0]?.canonical ?? direct[0]?.canonical;
      if (!canonical) continue;
      const replacementPieces = canonical.split(/\s+/);
      const prefix = splitPrefix(slice[0]!.raw);
      const suffix = splitSuffix(slice[span - 1]!.raw);
      let replacementIndex = 0;
      for (const piece of replacementPieces) {
        out.push(
          makeWordToken({
            index: out.length,
            raw:
              (replacementIndex === 0 ? prefix : "") +
              piece +
              (replacementIndex === replacementPieces.length - 1 ? suffix : ""),
            confidence: RESCUED_CONFIDENCE,
            provenance: "rescued",
            canonical,
          }),
        );
        replacementIndex += 1;
      }
      const confidenceBefore =
        slice.reduce((sum, item) => sum + item.confidence, 0) / slice.length;
      rescues.push({
        start: index,
        end: index + span,
        original: slice.map((item) => item.word).join(" "),
        replacement: canonical,
        canonical,
        score: 0.96,
        reason: entries.some((entry) => entry.normalized === phrase)
          ? "exact_vocabulary"
          : "variant",
        confidenceBefore,
        confidenceAfter: RESCUED_CONFIDENCE,
      });
      stats.replacedSpans += 1;
      stats.replacedTokens += span;
      stats.phraseMatches += 1;
      index += span;
      matched = true;
      break;
    }
    if (matched) continue;

    // Single token.
    const { candidates } = tokenCandidates(word, context, vocabulary, opts);
    const usable = candidates
      .filter((candidate) => candidate.score >= opts.minScore)
      .sort((a, b) => b.score - a.score);
    if (!usable.length) {
      out.push(word);
      index += 1;
      continue;
    }
    const best = usable[0]!;
    const runnerUp = usable.find(
      (candidate) =>
        candidateKey(candidate) !== candidateKey(best) &&
        best.score - candidate.score <= opts.ambiguityGap,
    );
    if (runnerUp) {
      ambiguities.push({
        start: index,
        end: index + 1,
        heard: word.word,
        readings: [best.canonical, runnerUp.canonical],
        scores: [best.score, runnerUp.score],
      });
      out.push(word);
      index += 1;
      continue;
    }
    const isSameSurface =
      normalizePhrase(best.canonical) === normalizePhrase(word.word) ||
      normalizePhrase(best.canonical) === normalizePhrase(word.raw);
    if (isSameSurface) {
      // Recognised but not respelled: keep the decoder's spelling, record canonical.
      out.push({ ...word, canonical: best.canonical });
      stats.recognisedUnchanged += 1;
      index += 1;
      continue;
    }
    out.push(
      makeWordToken({
        index: out.length,
        raw: splitPrefix(word.raw) + best.canonical + splitSuffix(word.raw),
        confidence: RESCUED_CONFIDENCE,
        provenance: "rescued",
        startMs: word.startMs,
        endMs: word.endMs,
        canonical: best.canonical,
      }),
    );
    rescues.push({
      start: index,
      end: index + 1,
      original: word.word,
      replacement: best.canonical,
      canonical: best.canonical,
      score: Math.round(best.score * 100) / 100,
      reason: best.reason,
      confidenceBefore: word.confidence,
      confidenceAfter: RESCUED_CONFIDENCE,
    });
    if (best.nBest) stats.nBestUsed += 1;
    stats.replacedSpans += 1;
    stats.replacedTokens += 1;
    index += 1;
  }

  const reindexed = out.map((word, wordIndex) => ({ ...word, index: wordIndex }));
  return {
    words: reindexed,
    rescues,
    ambiguities,
    highConfidenceUntouched: highConfidenceUntouched(inputWords, reindexed, opts),
    stats,
  };
}

function splitPrefix(raw: string): string {
  return /^([^A-Za-z0-9]*)/.exec(raw)?.[1] ?? "";
}

function splitSuffix(raw: string): string {
  return /([^A-Za-z0-9]*)$/.exec(raw)?.[1] ?? "";
}

/**
 * Verifies the hard rule mechanically: every input word at/above the threshold
 * must still exist in the output with the same raw text, same confidence and
 * ASR provenance.
 */
export function highConfidenceUntouched(
  before: readonly WordToken[],
  after: readonly WordToken[],
  options: Pick<Required<RescueOptions>, "highConfidenceThreshold">,
): boolean {
  const outputCounts = new Map<string, number>();
  for (const word of after) {
    if (word.provenance !== "asr") continue;
    const key = word.raw + "\u0000" + word.confidence;
    outputCounts.set(key, (outputCounts.get(key) ?? 0) + 1);
  }
  for (const word of before) {
    if (word.confidence < options.highConfidenceThreshold) continue;
    const key = word.raw + "\u0000" + word.confidence;
    const count = outputCounts.get(key) ?? 0;
    if (count <= 0) return false;
    outputCounts.set(key, count - 1);
  }
  return true;
}
