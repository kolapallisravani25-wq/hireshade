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
const TECH_TOPIC_RE = /\b(databricks|pyspark|spark|adf|azure devops|azure|sql|postgres|postgresql|mongodb|node|react|api|code|query|database|architecture|backend|frontend)\b/i;
const ADMIN_NOISE_RE =
  /\b(aadhaar|pan card|camera|show it|government id|audible|rejoin|wait a minute|hold)\b/i;

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

function deriveTopic(text: string): string {
  const n = norm(text);
  if (/\b(databricks|pyspark|spark)\b/.test(n)) return "spark";
  if (/\b(adf|azure devops|azure)\b/.test(n)) return "azure";
  if (/\b(sql|postgres|query)\b/.test(n)) return "sql";
  if (/\b(mongo|mongodb|mongoose)\b/.test(n)) return "mongo";
  if (/\b(node|express|api)\b/.test(n)) return "backend";
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
}): ActiveQuestionDetectionResult {
  const live = normalizeSttTranscript(input.liveInterimText || "");
  const selectedQuestion = input.selectedAnswerQuestion?.trim() || "";
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
    const isNoise = baseNoise || isAdminNoise;
    const semanticDependency = hasSemanticDependency(cleanedQuestion);
    const isFollowUp = semanticDependency;
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
          - (isAdminNoise ? 0.3 : 0),
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
