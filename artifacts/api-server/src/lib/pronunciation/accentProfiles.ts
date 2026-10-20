/**
 * Accent profiles for pronunciation-degradation simulation (G-039).
 *
 * These are *modelled* accent-conditioned substitutions, not recordings or
 * acoustic models. They exist so the pronunciation rescue/repair layer can be
 * exercised deterministically against realistic low-confidence ASR output:
 * known domain terms are garbled the way non-native speakers of four accent
 * backgrounds tend to be transcribed, and every substitution is paired with a
 * plausible low decoder confidence.
 *
 * The profiles deliberately only garble words away from the question stem
 * ("how/what/why/explain/...") so a degraded transcript still reads like the
 * same question with mispronounced domain vocabulary.
 */

export type AccentProfileId = "south_indian" | "east_asian" | "arabic" | "hispanic";

/** A general (non-vocabulary) phonetic rewrite applied with a fixed chance. */
export interface AccentRewriteRule {
  pattern: RegExp;
  replacement: string;
  /** Deterministic probability in [0, 1] that this rule fires for a token. */
  chance: number;
}

export interface AccentProfile {
  id: AccentProfileId;
  label: string;
  description: string;
  /** Language backgrounds this profile models (for the evidence table). */
  backgrounds: readonly string[];
  /**
   * Canonical lowercase domain term -> realistic garbled spellings the decoder
   * may produce. A term is only garbled when it appears in this table, so the
   * corpus controls exactly which entities are stressed.
   */
  termGarble: Readonly<Record<string, readonly string[]>>;
  /** General rules applied to non-vocabulary content words (never question stems). */
  rules: readonly AccentRewriteRule[];
  /** Decoder confidence ranges used by the mock adapter. */
  confidence: {
    garbledMin: number;
    garbledMax: number;
    cleanMin: number;
    cleanMax: number;
  };
}

const SOUTH_INDIAN: AccentProfile = {
  id: "south_indian",
  label: "South Indian (Telugu/Hindi-influenced English)",
  description:
    "Retroflex t/d, v->w, epenthetic vowels inside consonant clusters, and words split where the speaker pauses.",
  backgrounds: ["te", "hi", "ta", "kn"],
  termGarble: {
    kubernetes: ["koobernetes", "kube rnetes", "kubernates"],
    postgres: ["post gress", "post gres"],
    postgresql: ["post gress q l", "postgres q l"],
    mongodb: ["mongo d b", "mangodb"],
    mongo: ["mango", "mongo"],
    redis: ["reddis", "red is"],
    graphql: ["graph q l", "graphical"],
    terraform: ["terrafom", "terra form"],
    prometheus: ["prome theus", "promethius"],
    grafana: ["grahana", "graffana"],
    kafka: ["kavka", "kaf ka"],
    jwt: ["j w t", "jay double u tee"],
    microservices: ["micro services", "my cro services"],
    nguyen: ["newen", "nguyyen"],
    priya: ["priyaa", "preya"],
    northwind: ["north wind", "narthwind"],
    mysql: ["my sequel", "my s q l"],
    sql: ["sequel", "s q l"],
    cache: ["cash", "kaysh"],
    typescript: ["type script", "types cript"],
    javascript: ["java script", "java scrip"],
    nginx: ["n gin x", "engine x"],
  },
  rules: [
    { pattern: /th/gi, replacement: "t", chance: 0.45 },
    { pattern: /v/gi, replacement: "w", chance: 0.35 },
    { pattern: /([bcdfgkpst])r/gi, replacement: "$1ar", chance: 0.18 },
  ],
  confidence: { garbledMin: 0.26, garbledMax: 0.57, cleanMin: 0.84, cleanMax: 0.97 },
};

const EAST_ASIAN: AccentProfile = {
  id: "east_asian",
  label: "East Asian (Mandarin-influenced English)",
  description:
    "l/r alternation, th->s, final-consonant weakening, and syllable-splitting of long technical words.",
  backgrounds: ["zh", "ja", "ko"],
  termGarble: {
    kubernetes: ["cube ernetes", "kubernetis", "kubernetess"],
    postgres: ["post gres", "postgress"],
    postgresql: ["post gress q l", "post gres q l"],
    mongodb: ["mongo d b", "mongod bee"],
    redis: ["ledis", "redisu"],
    graphql: ["graph q l", "guraf q l"],
    terraform: ["telaform", "terrafoam"],
    prometheus: ["pulometheus", "prometeus"],
    grafana: ["gurafana", "grafana"],
    kafka: ["kafuka", "kafuka"],
    jwt: ["j w t", "jay w t"],
    microservices: ["microservises", "micro service"],
    nguyen: ["newen", "nuyen"],
    priya: ["puliya", "puriya"],
    northwind: ["noswind", "north wind"],
    mysql: ["my s q l", "mysequel"],
    sql: ["s q l", "sequel"],
    cache: ["cash", "kesh"],
    typescript: ["type script", "taipu script"],
    javascript: ["java script", "jarva script"],
    nginx: ["en gin x", "engine x"],
  },
  rules: [
    { pattern: /r/gi, replacement: "l", chance: 0.4 },
    { pattern: /th/gi, replacement: "s", chance: 0.35 },
    { pattern: /v/gi, replacement: "w", chance: 0.3 },
    { pattern: /([bdg])$/i, replacement: "", chance: 0.25 },
  ],
  confidence: { garbledMin: 0.24, garbledMax: 0.54, cleanMin: 0.85, cleanMax: 0.98 },
};

