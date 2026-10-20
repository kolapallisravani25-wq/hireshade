/**
 * Deterministic pronunciation-degradation engine (G-039).
 *
 * Turns a canonical interviewer transcript into the kind of output a streaming
 * ASR often returns for a non-native speaker: a top hypothesis with realistic
 * word-level confidences, one or two garbled domain terms, and an n-best list
 * whose lower-ranked hypotheses are only partially correct.
 *
 * Everything is seeded from the transcript text + profile id, so the same input
 * always produces the same degraded output. No network, no randomness beyond
 * the seeded PRNG, no audio.
 */
import type { AsrNBestAlternative, AsrWord } from "../mocks/types.js";
import {
  DEFAULT_ACCENT_PROFILE_ID,
  PROTECTED_WORDS,
  getAccentProfile,
  type AccentProfile,
  type AccentProfileId,
} from "./accentProfiles.js";

/** Canonical display form for the domain terms the profiles garble. */
export const TERM_DISPLAY: Readonly<Record<string, string>> = {
  kubernetes: "Kubernetes",
  postgres: "Postgres",
  postgresql: "PostgreSQL",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  redis: "Redis",
  graphql: "GraphQL",
  terraform: "Terraform",
  prometheus: "Prometheus",
  grafana: "Grafana",
  kafka: "Kafka",
  jwt: "JWT",
  microservices: "microservices",
  nguyen: "Nguyen",
  priya: "Priya",
  northwind: "Northwind",
  mysql: "MySQL",
  sql: "SQL",
  cache: "cache",
  typescript: "TypeScript",
  javascript: "JavaScript",
  nginx: "Nginx",
};

/** FNV-1a 32-bit hash: stable across platforms and runs. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 PRNG — small, deterministic, good enough for fixtures. */
export function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface DegradationOptions {
  /** Extra seed material (e.g. corpus item id). */
  seed?: string | number;
  /** Probability that a known domain term is garbled (default 0.72). */
  garbleChance?: number;
  /** Probability that a general accent rule fires on a content word (default 0.34). */
  ruleChance?: number;
  /** Include lower-ranked n-best hypotheses (default true). */
  includeAlternatives?: boolean;
  /** Nominal spoken duration per source word, in ms (default 380). */
  wordDurationMs?: number;
}

export interface DegradedTranscript {
  profileId: AccentProfileId;
  seed: number;
  /** Top-1 hypothesis text (what a plain ASR consumer would read). */
  text: string;
  /** Top-1 words with confidences and timings. */
  words: AsrWord[];
  /** Full n-best list (top-1 first). */
  alternatives: AsrNBestAlternative[];
  /** Canonical display forms of the terms garbled in the top hypothesis. */
  garbledTerms: string[];
  /** Number of top-1 words whose confidence is below the high band. */
  lowConfidenceWords: number;
  /** Mean confidence of the top-1 words (0..1), rounded to 2 dp. */
  meanConfidence: number;
}

interface Token {
  prefix: string;
  core: string;
  suffix: string;
}

const TOKEN_RE = /^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’.#+/-]*)([^A-Za-z0-9]*)$/;

