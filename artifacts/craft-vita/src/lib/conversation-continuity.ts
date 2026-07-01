export type ConversationMode =
  | "transcript"
  | "manual"
  | "regenerate"
  | "screenshot"
  | "button";

export interface ConversationContinuityState {
  lastResolvedQuestion: string;
  lastResolvedTopic: string;
  lastAnswerSummary: string;
  lastTechnicalEntities: string[];
  lastConversationMode: ConversationMode;
  lastUpdatedAt: number;
}

export interface FollowUpSignal {
  isFollowUp: boolean;
  confidence: number;
  reasons: string[];
}

export interface ResolveContinuityResult {
  rawQuestion: string;
  resolvedQuestion: string;
  confidence: number;
  usedPreviousTopic: boolean;
  reasons: string[];
}

const CONTINUATION_VERBS =
  /\b(explain|show|give|expand|continue|optimize|improve|refactor|implement|detail|elaborate|example)\b/i;
const PRONOUN_REF = /\b(this|that|it|they|them|those|these|same|above|previous)\b/i;
const DEICTIC_SHORT = /^(how|why|what|and|then|next|example|code)\??$/i;

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTopicAndEntities(text: string): {
  topic: string;
  entities: string[];
} {
  const raw = (text || "").trim();
  if (!raw) return { topic: "", entities: [] };
  const words = raw.split(/\s+/);
  const entities = words
    .filter((w) => /[A-Z]/.test(w) || /[a-zA-Z0-9_.:-]{4,}/.test(w))
    .map((w) => w.replace(/[^\p{L}\p{N}_.:-]/gu, ""))
    .filter(Boolean)
    .slice(0, 10);

  const sentence = raw
    .split(/[.?!]/)
    .map((s) => s.trim())
    .find(Boolean) || raw;
  const topic = sentence.slice(0, 180);
  return { topic, entities: Array.from(new Set(entities)) };
}

export function summarizeAnswerForMemory(answerText: string): string {
  const cleaned = (answerText || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 260);
}

export function detectFollowUpSignal(
  rawQuestion: string,
  context: ConversationContinuityState | null,
): FollowUpSignal {
  const q = (rawQuestion || "").trim();
  const normalized = normalize(q);
  const words = normalized.split(" ").filter(Boolean);
  const reasons: string[] = [];
  let score = 0;

  if (words.length <= 4) {
    score += 0.35;
    reasons.push("short_prompt");
  }
  if (PRONOUN_REF.test(q)) {
    score += 0.35;
    reasons.push("pronoun_reference");
  }
  if (CONTINUATION_VERBS.test(q)) {
    score += 0.25;
    reasons.push("continuation_verb");
  }
  if (DEICTIC_SHORT.test(q)) {
    score += 0.4;
    reasons.push("deictic_short");
  }

  const lowEntity = extractTopicAndEntities(q).entities.length <= 1;
  if (lowEntity) {
    score += 0.2;
    reasons.push("low_entity_density");
  }

  if (context?.lastResolvedTopic) {
    score += 0.15;
    reasons.push("prior_topic_available");
  }

  const confidence = Math.min(1, score);
  return {
    isFollowUp: confidence >= 0.65 && !!context?.lastResolvedTopic,
    confidence,
    reasons,
  };
}

export function resolveQuestionWithContinuity(
  rawQuestion: string,
  context: ConversationContinuityState | null,
): ResolveContinuityResult {
  const trimmed = (rawQuestion || "").trim();
  const signal = detectFollowUpSignal(trimmed, context);
  if (!signal.isFollowUp || !context?.lastResolvedTopic) {
    return {
      rawQuestion: trimmed,
      resolvedQuestion: trimmed,
      confidence: signal.confidence,
      usedPreviousTopic: false,
      reasons: signal.reasons,
    };
  }

  const topic = context.lastResolvedTopic.trim();
  const resolvedQuestion = `${trimmed} (in context of: ${topic})`;
  return {
    rawQuestion: trimmed,
    resolvedQuestion,
    confidence: signal.confidence,
    usedPreviousTopic: true,
    reasons: signal.reasons,
  };
}

