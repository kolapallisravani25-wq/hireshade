/**
 * Hand-labeled pronunciation corpus (G-039).
 *
 * 16 intents x 3 canonical interviewer questions x 4 accent profiles = 192
 * degraded utterances (>=150 required). Every item carries:
 *   - the canonical (true) transcript,
 *   - the deterministic degraded top-1 transcript + word confidences + n-best
 *     produced by the accent profiles (api-server pronunciation engine),
 *   - the hand-labeled true intent id.
 *
 * The labels are authored, not derived from the rescue layer: each intent is a
 * fixed set of required keyword groups in INTENT_SPECS. An item counts as
 * correctly understood only when the pipeline's recovered question satisfies
 * the same intent's groups and no other intent wins.
 */
import {
  degradeTranscript,
  type DegradedTranscript,
} from "../../../../api-server/src/lib/pronunciation/degradation";
import type { AccentProfileId } from "../../../../api-server/src/lib/pronunciation/accentProfiles";
import type { AsrNBestAlternative, AsrWord } from "../../../../api-server/src/lib/mocks/types";

export interface IntentSpec {
  id: string;
  description: string;
  /** Every group must have at least one matching keyword in the transcript. */
  groups: readonly (readonly string[])[];
}

export const INTENT_SPECS: readonly IntentSpec[] = [
  { id: "k8s_overkill", description: "Kubernetes overkill for a small system", groups: [["kubernetes", "k8s"], ["overkill", "monolith", "small", "really"]] },
  { id: "postgres_indexing", description: "Postgres indexing / btree", groups: [["postgres", "postgresql"], ["index", "indexing", "btree"]] },
  { id: "redis_ratelimit", description: "Redis-backed rate limiting", groups: [["redis"], ["rate", "limiter", "limiting", "limit"]] },
  { id: "sql_vs_nosql", description: "SQL/Postgres vs MongoDB/NoSQL", groups: [["postgres", "postgresql", "sql"], ["mongo", "mongodb", "nosql"]] },
  { id: "cache_invalidation", description: "Cache invalidation strategy", groups: [["cache", "caching"], ["invalidat", "write", "strategy"]] },
  { id: "event_loop_node", description: "Node event loop", groups: [["event"], ["loop"], ["node", "nodejs", "async"]] },
  { id: "react_rendering", description: "React re-render/reconciliation", groups: [["react"], ["render", "rerender", "reconciliation"]] },
  { id: "graphql_rest", description: "GraphQL vs REST", groups: [["graphql"], ["rest", "api"]] },
  { id: "terraform_iac", description: "Terraform infrastructure", groups: [["terraform"], ["infrastructure", "iac", "environments", "manual", "review", "changes"]] },
  { id: "observability", description: "Prometheus/Grafana observability", groups: [["prometheus", "grafana"], ["monitor", "monitoring", "observability", "signals", "metrics"]] },
  { id: "microservices", description: "Microservices trade-offs/database", groups: [["microservices", "microservice"], ["monolith", "database", "trade", "share", "split"]] },
  { id: "jwt_auth", description: "JWT validation/refresh/storage", groups: [["jwt"], ["validate", "refresh", "rotate", "storage", "token", "auth"]] },
  { id: "kafka_streaming", description: "Kafka streaming/backpressure", groups: [["kafka"], ["streaming", "backpressure", "queue"]] },
  { id: "company_why", description: "Why join Northwind Labs", groups: [["northwind"], ["join", "know", "company", "why", "instead"]] },
  { id: "nguyen_feedback", description: "Nguyen review feedback", groups: [["nguyen"], ["feedback", "review", "design", "payments", "approve"]] },
  { id: "priya_migration", description: "Migration with Priya", groups: [["priya"], ["migration", "owned", "split", "walk"]] },
];

export interface CorpusBase {
  id: string;
  intentId: string;
  text: string;
}

