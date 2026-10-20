/**
 * Session vocabulary builder (G-039).
 *
 * Builds the decoder/pronunciation vocabulary from the material a HireShade
 * session actually has: the resume context, the job description, company names,
 * plus the bundled technology jargon. Entries are deduped by normalized phrase,
 * carry canonical casing, weighted sources and Double Metaphone keys, and are
 * indexed for phonetic rescue.
 */
import type { AsrKeywordBoost } from "../../../../api-server/src/lib/mocks/types";
import {
  DOMAIN_TERMS,
  GARBLE_VARIANT_INDEX,
  normalizePhrase,
  type DomainTermKind,
} from "./phonemeMap";
import { normalizeWord, phoneticKeyForTerm } from "./phonetics";

export type VocabularySource = "resume" | "job" | "company" | "tech" | "user";

export interface VocabularyEntry {
  /** Display spelling used when a rescue/repair replaces a token. */
  canonical: string;
  /** Lowercase, punctuation-free phrase used for dedupe and lookup. */
  normalized: string;
  source: VocabularySource;
  /** Weight in [0.5, 2]: higher wins ties during rescue. */
  weight: number;
  /** Double Metaphone key for the whole phrase (space separated). */
  phonetic: string;
  /** Normalized alternative spellings (canonical + known confusions). */
  aliases: string[];
  kind: DomainTermKind | "unknown";
}

export interface VocabularyInput {
  resumeText?: string;
  jobDescription?: string;
  companyNames?: readonly string[];
  /** Extra terms the caller already knows (person names from prior turns, etc). */
  extraTerms?: readonly string[];
  /** Upper bound on vocabulary size (default 400, ordered by weight). */
  maxEntries?: number;
}

export interface PronunciationVocabulary {
  entries: PronunciationEntryList;
  /** normalized phrase -> entries */
  byNormalized: ReadonlyMap<string, readonly VocabularyEntry[]>;
  /** Double Metaphone key -> entries */
  byPhonetic: ReadonlyMap<string, readonly VocabularyEntry[]>;
  /** normalized alias phrase (spaces preserved) -> entries */
  variants: ReadonlyMap<string, readonly VocabularyEntry[]>;
  /** Canonical terms suitable for ASR keyword boosting. */
  keywords: AsrKeywordBoost[];
  /** Source counts for diagnostics/evidence. */
  sourceCounts: Readonly<Record<VocabularySource, number>>;
}

type PronunciationEntryList = readonly VocabularyEntry[];

/** Interview jargon that is not a vendor name but is still worth boosting. */
export const TECH_JARGON: readonly string[] = [
  "rate limiter", "rate limiting", "sliding window", "token bucket", "event loop",
  "distributed system", "distributed systems", "message queue", "load balancer",
  "reverse proxy", "system design", "cache invalidation", "cache hit", "cache miss",
  "index", "composite index", "btree", "schema migration", "transaction", "idempotency",
  "backpressure", "observability", "latency", "throughput", "scalability",
  "concurrency", "consistency", "availability", "partition tolerance", "sharding",
  "replication", "failover", "circuit breaker", "retry", "exponential backoff",
  "event-driven", "monolith", "microservices", "serverless", "container",
  "orchestration", "deployment pipeline", "continuous integration", "continuous delivery",
  "observability", "alerting", "tracing", "metrics", "logging", "authentication",
  "authorization", "session token", "refresh token", "access token", "encryption",
  "hashing", "signing", "webhook", "idempotent webhook", "pagination", "cursor",
  "n plus one", "orm", "query planner", "deadlock", "isolation level",
  "saga", "two phase commit", "eventual consistency", "leader election", "consensus",
  "rate limit", "feature flag", "blue green deployment", "canary", "rollback",
  "infrastructure as code", "observability signal", "red method", "use method",
  "garbage collection", "memory leak", "thread pool", "async await", "promise",
  "virtual dom", "reconciliation", "state management", "component lifecycle",
  "generics", "type inference", "tree shaking", "bundler", "dependency injection",
  "solid principles", "cap theorem", "big o", "time complexity", "space complexity",
];

