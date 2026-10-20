/**
 * Small text helpers for the pronunciation layer (G-039).
 *
 * These keep punctuation out of the phonetic/rescue matching while allowing the
 * final question text to keep its original question mark - the question
 * detector relies on it.
 */
import type { AsrWord } from "../../../../api-server/src/lib/mocks/types";
import {
  confidenceBand,
  type WordToken,
} from "./types";

const TOKEN_WITH_PUNCT = /([A-Za-z0-9][A-Za-z0-9'’.#+/-]*)/g;

export interface SplitToken {
  /** Leading punctuation (usually empty). */
  prefix: string;
  /** Core word (letters/digits and safe internal punctuation). */
  core: string;
  /** Trailing punctuation (".", "?", ",", ...). */
  suffix: string;
}

export function splitToken(raw: string): SplitToken {
  const match = /^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’.#+/-]*)([^A-Za-z0-9]*)$/.exec(raw);
  if (!match) return { prefix: "", core: raw, suffix: "" };
  return { prefix: match[1] ?? "", core: match[2] ?? "", suffix: match[3] ?? "" };
}

export function normalizeToken(raw: string): string {
  return splitToken(raw).core.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Splits text into display words, preserving punctuation on each word. */
export function splitWords(text: string): string[] {
  return (text ?? "").trim().split(/\s+/).filter(Boolean);
}

/** Derives placeholder word tokens for an adapter without word confidence. */
export function wordsFromText(text: string): WordToken[] {
  return splitWords(text).map((raw, index) =>
    makeWordToken({
      index,
      raw,
      confidence: 0.95,
      provenance: "derived",
    }),
  );
}

export function makeWordToken(input: {
  index: number;
  raw: string;
  confidence: number;
  provenance: WordToken["provenance"];
  startMs?: number;
  endMs?: number;
  alternatives?: WordToken["alternatives"];
  canonical?: string;
}): WordToken {
  const split = splitToken(input.raw);
  const confidence = Math.max(0, Math.min(1, input.confidence));
  return {
    index: input.index,
    raw: input.raw,
    word: split.core,
    normalized: split.core.toLowerCase().replace(/[^a-z0-9]/g, ""),
    confidence,
    band: confidenceBand(confidence),
    ...(input.startMs !== undefined ? { startMs: input.startMs } : {}),
    ...(input.endMs !== undefined ? { endMs: input.endMs } : {}),
    alternatives: input.alternatives ?? [],
    provenance: input.provenance,
    ...(input.canonical ? { canonical: input.canonical } : {}),
  };
}

/** Converts ASR word confidences into internal tokens, deriving when absent. */
export function wordsFromAsr(text: string, words: AsrWord[] | undefined): WordToken[] {
  if (!words?.length) return wordsFromText(text);
  const textWords = splitWords(text);
  // If the backend collapsed/expanded whitespace, trust its own words.
  const source = words.length === textWords.length ? textWords : words.map((word) => word.word);
  return words.map((word, index) =>
    makeWordToken({
      index,
      raw: source[index] ?? word.word,
      confidence: typeof word.confidence === "number" ? word.confidence : 0.9,
      provenance: "asr",
      startMs: word.startMs,
      endMs: word.endMs,
      alternatives: word.alternatives,
    }),
  );
}

/**
 * Re-renders text from word tokens. Punctuation inside each token is preserved;
 * if the token count changed (a rescue replaced a phrase) the trailing
 * punctuation of the original text is appended so "?" survives.
 */
export function renderText(rawText: string, words: readonly WordToken[]): string {
  if (!words.length) return rawText.trim();
  const text = words.map((word) => word.raw).join(" ").replace(/\s+/g, " ").trim();
  const originalSuffix = /[?.!]+\s*$/.exec(rawText.trim())?.[0]?.trim() ?? "";
  if (originalSuffix && !/[?.!]$/.test(text)) return text + originalSuffix;
  return text;
}

/** Words whose canonical surface is included in the token sequence. */
export function findRawTokens(text: string): { token: string; start: number; end: number }[] {
  const out: { token: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(TOKEN_WITH_PUNCT.source, "g");
  while ((match = regex.exec(text)) !== null) {
    out.push({ token: match[1] ?? "", start: match.index, end: match.index + (match[1]?.length ?? 0) });
  }
  return out;
}