const ARABIC: AccentProfile = {
  id: "arabic",
  label: "Arabic-influenced English",
  description:
    "p->b, v->f, th->z, and vowel insertion around consonant clusters in technical terms.",
  backgrounds: ["ar", "fa", "ur"],
  termGarble: {
    kubernetes: ["kubarnetes", "cube rnetes"],
    postgres: ["bostgres", "post gres"],
    postgresql: ["bost gress q l", "post gres q l"],
    mongodb: ["mongo d b", "mongodib"],
    redis: ["rediss", "ridis"],
    graphql: ["graph q l", "graf q l"],
    terraform: ["tarfarm", "terra form"],
    prometheus: ["brometheus", "prometheous"],
    grafana: ["grafana", "karafana"],
    kafka: ["kafca", "kafka"],
    jwt: ["j w t", "jaw t"],
    microservices: ["mikro services", "micro services"],
    nguyen: ["newen", "ngoo yen"],
    priya: ["briya", "priyaa"],
    northwind: ["north wind", "northwend"],
    mysql: ["my s q l", "my sequel"],
    sql: ["s q l", "sequel"],
    cache: ["cash", "cache"],
    typescript: ["type script", "tayp script"],
    javascript: ["java script", "jawascript"],
    nginx: ["n jin x", "engine x"],
  },
  rules: [
    { pattern: /p/gi, replacement: "b", chance: 0.45 },
    { pattern: /v/gi, replacement: "f", chance: 0.4 },
    { pattern: /th/gi, replacement: "z", chance: 0.35 },
  ],
  confidence: { garbledMin: 0.25, garbledMax: 0.55, cleanMin: 0.84, cleanMax: 0.97 },
};

const HISPANIC: AccentProfile = {
  id: "hispanic",
  label: "Spanish/Portuguese-influenced English",
  description:
    "v/b merger, word-initial s+consonant epenthesis, th->t, and softer word endings.",
  backgrounds: ["es", "pt"],
  termGarble: {
    kubernetes: ["kubernete", "cubernete"],
    postgres: ["post gres", "postgrest"],
    postgresql: ["post gres q l", "postgres q l"],
    mongodb: ["mongo d b", "mongode"],
    redis: ["reddis", "redis"],
    graphql: ["graph q l", "graf q l"],
    terraform: ["terrafor", "terra form"],
    prometheus: ["prometeus", "prometius"],
    grafana: ["grafana", "graffana"],
    kafka: ["cafca", "kafca"],
    jwt: ["j w t", "yot"],
    microservices: ["micro servis", "microservis"],
    nguyen: ["newen", "nuyen"],
    priya: ["priya", "briya"],
    northwind: ["north wind", "norwind"],
    mysql: ["my s q l", "my sequel"],
    sql: ["s q l", "sequel"],
    cache: ["cash", "cashe"],
    typescript: ["type script", "taip script"],
    javascript: ["java script", "jabascript"],
    nginx: ["en gin x", "engine x"],
  },
  rules: [
    { pattern: /v/gi, replacement: "b", chance: 0.35 },
    { pattern: /^s([bcdfgklmnpqrst])/i, replacement: "es$1", chance: 0.45 },
    { pattern: /th/gi, replacement: "t", chance: 0.3 },
    { pattern: /z/gi, replacement: "s", chance: 0.25 },
  ],
  confidence: { garbledMin: 0.27, garbledMax: 0.58, cleanMin: 0.83, cleanMax: 0.96 },
};

export const ACCENT_PROFILES: readonly AccentProfile[] = [
  SOUTH_INDIAN,
  EAST_ASIAN,
  ARABIC,
  HISPANIC,
];

const BY_ID = new Map<AccentProfileId, AccentProfile>(
  ACCENT_PROFILES.map((profile) => [profile.id, profile]),
);

export const DEFAULT_ACCENT_PROFILE_ID: AccentProfileId = "south_indian";

export function getAccentProfile(id: AccentProfileId): AccentProfile {
  const profile = BY_ID.get(id);
  if (!profile) throw new Error("unknown accent profile: " + id);
  return profile;
}

/** Question stems and function words that degradation must never garble. */
export const PROTECTED_WORDS: ReadonlySet<string> = new Set([
  "what", "whats", "why", "how", "hows", "when", "where", "which", "who",
  "can", "could", "would", "should", "will", "do", "does", "did", "is", "are",
  "was", "were", "have", "has", "had", "explain", "describe", "compare", "tell",
  "walk", "talk", "give", "show", "design", "write", "walk", "would", "your",
  "you", "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "this", "that", "these", "those", "it", "we", "they", "i", "my", "our",
  // Content words that are not the stressed entity for the corpus. Keeping
  // them clean isolates the measurement to entity pronunciation recovery.
  "react", "node", "event", "loop", "index", "rate", "limiter", "monitor",
  "metrics", "streaming", "queue", "migration", "review", "feedback", "company",
  "project", "database", "token", "refresh", "validate", "store", "design",
  "split", "trade", "manual", "infrastructure", "signals", "observability",
  "increase", "traffic", "production", "service", "services", "strategy",
  "invalidate", "invalidated", "re-render", "reconciliation", "storage",
  "approve", "payments", "owned", "environment", "environments", "bigger",
  "instead", "works", "handle", "build", "choose", "prefer", "stop", "blocks",
]);
