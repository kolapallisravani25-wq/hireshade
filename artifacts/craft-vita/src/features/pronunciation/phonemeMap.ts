/**
 * Domain phoneme map (G-039).
 *
 * A hand-curated table of the terms that matter in HireShade interviews:
 * technology names, databases, tools, people/company names from the session
 * context, and the homophones that phonetic matching alone cannot resolve
 * (SQL/sequel, cache/cash).
 *
 * Each entry carries:
 *   - canonical  display spelling (always returned by rescue/repair)
 *   - keys       lowercase lookup surfaces
 *   - say        human pronunciation respelling used by the TTS lexicon
 *   - ipa        optional IPA for SSML phoneme mode
 *   - variants   known decoder confusions (what ASR often returns)
 *   - cues       neighbouring words that disambiguate a homophone
 *   - boost      Deepgram keyword boost multiplier
 *
 * The variants are drawn from the repo's existing STT correction list plus the
 * accent profiles this task ships; they are *known confusions*, not corpus
 * answers - the corpus still has to be recovered by the phonetic/vocabulary
 * layers for forms that are not listed here.
 */
import type { AsrKeywordBoost } from "../../../../api-server/src/lib/mocks/types";
import { phoneticKey, phoneticKeyForTerm, normalizeWord } from "./phonetics";

export type DomainTermKind = "technology" | "database" | "person" | "company" | "concept";

export interface DomainTerm {
  canonical: string;
  keys: readonly string[];
  /** Respelling for TTS, e.g. "koo-ber-net-eez". */
  say: string;
  ipa?: string;
  variants: readonly string[];
  cues?: readonly string[];
  boost?: number;
  kind: DomainTermKind;
}

const TECH = (canonical: string, say: string, variants: readonly string[], ipa?: string): DomainTerm => ({
  canonical,
  keys: [canonical.toLowerCase()],
  say,
  ...(ipa ? { ipa } : {}),
  variants,
  boost: 2,
  kind: "technology",
});

