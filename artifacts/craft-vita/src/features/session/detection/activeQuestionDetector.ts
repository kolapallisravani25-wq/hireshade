import { detectIntent, isFillerPhrase } from "@/lib/intent-detector";
import { normalizeSttTranscript } from "@/features/session/transcript/stt-normalizer";

export interface ActiveQuestionDetectionResult {
  activeQuestion: string;
  cleanedQuestion: string;
  isFollowUp: boolean;
  topicChanged: boolean;
  confidenceScore: number;
  ignoredNoise: boolean;
  referencedHistoryTurnId?: string;
  source: "live_interim" | "transcript_history" | "user_transcript" | "transcript_fallback" | "none";
}

type TranscriptEntry = {
  sender: "User" | "Interviewer";
  text: string;
  timestamp?: number;
  messageId?: string;
};

const FOLLOWUP_SIGNAL_RE =
  /\b(how exactly|explain more|explain this|explain that|explain the code|explain this code|explain that code|explain the code again|that function|this function|the function you wrote|function that you (?:have )?written|how this works|in context of|you mentioned|you said|same thing|continue|continue from|what about that|why did|why was|why was that|why that|why this is used|optimi[sz]e this|debug this|fix this|previous answer|above answer|the code|that code|the query|that query|database part|architecture part)\b/i;
const WEAK_DEICTIC_RE =
  /^(that|it|this|continue|continue from .{1,80}|same thing|explain it|explain this|explain that|explain the code|explain that function|explain this function|why|why this is used|optimi[sz]e this|debug this)\??$/i;

const CONNECTOR_RE = /\b(and|then|also|plus|because|so)\s*$/i;