export const CORPUS_BASES: readonly CorpusBase[] = [
  { id: "k8s-1", intentId: "k8s_overkill", text: "Is Kubernetes overkill for a monolith?" },
  { id: "k8s-2", intentId: "k8s_overkill", text: "Do we really need Kubernetes for this monolith?" },
  { id: "k8s-3", intentId: "k8s_overkill", text: "Would you run a small monolith on Kubernetes?" },

  { id: "pg-1", intentId: "postgres_indexing", text: "How does indexing work in Postgres?" },
  { id: "pg-2", intentId: "postgres_indexing", text: "Why is the btree index not used in Postgres?" },
  { id: "pg-3", intentId: "postgres_indexing", text: "Explain how a btree index works in PostgreSQL." },

  { id: "redis-1", intentId: "redis_ratelimit", text: "Would you use Redis for rate limiting?" },
  { id: "redis-2", intentId: "redis_ratelimit", text: "How would you build a rate limiter with Redis?" },
  { id: "redis-3", intentId: "redis_ratelimit", text: "Why put the rate limiter in Redis?" },

  { id: "sql-1", intentId: "sql_vs_nosql", text: "Why did you choose Postgres over MongoDB?" },
  { id: "sql-2", intentId: "sql_vs_nosql", text: "When would you pick MongoDB instead of SQL?" },
  { id: "sql-3", intentId: "sql_vs_nosql", text: "Compare SQL and NoSQL for a ledger." },

  { id: "cache-1", intentId: "cache_invalidation", text: "Should the cache be invalidated on every write?" },
  { id: "cache-2", intentId: "cache_invalidation", text: "How exactly did you invalidate the cache?" },
  { id: "cache-3", intentId: "cache_invalidation", text: "What is your cache invalidation strategy?" },

  { id: "node-1", intentId: "event_loop_node", text: "Can you explain the event loop in Node.js?" },
  { id: "node-2", intentId: "event_loop_node", text: "How does Node handle async work on the event loop?" },
  { id: "node-3", intentId: "event_loop_node", text: "What blocks the event loop in Node?" },

  { id: "react-1", intentId: "react_rendering", text: "Why does React re-render the list on every keystroke?" },
  { id: "react-2", intentId: "react_rendering", text: "How do you stop React from re-rendering?" },
  { id: "react-3", intentId: "react_rendering", text: "Explain React reconciliation." },

  { id: "gql-1", intentId: "graphql_rest", text: "Do you prefer REST or GraphQL for this project?" },
  { id: "gql-2", intentId: "graphql_rest", text: "When would you use GraphQL instead of REST?" },
  { id: "gql-3", intentId: "graphql_rest", text: "Compare a GraphQL API with REST." },

  { id: "tf-1", intentId: "terraform_iac", text: "How do you structure Terraform for multiple environments?" },
  { id: "tf-2", intentId: "terraform_iac", text: "Why use Terraform instead of manual infrastructure?" },
  { id: "tf-3", intentId: "terraform_iac", text: "How do you review Terraform changes?" },

  { id: "obs-1", intentId: "observability", text: "How do you monitor that in Prometheus?" },
  { id: "obs-2", intentId: "observability", text: "What observability signals would you add with Grafana?" },
  { id: "obs-3", intentId: "observability", text: "Which Prometheus metrics do you alert on with Grafana?" },

  { id: "ms-1", intentId: "microservices", text: "Why did you split the monolith into microservices?" },
  { id: "ms-2", intentId: "microservices", text: "What are the trade-offs of microservices?" },
  { id: "ms-3", intentId: "microservices", text: "How do microservices share a database?" },

  { id: "jwt-1", intentId: "jwt_auth", text: "How do you validate a JWT on the API?" },
  { id: "jwt-2", intentId: "jwt_auth", text: "Why rotate JWT refresh tokens?" },
  { id: "jwt-3", intentId: "jwt_auth", text: "Should you store JWT in local storage?" },

  { id: "kafka-1", intentId: "kafka_streaming", text: "Why did you use Kafka for streaming?" },
  { id: "kafka-2", intentId: "kafka_streaming", text: "How does Kafka handle backpressure?" },
  { id: "kafka-3", intentId: "kafka_streaming", text: "When is Kafka better than a queue?" },

  { id: "company-1", intentId: "company_why", text: "Why do you want to join Northwind Labs?" },
  { id: "company-2", intentId: "company_why", text: "What do you know about Northwind Labs?" },
  { id: "company-3", intentId: "company_why", text: "Why Northwind Labs instead of a bigger company?" },

  { id: "nguyen-1", intentId: "nguyen_feedback", text: "How did you handle the review feedback from Nguyen?" },
  { id: "nguyen-2", intentId: "nguyen_feedback", text: "Did Nguyen approve the design?" },
  { id: "nguyen-3", intentId: "nguyen_feedback", text: "What did Nguyen change in the payments review?" },

  { id: "priya-1", intentId: "priya_migration", text: "Can you walk me through the migration you did with Priya?" },
  { id: "priya-2", intentId: "priya_migration", text: "What did Priya own in the migration?" },
  { id: "priya-3", intentId: "priya_migration", text: "How did you split the migration work with Priya?" },
];

