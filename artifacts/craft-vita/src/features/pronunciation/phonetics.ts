/**
 * Phonetic key helpers on top of the vendored Double Metaphone (G-039).
 *
 * The rescue layer never compares raw spellings for low-confidence words; it
 * compares phonetic codes plus an explicit domain vocabulary. This keeps the
 * phonetic layer dependency-free and deterministic.
 */
import { doubleMetaphone } from "./doubleMetaphone";

export interface PhoneticKeys {
  primary: string;
  secondary: string;
}

/** Strips everything but letters/digits and lowercases, for code inputs. */
export function normalizeWord(input: string): string {
  return (input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Double Metaphone primary + secondary codes for one word. */
export function phoneticKeys(input: string): PhoneticKeys {
  const [primary, secondary] = doubleMetaphone(normalizeWord(input));
  return { primary: primary ?? "", secondary: secondary ?? "" };
}

/** Primary code, falling back to the secondary when the primary is empty. */
export function phoneticKey(input: string): string {
  const keys = phoneticKeys(input);
  return keys.primary || keys.secondary;
}

/** Unique non-empty codes for a word (used for set comparison). */
export function phoneticCodeSet(input: string): string[] {
  const keys = phoneticKeys(input);
  const codes = [keys.primary, keys.secondary].filter((code): code is string => Boolean(code));
  return [...new Set(codes)];
}

/** Two words are phonetically equivalent when they share a non-empty code. */
export function phoneticallyEquivalent(a: string, b: string): boolean {
  const left = phoneticCodeSet(a);
  const right = new Set(phoneticCodeSet(b));
  return left.some((code) => right.has(code));
}

/**
 * Similarity in [0, 1] between the phonetic code sets of two words:
 * 1 = share a code, 0.5 = share the first letter of a code (weak near miss),
 * 0 = unrelated.
 */
export function phoneticSimilarity(a: string, b: string): number {
  const left = phoneticCodeSet(a);
  const right = phoneticCodeSet(b);
  if (!left.length || !right.length) return 0;
  let best = 0;
  for (const l of left) {
    for (const r of right) {
      if (l === r) return 1;
      if (l[0] && l[0] === r[0] && Math.abs(l.length - r.length) <= 1) best = Math.max(best, 0.5);
    }
  }
  return best;
}

/**
 * Phonetic key for a multi-word term: per-token primary codes joined by a
 * space. Used for whole-terminology matching (company names, "Northwind Labs").
 */
export function phoneticKeyForTerm(term: string): string {
  return term
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => phoneticKey(token))
    .join(" ");
}

/** Bounded Levenshtein distance (early-exits once max + 1 is exceeded). */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}