// Recognises technical topics across common web / backend / mobile / cloud /
// data / infra / ML stacks. This list intentionally covers the persona
// spread we see in real interviews (originally skewed hard to
// Databricks/Azure/SQL/Node/React, which caused non-data-eng questions to be
// classified as "non-technical" and skip through detector heuristics).
//
// NOTE: JavaScript RegExp does not support the /x verbose flag, so this is a
// single long alternation. Split into logical groups by comments for grep
// discoverability, but the runtime pattern is one continuous regex.
const TECH_TOPIC_RE = new RegExp(
  "\\b(?:" +
    [
      // data eng / warehousing / streaming
      "databricks|pyspark|spark|hadoop|hive|airflow|dbt|snowflake|bigquery|redshift|kafka|flink|beam|kinesis|pulsar|nats",
      // cloud
      "adf|azure devops|azure|aws|gcp|google cloud|amazon|s3|ec2|ecs|eks|lambda|sagemaker|cloudformation|cloud run|cloud functions",
      // relational DBs
      "sql|postgres|postgresql|mysql|mariadb|sqlite|oracle|mssql|sql server|db2|cockroach|planetscale|neon|supabase",
      // NoSQL / search / graph
      "mongo|mongodb|mongoose|cassandra|dynamodb|couchbase|couchdb|elasticsearch|opensearch|solr|neo4j",
      // cache / queues
      "redis|memcached|rabbitmq|activemq|zeromq",
      // node ecosystem
      "node|nodejs|express|fastify|nestjs|koa|deno|bun",
      // web FE
      "react|nextjs|next\\.js|remix|gatsby|vue|nuxt|svelte|sveltekit|angular|solid|preact|astro|qwik|redux|zustand|jotai|recoil|mobx|tanstack|react query|swr|apollo|urql|relay|tailwind|scss|sass|styled components|emotion|chakra|mui|material ui|shadcn|radix",
      // JS tooling / langs
      "typescript|javascript|es6|esm|cjs|webpack|vite|rollup|esbuild|swc|babel|turbopack|parcel",
      // python
      "python|django|flask|fastapi|starlette|pyramid|tornado|celery|pydantic|numpy|pandas|scipy|scikit|sklearn|matplotlib|seaborn|plotly",
      // JVM
      "java|spring|spring boot|hibernate|maven|gradle|jvm|kotlin|scala|groovy|micronaut|quarkus",
      // Go / Rust / Ruby / PHP / .NET
      "go|golang|gin|fiber|echo|chi|goroutine|channel",
      "rust|cargo|tokio|actix|axum|rocket|hyper|wasm|webassembly",
      "ruby|rails|sinatra|rspec|activerecord",
      "php|laravel|symfony|composer|wordpress|drupal",
      "csharp|c\\+\\+|dotnet|\\.net|asp\\.net|entity framework|blazor",
      // mobile
      "swift|swiftui|objective c|xcode|ios|iphone|ipad|android|jetpack|jetpack compose|room|kotlin coroutines|react native|flutter|dart|ionic|capacitor|expo|xamarin|maui",
      // containers / orchestration / IaC / CI
      "docker|dockerfile|containerd|podman|kubernetes|k8s|helm|kustomize|argocd|argo|istio|linkerd|envoy",
      "terraform|opentofu|pulumi|ansible|chef|puppet|packer|vagrant",
      "ci\\/cd|jenkins|circle ci|circleci|github actions|gitlab ci|travis|buildkite|drone|teamcity|bamboo",
      // observability / web servers
      "prometheus|grafana|datadog|new relic|splunk|elk|logstash|kibana|jaeger|opentelemetry|otel|zipkin|sentry",
      "nginx|apache|traefik|haproxy|caddy",
      // API / auth / payments
      "api|graphql|rest|grpc|websocket|sse|webhook|openapi|swagger|protobuf|thrift",
      "oauth|oidc|jwt|saml|sso|clerk|auth0|okta|firebase auth|cognito",
      "stripe|paypal|razorpay|braintree|adyen",
      // ML / AI
      "machine learning|deep learning|neural network|ml|ai|nlp|llm|large language model|transformer|bert|gpt|tensorflow|pytorch|keras|jax|hugging face|huggingface|langchain|llamaindex|pinecone|weaviate|milvus|chroma|qdrant|embedding|vector db|vector database|rag|retrieval augmented|fine tune|fine-tuning|prompt engineering",
      // data pipelines / infra
      "data engineering|data science|data pipeline|etl|elt|batch|streaming|realtime|real time",
      "microservice|monolith|serverless|edge|cdn|cloudflare|vercel|netlify|render|fly\\.io",
      // arch / algo / concurrency
      "architecture|system design|scalability|throughput|latency|concurrency|parallelism|threading|async|await|promise",
      "algorithm|data structure|complexity|big o|leetcode|dp|dynamic programming|greedy|graph|tree|heap|stack|queue|linked list",
      // Git / testing / security / linux
      "git|github|gitlab|bitbucket|pull request|merge|rebase|cherry pick|branch",
      "testing|unit test|integration test|e2e|end to end|jest|mocha|vitest|cypress|playwright|selenium|junit|pytest",
      "security|encryption|hashing|tls|ssl|cors|csrf|xss|sql injection|owasp",
      "linux|unix|bash|shell|zsh|systemd|iptables|networking|tcp|udp|dns|http|https|http2|http3|quic",
      // Roles / generic
      "backend|frontend|full stack|fullstack|full-stack|devops|sre|platform|infrastructure|infra",
      "code|query|schema|migration|orm|table|column|index|shard|partition|replica|leader|follower|consensus|paxos|raft",
      "project|feature|bug|refactor|design pattern|singleton|factory|observer|dependency injection",
    ].join("|") +
    ")\\b",
  "i",
);

// Utterances that are administrative noise (interviewer wrangling the call,
// asking for ID, camera adjustments) — must not be treated as questions.
const ADMIN_NOISE_RE =
  /\b(aadhaar|pan card|driver's? licen[sc]e|passport|government id|photo id|camera|webcam|mic|microphone|audible|hear me|hear you|volume|louder|softer|mute|unmute|show it|show me your (?:id|face|screen)|rejoin|reconnect|refresh|reload|share (?:your )?screen|screen share|connection|network|internet|wifi|latency|lag|freeze|frozen|wait a (?:minute|moment|second|sec)|hold on|one moment|bear with me|sorry (?:can you|could you)|repeat that|say (?:it |that )?again|come again|didn'?t catch|didn'?t (?:hear|get)|break for|coffee break|water break|five minutes?|excuse me|hang on)\b/i;

export function stripLeadingConjunctionsAndFillers(text: string): string {
  let cleaned = text.trim();
  const regex = /^(?:and|or|then|also|but|so|now|plus|because|okay|ok|great|right|perfect|well|yes|no|wait|hey|hi|hello)\b\s*,?\s*/i;
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(regex, "");
  } while (cleaned !== previous);
  return cleaned;
}