export const DOMAIN_TERMS: readonly DomainTerm[] = [
  {
    canonical: "Kubernetes",
    keys: ["kubernetes", "k8s", "k8"],
    say: "koo-ber-net-eez",
    ipa: "ˌkuːbərˈnɛtiːz",
    variants: [
      "koobernetes", "kube rnetes", "kubernates", "cube ernetes", "kubernetis",
      "kubernetess", "kubarnetes", "cube rnetes", "kubernete", "cubernete",
      "k 8 s", "k eight s",
    ],
    boost: 3,
    kind: "technology",
  },
  {
    canonical: "PostgreSQL",
    keys: ["postgresql", "postgres"],
    say: "post-gres-q-l",
    ipa: "ˈpoʊstɡrɛs kjuː ɛl",
    variants: [
      "post gress q l", "postgres q l", "post gres q l", "bost gress q l",
      "post gress", "post gres", "postgress", "bostgres", "postgrest",
    ],
    boost: 3,
    kind: "database",
  },
  {
    canonical: "SQL",
    keys: ["sql", "sequel"],
    say: "ess-cue-ell",
    ipa: "ˌɛs kjuː ˈɛl",
    variants: ["sequel", "s q l", "ess cue ell", "ess que el"],
    boost: 3,
    kind: "database",
  },
  {
    canonical: "MySQL",
    keys: ["mysql"],
    say: "my-ess-cue-ell",
    variants: ["my sequel", "my s q l", "mysequel"],
    boost: 2,
    kind: "database",
  },
  {
    canonical: "MongoDB",
    keys: ["mongodb", "mongo"],
    say: "mon-go-dee-bee",
    variants: [
      "mongo d b", "mangodb", "mongod bee", "mongodib", "mongode", "mongo db", "mango",
    ],
    boost: 2,
    kind: "database",
  },
  {
    canonical: "Redis",
    keys: ["redis"],
    say: "red-iss",
    ipa: "ˈrɛdɪs",
    variants: ["reddis", "red is", "ledis", "redisu", "ridis"],
    boost: 3,
    kind: "database",
  },
  {
    canonical: "GraphQL",
    keys: ["graphql"],
    say: "graph-q-l",
    ipa: "ɡræf kjuː ɛl",
    variants: ["graph q l", "graphical", "guraf q l", "graf q l"],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "gRPC",
    keys: ["grpc"],
    say: "gee-are-pee-see",
    variants: ["g r p c", "gee are pee see", "g r p see"],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "Terraform",
    keys: ["terraform"],
    say: "terr-uh-form",
    ipa: "ˈtɛrəfɔːrm",
    variants: ["terrafom", "terra form", "telaform", "terrafoam", "tarfarm", "terrafor"],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "Prometheus",
    keys: ["prometheus"],
    say: "pruh-mee-thee-us",
    variants: [
      "prome theus", "promethius", "pulometheus", "prometeus", "brometheus",
      "prometheous", "prometius",
    ],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "Grafana",
    keys: ["grafana"],
    say: "gruh-fah-nuh",
    variants: ["grahana", "graffana", "gurafana", "karafana"],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "Kafka",
    keys: ["kafka"],
    say: "kahf-kah",
    ipa: "ˈkɑːfkə",
    variants: ["kavka", "kaf ka", "kafuka", "kafca", "cafca"],
    boost: 3,
    kind: "technology",
  },
  {
    canonical: "JWT",
    keys: ["jwt"],
    say: "jay-double-you-tee",
    variants: ["j w t", "jay double u tee", "jay w t", "jaw t", "yot"],
    boost: 2,
    kind: "concept",
  },
  {
    canonical: "OAuth",
    keys: ["oauth"],
    say: "oh-auth",
    variants: ["o auth", "oh auth"],
    boost: 2,
    kind: "concept",
  },
  {
    canonical: "microservices",
    keys: ["microservices", "microservice"],
    say: "my-kroh-ser-vis-iz",
    variants: [
      "micro services", "my cro services", "microservises", "micro service",
      "mikro services", "micro servis", "microservis",
    ],
    boost: 2,
    kind: "concept",
  },
  {
    canonical: "TypeScript",
    keys: ["typescript"],
    say: "type-script",
    variants: ["type script", "types cript", "taipu script", "tayp script", "taip script"],
    boost: 2,
    kind: "technology",
  },
  {
    canonical: "JavaScript",
    keys: ["javascript"],
    say: "java-script",
    variants: ["java script", "java scrip", "jarva script", "jawascript", "jabascript"],
    boost: 2,
    kind: "technology",
  },
  TECH("Node.js", "node-jay-ess", ["node js", "node j s", "no js"]),
  TECH("Next.js", "next-jay-ess", ["next js", "next j s"]),
  TECH("React", "ree-akt", ["reacts", "re act"]),
  TECH("Nginx", "engine-x", ["n gin x", "engine x", "en gin x", "n jin x"]),
  TECH("Docker", "dok-er", ["docker"]),
  TECH("Tauri", "tah-ree", ["tory", "tauri"]),
  TECH("Elasticsearch", "elastic-search", ["elastic search"]),
  TECH("RabbitMQ", "rabbit-m-q", ["rabbit m q", "rabbitmq"]),
  TECH("DynamoDB", "dynamo-dee-bee", ["dynamo d b", "dynamo db", "dynamo dee bee"]),
  TECH("WebSocket", "web-socket", ["web socket", "websocket"]),
  TECH("K8s", "kay-eights", ["k 8 s", "k eight s", "k8s"]),
  {
    canonical: "Nguyen",
    keys: ["nguyen"],
    say: "nwin",
    ipa: "ŋwiːn",
    variants: ["newen", "nguyyen", "nuyen", "ngoo yen", "nwin", "ngwen", "new win"],
    boost: 3,
    kind: "person",
  },
  {
    canonical: "Priya",
    keys: ["priya"],
    say: "pree-yah",
    ipa: "ˈpriːjɑː",
    variants: ["priyaa", "preya", "puliya", "puriya", "briya", "preeya"],
    boost: 3,
    kind: "person",
  },
  {
    canonical: "Northwind Labs",
    keys: ["northwind labs"],
    say: "north-wind labs",
    variants: ["north wind labs"],
    boost: 3,
    kind: "company",
  },
  {
    canonical: "Northwind",
    keys: ["northwind"],
    say: "north-wind",
    variants: ["north wind", "narthwind", "noswind", "northwend", "norwind"],
    boost: 3,
    kind: "company",
  },
  {
    canonical: "cache",
    keys: ["cache"],
    say: "kash",
    variants: ["cash", "kaysh", "kesh", "cashe"],
    cues: [
      "invalidate", "invalidated", "invalidation", "invalidating", "redis", "hit",
      "miss", "eviction", "evict", "ttl", "layer", "key", "keys", "write", "strategy",
    ],
    kind: "concept",
  },
  {
    canonical: "cash",
    keys: ["cash"],
    say: "kash",
    variants: ["cache"],
    cues: ["payment", "payments", "salary", "money", "invoice", "refund", "refunds"],
    kind: "concept",
  },
];