const SOURCE_WEIGHT: Record<VocabularySource, number> = {
  company: 1.6,
  resume: 1.3,
  job: 1.1,
  user: 1.2,
  tech: 1,
};

const RESUME_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "my", "our", "we", "i", "this", "that", "these",
  "those", "recent", "work", "worked", "working", "experience", "senior", "junior",
  "engineer", "engineering", "team", "teams", "company", "role", "project",
  "projects", "built", "designed", "added", "led", "using", "with", "for", "at",
  "in", "on", "of", "to", "from", "about", "years", "year", "month", "months",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "present", "current",
]);

function titleCaseFromRaw(raw: string): string {
  return raw
    .split(/\s+/)
    .map((token) =>
      token.length <= 3 && token === token.toUpperCase()
        ? token
        : token.charAt(0).toUpperCase() + token.slice(1),
    )
    .join(" ");
}

function canonicalForDomain(term: string): string | undefined {
  const normalized = normalizePhrase(term);
  for (const domain of DOMAIN_TERMS) {
    if (normalizePhrase(domain.canonical) === normalized) return domain.canonical;
    if (domain.keys.some((key) => normalizePhrase(key) === normalized)) return domain.canonical;
  }
  return undefined;
}

function domainKind(term: string): DomainTermKind | "unknown" {
  const normalized = normalizePhrase(term);
  for (const domain of DOMAIN_TERMS) {
    if (
      normalizePhrase(domain.canonical) === normalized ||
      domain.keys.some((key) => normalizePhrase(key) === normalized)
    ) {
      return domain.kind;
    }
  }
  return "unknown";
}

interface Candidate {
  canonical: string;
  source: VocabularySource;
  weight: number;
}