function norm(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Deterministic identity for a detected question, mirroring the backend
// answeredQuestionMemory.normalizeQuestionKey contract: strip leading fillers,
// casing, and punctuation so "So, okay can you introduce yourself?" and
// "can you introduce yourself" collapse to the same key. Used to suppress
// re-answering a question already answered this session (spec "Still broken
// #1 — Wrong-question": a new question re-ran the OLD self-introduction).
export function normalizeQuestionKey(text: string): string {
  let cleaned = stripLeadingConjunctionsAndFillers((text || "").toLowerCase().trim());
  return cleaned.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isQuestionLike(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  const stripped = stripLeadingConjunctionsAndFillers(t);
  return /^(what|why|how|when|where|which|who|can|could|would|should|is|are|do|does|did|explain|show|give|write|debug|optimi[sz]e|refactor)\b/i.test(
    stripped,
  );
}

function removeOverlap(lastText: string, newText: string): string {
  const lastWords = norm(lastText).split(" ").filter(Boolean);
  const newWords = norm(newText).split(" ").filter(Boolean);
  let overlapCount = 0;
  const maxSearch = Math.min(lastWords.length, newWords.length, 12);
  for (let len = 1; len <= maxSearch; len++) {
    if (
      lastWords.slice(-len).join(" ") === newWords.slice(0, len).join(" ")
    ) {
      overlapCount = len;
    }
  }
  if (!overlapCount) return newText;
  return newText.trim().split(/\s+/).slice(overlapCount).join(" ");
}

function mergeChunks(chunks: string[]): string {
  const out: string[] = [];
  for (const raw of chunks) {
    const text = raw.trim();
    if (!text) continue;
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(text);
      continue;
    }
    if (CONNECTOR_RE.test(prev)) {
      out[out.length - 1] = `${prev} ${text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    const withoutOverlap = removeOverlap(prev, text).trim();
    if (withoutOverlap) out.push(withoutOverlap);
  }
  return out.join(" ").trim();
}

// Derive a topic label for two questions to decide if they share domain
// context (used by follow-up merging: same topic ⇒ more likely a follow-up;
// different topic ⇒ likely a fresh question).
//
// Order matters — the first matching bucket wins. More-specific stacks are
// checked first so that e.g. "pyspark" resolves to "spark" not "python", and
// "react native" resolves to "mobile" not "react".
function deriveTopic(text: string): string {
  const n = norm(text);

  // Mobile (checked before react/kotlin so "react native"/"kotlin android"
  // don't get miscategorised as web-react or JVM).
  if (/\b(ios|iphone|ipad|swift|swiftui|xcode|objective c)\b/.test(n)) return "mobile";
  if (/\b(android|jetpack compose|jetpack|kotlin android)\b/.test(n)) return "mobile";
  if (/\b(react native|flutter|dart|ionic|expo|capacitor|xamarin|maui)\b/.test(n)) return "mobile";

  // Data engineering / warehousing / streaming
  if (/\b(databricks|pyspark|spark|hadoop|hive|airflow|dbt|snowflake|bigquery|redshift)\b/.test(n)) return "data-eng";
  if (/\b(kafka|flink|beam|kinesis|pulsar|streaming|realtime|real time|etl|elt)\b/.test(n)) return "data-eng";

  // Cloud platforms
  if (/\b(adf|azure devops|azure)\b/.test(n)) return "azure";
  if (/\b(aws|amazon|s3|ec2|ecs|eks|lambda|sagemaker|cloudformation)\b/.test(n)) return "aws";
  if (/\b(gcp|google cloud|bigquery|cloud run|cloud functions)\b/.test(n)) return "gcp";

  // Databases
  if (/\b(sql|postgres|postgresql|mysql|mariadb|oracle|mssql|sql server|db2|query|schema|migration|index|shard|partition|table|column)\b/.test(n)) return "sql";
  if (/\b(mongo|mongodb|mongoose|cassandra|dynamodb|couchdb|couchbase|neo4j)\b/.test(n)) return "nosql";
  if (/\b(redis|memcached)\b/.test(n)) return "cache";
  if (/\b(elasticsearch|opensearch|solr)\b/.test(n)) return "search";

  // Message queues
  if (/\b(rabbitmq|activemq|zeromq|nats|sqs|sns|pubsub)\b/.test(n)) return "messaging";

  // Container / orchestration / IaC
  if (/\b(kubernetes|k8s|helm|kustomize|argocd|argo|istio|linkerd|envoy)\b/.test(n)) return "k8s";
  if (/\b(docker|dockerfile|containerd|podman)\b/.test(n)) return "containers";
  if (/\b(terraform|opentofu|pulumi|ansible|chef|puppet|packer|vagrant)\b/.test(n)) return "iac";
  if (/\b(ci\/cd|jenkins|circleci|github actions|gitlab ci|travis|buildkite|drone)\b/.test(n)) return "cicd";

  // Observability
  if (/\b(prometheus|grafana|datadog|new relic|splunk|elk|logstash|kibana|jaeger|opentelemetry|otel|zipkin|sentry)\b/.test(n)) return "observability";

  // ML/AI
  if (/\b(machine learning|deep learning|neural network|ml|nlp|transformer|bert|gpt|tensorflow|pytorch|keras|jax|hugging ?face|langchain|llamaindex|embedding|vector db|vector database|rag|retrieval augmented|fine tune|fine-tuning|prompt engineering|llm|large language model)\b/.test(n)) return "ml";

  // Web frameworks (frontend)
  if (/\b(react|nextjs|next\.js|remix|gatsby|preact)\b/.test(n)) return "react";
  if (/\b(vue|nuxt)\b/.test(n)) return "vue";
  if (/\b(angular)\b/.test(n)) return "angular";
  if (/\b(svelte|sveltekit|solid|astro|qwik)\b/.test(n)) return "web-fe";
  if (/\b(tailwind|scss|sass|styled components|chakra|mui|material ui|shadcn|radix)\b/.test(n)) return "web-fe";

  // Web frameworks (backend)
  if (/\b(node|nodejs|express|fastify|nestjs|koa|deno|bun)\b/.test(n)) return "node";
  if (/\b(python|django|flask|fastapi|starlette|pyramid|tornado|celery)\b/.test(n)) return "python";
  if (/\b(java|spring|spring boot|hibernate|maven|gradle|jvm|kotlin|scala|groovy|micronaut|quarkus)\b/.test(n)) return "jvm";
  if (/\b(go|golang|gin|fiber|echo|chi|goroutine|channel)\b/.test(n)) return "go";
  if (/\b(rust|cargo|tokio|actix|axum|rocket|hyper|wasm|webassembly)\b/.test(n)) return "rust";
  if (/\b(ruby|rails|sinatra|rspec|activerecord)\b/.test(n)) return "ruby";
  if (/\b(php|laravel|symfony|composer|wordpress|drupal)\b/.test(n)) return "php";
  if (/\b(csharp|c\+\+|dotnet|\.net|asp\.net|entity framework|blazor)\b/.test(n)) return "dotnet";

  // System / architecture / algorithms
  if (/\b(system design|scalability|throughput|latency|architecture|microservice|monolith|serverless|edge|cdn)\b/.test(n)) return "system-design";
  if (/\b(algorithm|data structure|complexity|big o|leetcode|dp|dynamic programming|greedy|graph|tree|heap|stack|queue|linked list)\b/.test(n)) return "algo";
  if (/\b(concurrency|parallelism|threading|async|await|promise|goroutine)\b/.test(n)) return "concurrency";

  // Security
  if (/\b(security|encryption|hashing|tls|ssl|cors|csrf|xss|sql injection|owasp|oauth|oidc|jwt|saml|sso)\b/.test(n)) return "security";

  // API layer
  if (/\b(graphql|rest|grpc|websocket|sse|webhook|openapi|swagger|protobuf|thrift|api)\b/.test(n)) return "api";

  // Testing
  if (/\b(unit test|integration test|e2e|end to end|jest|mocha|vitest|cypress|playwright|selenium|junit|pytest|rspec|testing)\b/.test(n)) return "testing";

  // Version control
  if (/\b(git|github|gitlab|bitbucket|pull request|merge|rebase|cherry pick|branch)\b/.test(n)) return "git";

  // Generic backend catch-all (after specific stacks)
  if (/\b(backend|frontend|full stack|fullstack|full-stack|devops|sre|platform|infrastructure|infra)\b/.test(n)) return "backend";

  return "general";
}

function clampConfidence(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function isLikelyIncomplete(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (/[?]$/.test(t)) return false;
  if (CONNECTOR_RE.test(t)) return true;
  if (/\b(for|to|of|in|and|or)\s*$/i.test(t)) return true;
  if (/^(what is the|what is|how to|can you|could you|explain)\s*$/i.test(t)) return true;
  if (t.split(/\s+/).length < 4 && !isQuestionLike(t)) return true;
  return false;
}

function hasSemanticDependency(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  if (FOLLOWUP_SIGNAL_RE.test(t)) return true;
  if (WEAK_DEICTIC_RE.test(t)) return true;
  return /\b(that approach|that code|that query|that project|the previous answer|the code|the query|you said|you mentioned)\b/i.test(t);
}

export function detectActiveQuestion(input: {
  liveInterimText: string;
  allMessages: TranscriptEntry[];
  cutoffTimestamp: number;
  selectedAnswerQuestion?: string;
  selectedAnswerId?: string;
  /**
   * Normalized keys of questions already answered this session. A detected
   * candidate whose key matches one of these (and is NOT a follow-up) is
   * treated as stale noise so the auto path does not re-answer it.
   */
  answeredQuestionKeys?: string[];
}): ActiveQuestionDetectionResult {
  const live = normalizeSttTranscript(input.liveInterimText || "");
  const selectedQuestion = input.selectedAnswerQuestion?.trim() || "";
  const answeredKeySet = new Set(
    (input.answeredQuestionKeys ?? [])
      .map((k) => normalizeQuestionKey(k))
      .filter(Boolean),
  );
  const normalizedMessages = input.allMessages.map((entry) => ({
    ...entry,
    text: normalizeSttTranscript(entry.text || ""),
  }));

  const build = (
    question: string,
    source: ActiveQuestionDetectionResult["source"],
    confidence: number,
  ): ActiveQuestionDetectionResult => {
    const normalizedQuestion = normalizeSttTranscript(question || "");
    const cleanedQuestion =
      detectIntent(normalizedQuestion).cleanedQuestion || normalizedQuestion.trim();
    const baseNoise = !cleanedQuestion || isFillerPhrase(cleanedQuestion);
    const isAdminNoise = ADMIN_NOISE_RE.test(cleanedQuestion);
    const incomplete = isLikelyIncomplete(cleanedQuestion);
    const semanticDependency = hasSemanticDependency(cleanedQuestion);
    const isFollowUp = semanticDependency;
    // Stale/answered suppression: if this candidate is an already-answered
    // question and it isn't a follow-up, treat it as noise so the auto path
    // skips it instead of re-running an old answer.
    const alreadyAnswered =
      !isFollowUp &&
      !!cleanedQuestion &&
      answeredKeySet.has(normalizeQuestionKey(cleanedQuestion));
    const isNoise = baseNoise || isAdminNoise || alreadyAnswered;
    const currentTopic = deriveTopic(cleanedQuestion);
    const previousTopic = deriveTopic(selectedQuestion);
    const topicChanged =
      !!selectedQuestion &&
      currentTopic !== "general" &&
      previousTopic !== "general" &&
      currentTopic !== previousTopic &&
      !isFollowUp;

    return {
      activeQuestion: cleanedQuestion,
      cleanedQuestion,
      isFollowUp,
      topicChanged,
      confidenceScore: clampConfidence(
        confidence
          - (incomplete ? 0.28 : 0)
          - (isAdminNoise ? 0.3 : 0)
          - (alreadyAnswered ? 0.5 : 0),
      ),
      ignoredNoise: isNoise,
      referencedHistoryTurnId:
        isFollowUp && input.selectedAnswerId ? input.selectedAnswerId : undefined,
      source,
    };
  };

  if (live && !isFillerPhrase(live)) {
    const intent = detectIntent(live);
    const bonus = intent.isQuestion ? 0.15 : 0;
    return build(intent.cleanedQuestion, "live_interim", clampConfidence(intent.confidence + bonus));
  }

  const afterCutoff = normalizedMessages
    .filter((m) => (m.timestamp || 0) > input.cutoffTimestamp && m.text?.trim());
  const interviewerChunks = afterCutoff
    .filter((m) => m.sender === "Interviewer")
    .map((m) => m.text.trim());
  const interviewerMerged = mergeChunks(interviewerChunks);
  if (interviewerMerged && !isFillerPhrase(interviewerMerged)) {
    const parts = interviewerMerged
      .split(/(?<=[?.!])\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const scoredParts = parts.map((p) => ({
      part: p,
      score:
        (isLikelyIncomplete(p) ? 0 : 2) +
        (isQuestionLike(p) ? 2 : 0) +
        (p.match(/\b(databricks|pyspark|spark|adf|azure devops|experience|role|code|query|database|architecture|postgres|postgresql|mongodb)\b/gi)?.length || 0),
    }));
    const bestByScore = scoredParts.sort((a, b) => b.score - a.score)[0]?.part || interviewerMerged;
    let mostComplete =
      bestByScore.length >= Math.max(36, interviewerMerged.length * 0.45)
        ? bestByScore
        : interviewerMerged;
    const roleTail = parts.find((p) => /\bwhat is your role\b/i.test(p));
    if (roleTail && !mostComplete.toLowerCase().includes("what is your role")) {
      mostComplete = `${mostComplete.replace(/[?.!\s]*$/, "")} and ${roleTail.replace(/^\s*(and\s+)?/i, "")}`;
    }
    const intent = detectIntent(mostComplete);
    const confidence = intent.confidence + (isQuestionLike(mostComplete) ? 0.1 : 0);
    return build(intent.cleanedQuestion, "transcript_history", confidence);
  }

  const userChunks = afterCutoff
    .filter((m) => m.sender === "User")
    .map((m) => m.text.trim());
  const userMerged = mergeChunks(userChunks);
  if (userMerged && !isFillerPhrase(userMerged)) {
    const intent = detectIntent(userMerged);
    return build(intent.cleanedQuestion, "user_transcript", intent.confidence);
  }

  // Narrow the fallback to recent messages only (last 6, within 90 s) to
  // avoid pulling in questions from earlier in the session.
  const latestFallbackTs = normalizedMessages.reduce(
    (max, m) => Math.max(max, m.timestamp || 0),
    0,
  );
  const fallbackCutoff = latestFallbackTs > 0 ? latestFallbackTs - 90_000 : 0;
  const recentFallbackSrc = normalizedMessages.filter(
    (m) => (m.timestamp || 0) >= fallbackCutoff,
  );
  const fallbackPool = (
    recentFallbackSrc.length >= 2 ? recentFallbackSrc : normalizedMessages
  ).slice(-6);
  const fallbackMerged = mergeChunks(
    fallbackPool.map((m) => m.text || "").filter(Boolean),
  );
  if (fallbackMerged && !isFillerPhrase(fallbackMerged)) {
    const latestQuestionChunk = fallbackMerged
      .split(/(?<=[?.!])\s+/)
      .reverse()
      .find((part) => isQuestionLike(part) || TECH_TOPIC_RE.test(part));
    const chosen = latestQuestionChunk || fallbackMerged;
    const intent = detectIntent(chosen);
    return build(intent.cleanedQuestion, "transcript_fallback", intent.confidence * 0.9);
  }

  return {
    activeQuestion: "",
    cleanedQuestion: "",
    isFollowUp: false,
    topicChanged: false,
    confidenceScore: 0,
    ignoredNoise: true,
    source: "none",
  };
}