function splitToken(raw: string): Token | null {
  const match = TOKEN_RE.exec(raw);
  if (!match) return null;
  return { prefix: match[1] ?? "", core: match[2] ?? "", suffix: match[3] ?? "" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function choose<T>(items: readonly T[], prng: () => number): T {
  return items[Math.floor(prng() * items.length)] ?? items[0]!;
}

/** Applies at most one matching general rule to a content word. */
function applyGeneralRules(
  word: string,
  profile: AccentProfile,
  prng: () => number,
  ruleChance: number,
): string | null {
  if (prng() >= ruleChance) return null;
  const matching = profile.rules.filter((rule) =>
    new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(word),
  );
  if (!matching.length) return null;
  const rule = choose(matching, prng);
  if (prng() >= rule.chance) return null;
  const next = word.replace(new RegExp(rule.pattern.source, rule.pattern.flags), rule.replacement);
  return next === word ? null : next;
}

interface PlannedWord {
  display: string;
  garbled: boolean;
  confidence: number;
  startMs: number;
  endMs: number;
}

function confFor(garbled: boolean, profile: AccentProfile, prng: () => number): number {
  const { garbledMin, garbledMax, cleanMin, cleanMax } = profile.confidence;
  if (garbled) return round2(garbledMin + prng() * (garbledMax - garbledMin));
  // A minority of clean words still land in the uncertain band.
  if (prng() < 0.12) return round2(0.7 + prng() * 0.12);
  return round2(cleanMin + prng() * (cleanMax - cleanMin));
}

export function degradeTranscript(
  text: string,
  profileId: AccentProfileId = DEFAULT_ACCENT_PROFILE_ID,
  options: DegradationOptions = {},
): DegradedTranscript {
  const profile = getAccentProfile(profileId);
  const seed = hashString(profileId + "\u0000" + text + "\u0000" + String(options.seed ?? ""));
  const prng = createPrng(seed);
  const garbleChance = options.garbleChance ?? 0.72;
  const ruleChance = options.ruleChance ?? 0.34;
  const wordDurationMs = options.wordDurationMs ?? 380;

  const rawWords = text.trim().split(/\s+/).filter(Boolean);
  const planned: PlannedWord[] = [];
  const garbledTerms: string[] = [];
  let firstGarble: { variant: string; canonical: string } | null = null;
  let cursorMs = 0;

  for (const raw of rawWords) {
    const token = splitToken(raw);
    if (!token) {
      planned.push({
        display: raw,
        garbled: false,
        confidence: 0.9,
        startMs: cursorMs,
        endMs: cursorMs + wordDurationMs,
      });
      cursorMs += wordDurationMs;
      continue;
    }

    const lower = token.core.toLowerCase();
    const termVariants = profile.termGarble[lower];
    let replacement: string | null = null;
    let canonical: string | undefined;

    if (termVariants && prng() < garbleChance) {
      const variant = choose(termVariants, prng);
      if (variant !== lower) {
        replacement = variant;
        canonical = TERM_DISPLAY[lower] ?? token.core;
        garbledTerms.push(canonical);
        if (!firstGarble) firstGarble = { variant, canonical };
      }
    } else if (!PROTECTED_WORDS.has(lower) && lower.length >= 5) {
      replacement = applyGeneralRules(token.core, profile, prng, ruleChance);
    }

    const displayPieces = (replacement ?? token.core).split(/\s+/).filter(Boolean);
    const garbled = Boolean(replacement);
    const perWordMs = Math.max(1, Math.round(wordDurationMs / displayPieces.length));

    for (let pieceIndex = 0; pieceIndex < displayPieces.length; pieceIndex++) {
      const piece = displayPieces[pieceIndex]!;
      const prefix = pieceIndex === 0 ? token.prefix : "";
      const suffix = pieceIndex === displayPieces.length - 1 ? token.suffix : "";
      planned.push({
        display: prefix + piece + suffix,
        garbled,
        confidence: confFor(garbled, profile, prng),
        startMs: cursorMs,
        endMs: cursorMs + perWordMs,
      });
      cursorMs += perWordMs;
    }
  }

  const words: AsrWord[] = planned.map((word) => ({
    word: word.display,
    confidence: word.confidence,
    startMs: word.startMs,
    endMs: word.endMs,
  }));

  const topText = planned.map((word) => word.display).join(" ");
  const lowConfidenceWords = words.filter((word) => word.confidence < 0.82).length;
  const meanConfidence =
    words.length === 0
      ? 0
      : round2(words.reduce((sum, word) => sum + word.confidence, 0) / words.length);

  const alternatives: AsrNBestAlternative[] = [
    { text: topText, confidence: round2(Math.max(0.2, meanConfidence * 0.92)) },
  ];

  if (options.includeAlternatives !== false && firstGarble) {
    const index = topText.indexOf(firstGarble.variant);
    if (index >= 0) {
      const partial =
        topText.slice(0, index) +
        firstGarble.canonical +
        topText.slice(index + firstGarble.variant.length);
      alternatives.push({ text: partial, confidence: round2(Math.max(0.15, meanConfidence * 0.7)) });
    }
  }

  return {
    profileId,
    seed,
    text: topText,
    words,
    alternatives,
    garbledTerms,
    lowConfidenceWords,
    meanConfidence,
  };
}

/** Display form for a canonical term key ("kubernetes" -> "Kubernetes"). */
export function canonicalTermDisplay(term: string): string {
  return TERM_DISPLAY[term.toLowerCase()] ?? term;
}