/** Resume/JD/company material the vocabulary builder receives for the corpus. */
export const CORPUS_RESUME_CONTEXT = [
  "Demo Candidate - Senior Backend Engineer.",
  "Designed a Redis-backed rate limiter for an Express 5 API with sliding-window counters.",
  "Owned Postgres schema migrations, btree indexes and cache invalidation strategy.",
  "Built Kafka streaming pipelines and Prometheus/Grafana observability.",
  "Ran Kubernetes and Terraform for the platform team with microservices.",
  "Worked with Nguyen on the payments review and Priya on the migration.",
  "Comfortable with Node.js, TypeScript, React, GraphQL, JWT and SQL vs NoSQL trade-offs.",
].join(" ");

export const CORPUS_JOB_DESCRIPTION = [
  "Senior backend engineer: Node.js/TypeScript, Redis, Postgres, rate limiting,",
  "Kubernetes, Terraform, Kafka, observability, GraphQL and JWT auth.",
].join(" ");

export const CORPUS_COMPANY_NAMES: readonly string[] = ["Northwind Labs"];

export interface CorpusItem {
  id: string;
  baseId: string;
  intentId: string;
  profileId: AccentProfileId;
  profileLabel: string;
  canonicalText: string;
  /** Degraded top-1 hypothesis text (what the ASR returned). */
  text: string;
  words: AsrWord[];
  alternatives: AsrNBestAlternative[];
  garbledTerms: string[];
}

export interface CorpusBuildOptions {
  profiles?: readonly AccentProfileId[];
  garbleChance?: number;
  includeAlternatives?: boolean;
}

export function buildPronunciationCorpus(options: CorpusBuildOptions = {}): CorpusItem[] {
  const profiles: readonly AccentProfileId[] = options.profiles ?? [
    "south_indian",
    "east_asian",
    "arabic",
    "hispanic",
  ];
  const items: CorpusItem[] = [];
  for (const profileId of profiles) {
    for (const base of CORPUS_BASES) {
      const degraded: DegradedTranscript = degradeTranscript(base.text, profileId, {
        seed: base.id,
        garbleChance: options.garbleChance,
        includeAlternatives: options.includeAlternatives,
      });
      items.push({
        id: base.id + ":" + profileId,
        baseId: base.id,
        intentId: base.intentId,
        profileId,
        profileLabel: profileId,
        canonicalText: base.text,
        text: degraded.text,
        words: degraded.words,
        alternatives: degraded.alternatives,
        garbledTerms: degraded.garbledTerms,
      });
    }
  }
  return items;
}

export const CORPUS_DESCRIPTION =
  "192 degraded interviewer utterances (48 hand-authored questions x 4 accent " +
  "profiles) built from the repo's existing technical/interview language, with " +
  "hand-labeled true intent (16 intents, 3 questions each).";