function extractProperPhrases(text: string | undefined): string[] {
  if (!text?.trim()) return [];
  const matches = text.match(/\b[A-Z][A-Za-z0-9.+#/-]*(?:\s+[A-Z][A-Za-z0-9.+#/-]*){0,2}\b/g) ?? [];
  const out: string[] = [];
  for (const match of matches) {
    const trimmed = match.trim();
    const normalized = normalizePhrase(trimmed);
    if (!normalized) continue;
    const words = normalized.split(" ");
    if (words.some((word) => RESUME_STOPWORDS.has(word))) continue;
    if (words.every((word) => word.length <= 1)) continue;
    if (words.length > 3) continue;
    // Drop pure month/weekday/proficiency noise.
    if (/^[0-9]+$/.test(normalized)) continue;
    out.push(trimmed);
  }
  return out;
}

function aliasSet(canonical: string): string[] {
  const normalized = normalizePhrase(canonical);
  const aliases = new Set<string>([normalized]);
  for (const domain of DOMAIN_TERMS) {
    if (normalizePhrase(domain.canonical) !== normalized) continue;
    for (const key of domain.keys) aliases.add(normalizePhrase(key));
    for (const variant of domain.variants) aliases.add(normalizePhrase(variant));
  }
  for (const [variant, terms] of GARBLE_VARIANT_INDEX) {
    if (terms.some((term) => normalizePhrase(term.canonical) === normalized)) aliases.add(variant);
  }
  return [...aliases].filter(Boolean);
}

export function buildVocabulary(input: VocabularyInput = {}): PronunciationVocabulary {
  const maxEntries = input.maxEntries ?? 400;
  const candidates = new Map<string, Candidate>();

  const add = (raw: string, source: VocabularySource, weightBump = 0): void => {
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed) return;
    const normalized = normalizePhrase(trimmed);
    if (!normalized || normalized.length < 2) return;
    const canonical = canonicalForDomain(trimmed) ?? titleCaseFromRaw(trimmed);
    const existing = candidates.get(normalized);
    const weight = SOURCE_WEIGHT[source] + weightBump;
    if (!existing) {
      candidates.set(normalized, { canonical, source, weight });
      return;
    }
    existing.weight = Math.min(2.5, Math.max(existing.weight, weight) + 0.1);
    // Domain/company casing wins over resume casing.
    if (SOURCE_WEIGHT[source] > SOURCE_WEIGHT[existing.source]) {
      existing.canonical = canonical;
      existing.source = source;
    }
  };

  // 1. Bundled technology jargon and the known domain terms.
  for (const term of DOMAIN_TERMS) add(term.canonical, "tech", 0.3);
  for (const term of TECH_JARGON) add(term, "tech");

  // 2. Company names are the strongest session-specific signal.
  for (const company of input.companyNames ?? []) add(company, "company", 0.4);

  // 3. Resume/JD proper phrases + explicit extra terms.
  for (const phrase of extractProperPhrases(input.resumeText)) add(phrase, "resume");
  for (const phrase of extractProperPhrases(input.jobDescription)) add(phrase, "job");
  for (const term of input.extraTerms ?? []) add(term, "user", 0.3);

  // 4. Technology terms that appear in the resume/JD but were not proper nouns.
  const sessionBlob = normalizePhrase(
    [input.resumeText, input.jobDescription, ...(input.companyNames ?? []), ...(input.extraTerms ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  if (sessionBlob) {
    for (const term of DOMAIN_TERMS) {
      if (sessionBlob.includes(normalizePhrase(term.canonical))) add(term.canonical, "tech", 0.2);
    }
    for (const term of TECH_JARGON) {
      if (sessionBlob.includes(normalizePhrase(term))) add(term, "tech", 0.1);
    }
  }

  const entries: VocabularyEntry[] = [...candidates.entries()]
    .map(([normalized, candidate]) => ({
      canonical: candidate.canonical,
      normalized,
      source: candidate.source,
      weight: Math.round(candidate.weight * 100) / 100,
      phonetic: phoneticKeyForTerm(normalized),
      aliases: aliasSet(candidate.canonical),
      kind: domainKind(candidate.canonical),
    }))
    .sort((a, b) => b.weight - a.weight || a.normalized.localeCompare(b.normalized))
    .slice(0, maxEntries);

  const byNormalized = new Map<string, VocabularyEntry[]>();
  const byPhonetic = new Map<string, VocabularyEntry[]>();
  const variants = new Map<string, VocabularyEntry[]>();
  const sourceCounts: Record<VocabularySource, number> = {
    resume: 0,
    job: 0,
    company: 0,
    tech: 0,
    user: 0,
  };

  const push = (map: Map<string, VocabularyEntry[]>, key: string, entry: VocabularyEntry): void => {
    if (!key) return;
    const bucket = map.get(key) ?? [];
    if (!bucket.includes(entry)) bucket.push(entry);
    map.set(key, bucket);
  };

  for (const entry of entries) {
    sourceCounts[entry.source] += 1;
    push(byNormalized, entry.normalized, entry);
    push(byPhonetic, entry.phonetic, entry);
    for (const alias of entry.aliases) push(variants, alias, entry);
  }

  const keywords: AsrKeywordBoost[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.normalized.split(" ").length > 3) continue;
    const key = normalizeWord(entry.canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const boost =
      entry.kind === "company" || entry.kind === "person" ? 3 : entry.kind === "unknown" ? 2 : 3;
    keywords.push({ term: entry.canonical, boost });
    if (keywords.length >= 60) break;
  }

  return { entries, byNormalized, byPhonetic, variants, keywords, sourceCounts };
}

/** Convenience for a session: resume + JD + company + person names. */
export function buildSessionVocabulary(input: VocabularyInput): PronunciationVocabulary {
  return buildVocabulary(input);
}

/** Look up exact/normalized vocabulary entries for a token. */
export function lookupVocabulary(
  vocabulary: PronunciationVocabulary,
  token: string,
): readonly VocabularyEntry[] {
  const normalized = normalizePhrase(token);
  if (!normalized) return [];
  return [
    ...(vocabulary.byNormalized.get(normalized) ?? []),
    ...(vocabulary.variants.get(normalized) ?? []),
  ].filter((entry, index, all) => all.indexOf(entry) === index);
}