export const DOMAIN_TERM_BY_KEY: ReadonlyMap<string, DomainTerm> = (() => {
  const map = new Map<string, DomainTerm>();
  for (const term of DOMAIN_TERMS) {
    for (const key of term.keys) map.set(normalizeWord(key), term);
    map.set(normalizeWord(term.canonical), term);
  }
  return map;
})();

/** variant phrase (normalized, spaces kept) -> domain terms that map to it. */
export const GARBLE_VARIANT_INDEX: ReadonlyMap<string, readonly DomainTerm[]> = (() => {
  const map = new Map<string, DomainTerm[]>();
  for (const term of DOMAIN_TERMS) {
    for (const variant of term.variants) {
      const key = normalizePhrase(variant);
      const bucket = map.get(key) ?? [];
      if (!bucket.includes(term)) bucket.push(term);
      map.set(key, bucket);
    }
  }
  return map;
})();

/** Lowercase, collapse whitespace, strip punctuation (phrase-safe). */
export function normalizePhrase(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDomainTerm(input: string): DomainTerm | undefined {
  return DOMAIN_TERM_BY_KEY.get(normalizeWord(input));
}

export function domainTermsForVariant(phrase: string): readonly DomainTerm[] {
  return GARBLE_VARIANT_INDEX.get(normalizePhrase(phrase)) ?? [];
}

/** Default keyword-boost list derived from the map (canonical terms only). */
export function domainKeywordBoosts(limit = 60): AsrKeywordBoost[] {
  return DOMAIN_TERMS.slice(0, limit).map((term) => ({
    term: term.canonical,
    boost: term.boost ?? 2,
  }));
}

/**
 * A homophone pair that phonetic matching alone cannot separate. Returns the
 * candidate canonical readings for a word and whether the surrounding context
 * picks one.
 */
export interface ConfusableResolution {
  word: string;
  candidates: string[];
  /** Chosen canonical reading, or null when context is not decisive. */
  resolved: string | null;
  /** Cue words that were found in the context window. */
  matchedCues: string[];
}

export function resolveConfusable(
  word: string,
  contextWords: readonly string[],
): ConfusableResolution | null {
  const normalized = normalizeWord(word);
  const context = contextWords.map((value) => normalizeWord(value));
  const candidateTerms: DomainTerm[] = [];
  for (const term of DOMAIN_TERMS) {
    if (term.keys.some((key) => normalizeWord(key) === normalized)) candidateTerms.push(term);
  }
  // Homophone family: every term whose variants/keys intersect the word or a
  // candidate's cue family.
  const family = new Set(candidateTerms);
  for (const term of candidateTerms) {
    for (const other of DOMAIN_TERMS) {
      if (other === term) continue;
      if (other.keys.some((key) => term.keys.includes(key))) family.add(other);
    }
    for (const variant of term.variants) {
      if (normalizeWord(variant) !== normalized) continue;
      for (const other of DOMAIN_TERMS) {
        if (other === term) continue;
        if (other.keys.some((key) => term.keys.includes(key))) family.add(other);
      }
    }
  }
  // The cache/cash family is not linked by keys, only by sound.
  if (normalized === normalizeWord("cash") || normalized === normalizeWord("cache")) {
    for (const term of DOMAIN_TERMS) {
      if (term.canonical === "cache" || term.canonical === "cash") family.add(term);
    }
  }
  if (family.size <= 1) return null;
  const contextBlob = new Set(context);
  const ranked: { canonical: string; cues: string[] }[] = [];
  for (const term of family) {
    const matchedCues = (term.cues ?? []).filter((cue) => contextBlob.has(normalizeWord(cue)));
    ranked.push({ canonical: term.canonical, cues: matchedCues });
  }
  ranked.sort((a, b) => b.cues.length - a.cues.length);
  const best = ranked[0]!;
  const runnerUp = ranked[1];
  const decisive = best.cues.length > 0 && (!runnerUp || best.cues.length > runnerUp.cues.length);
  return {
    word,
    candidates: ranked.map((item) => item.canonical),
    resolved: decisive ? best.canonical : null,
    matchedCues: best.cues,
  };
}

/** Primary phonetic key for a term, used by tests and diagnostics. */
export function phoneticKeyOfTerm(term: string): string {
  return /s/.test(term.trim()) ? phoneticKeyForTerm(term) : phoneticKey(term);
}
