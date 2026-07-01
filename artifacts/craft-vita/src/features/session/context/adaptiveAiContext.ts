import { AI_ANSWER_LIMITS, extractCodeBlocks, normalizeSpeakerType } from "@/types/ai-answer";
import { normalizeSttTranscript } from "@/features/session/transcript/stt-normalizer";

const CONNECTOR_TAIL_RE = /\b(and|or|then|also|plus|because|so|where)\s*$/i;
const INCOMPLETE_TAIL_RE = /\b(for|to|of|in|and|or|where|with)\s*$/i;
const QUESTION_LIKE_RE =
  /^(what|why|how|when|where|which|who|can|could|would|should|is|are|do|does|did|explain|describe|tell me|walk me|write|implement|create|build|show|give)\b/i;
const INTERVIEW_PROMPT_START_RE =
  /\b(before we start|technical round|quick intro|introduce|tell me|explain|describe|walk me|can you|could you|would you|what|how|why|where|when|write|implement|create|build|show|give)\b/i;

export interface AdaptiveTranscriptEntry {
  sender: "User" | "Interviewer";
  text: string;
  timestamp?: number;
}

export interface AdaptiveAiAnswerMessage {
  sender: "AI";
  text?: string;
  question?: string;
}

export interface AdaptivePreviousAnswer {
  question?: string;
  answer: string;
  codeBlocks?: string[];
}

export interface AdaptiveContextResult {
  currentQuestion: string;
  recentTranscriptWindow: string[];
  speakerSeparatedTranscript: Array<{
    speakerType: "interviewer" | "candidate" | "assistant" | "system";
    content: string;
    timestamp?: number;
  }>;
  previousAiAnswers: AdaptivePreviousAnswer[];
  previousAiAnswer?: string;
  previousCodeBlocks?: string[];
  windowSizeUsed: number;
  expandedReason: "base" | "small_context" | "weak_question";
}

function normalizeLine(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function isQuestionLike(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  const stripped = stripLeadingConjunctionsAndFillers(t);
  return QUESTION_LIKE_RE.test(stripped);
}

function isLikelyIncomplete(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (t.length < 24 && !isQuestionLike(t)) return true;
  if (CONNECTOR_TAIL_RE.test(t)) return true;
  if (INCOMPLETE_TAIL_RE.test(t)) return true;
  return false;
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(normalizeLine(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeLine(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function areNearDuplicateTexts(a: string, b: string): boolean {
  const na = normalizeLine(a);
  const nb = normalizeLine(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length < 20) return false;
  return longer.includes(shorter);
}

function removeOverlap(left: string, right: string): string {
  const leftWords = normalizeLine(left).split(" ").filter(Boolean);
  const rightWords = normalizeLine(right).split(" ").filter(Boolean);
  let overlapCount = 0;
  const maxSearch = Math.min(leftWords.length, rightWords.length, 16);
  for (let len = 1; len <= maxSearch; len += 1) {
    if (leftWords.slice(-len).join(" ") === rightWords.slice(0, len).join(" ")) {
      overlapCount = len;
    }
  }
  if (!overlapCount) return right;
  return right.trim().split(/\s+/).slice(overlapCount).join(" ");
}

function dedupeAndMergeEntries(
  entries: AdaptiveTranscriptEntry[],
): AdaptiveTranscriptEntry[] {
  if (!entries.length) return [];
  const ordered = [...entries]
    .filter((entry) => entry.text?.trim())
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const deduped: AdaptiveTranscriptEntry[] = [];
  for (const current of ordered) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.sender === current.sender &&
      areNearDuplicateTexts(prev.text, current.text) &&
      (
        typeof prev.timestamp !== "number" ||
        typeof current.timestamp !== "number" ||
        current.timestamp - prev.timestamp <= 2500
      )
    ) {
      if ((current.text || "").trim().length > (prev.text || "").trim().length) {
        deduped[deduped.length - 1] = current;
      }
      continue;
    }
    deduped.push({
      sender: current.sender,
      text: current.text.trim(),
      ...(typeof current.timestamp === "number"
        ? { timestamp: current.timestamp }
        : {}),
    });
  }

  const merged: AdaptiveTranscriptEntry[] = [];
  for (const current of deduped) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(current);
      continue;
    }
    if (prev.sender === current.sender && CONNECTOR_TAIL_RE.test(prev.text)) {
      merged[merged.length - 1] = {
        ...prev,
        text: `${prev.text} ${current.text}`.replace(/\s+/g, " ").trim(),
        timestamp: current.timestamp ?? prev.timestamp,
      };
      continue;
    }
    if (prev.sender === current.sender) {
      const withoutOverlap = removeOverlap(prev.text, current.text).trim();
      if (withoutOverlap) {
        merged.push({
          ...current,
          text: withoutOverlap,
        });
      }
      continue;
    }
    merged.push(current);
  }

  return merged.filter((entry) => entry.text.trim().length > 0);
}

function buildInterviewerCompoundQuestion(
  entries: AdaptiveTranscriptEntry[],
): string {
  const RECENT_WINDOW_MS = 90_000;

  // Prefer chunks from the last 90 s so old answered questions don't pollute
  // the compound. Fall back to the full set when the window yields too few.
  const latestTs = entries.reduce((max, e) => Math.max(max, e.timestamp ?? 0), 0);
  const recentSrc =
    latestTs > 0
      ? entries.filter((e) => (e.timestamp ?? 0) >= latestTs - RECENT_WINDOW_MS)
      : entries;
  const sourceEntries = recentSrc.length >= 2 ? recentSrc : entries;

  const interviewerChunks = sourceEntries
    .filter((entry) => entry.sender === "Interviewer")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  if (!interviewerChunks.length) return "";

  // Find the LAST question-start marker to anchor to the most recent question.
  let startIndex = -1;
  for (let i = interviewerChunks.length - 1; i >= 0; i--) {
    if (INTERVIEW_PROMPT_START_RE.test(interviewerChunks[i])) {
      startIndex = i;
      break;
    }
  }

  const interviewer =
    startIndex >= 0 ? interviewerChunks.slice(startIndex) : interviewerChunks;
  return interviewer
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:so|okay|great|right|perfect)[,.;:\s]+)+/i, "")
    .trim();
}

function buildTranscriptCompoundQuestion(
  entries: AdaptiveTranscriptEntry[],
): string {
  const chunks = entries
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  if (!chunks.length) return "";
  let startIndex = -1;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    if (INTERVIEW_PROMPT_START_RE.test(chunks[index])) {
      startIndex = index;
      break;
    }
  }
  const scoped = startIndex >= 0 ? chunks.slice(startIndex) : chunks;
  return scoped
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:so|okay|great|right|perfect)[,.;:\s]+)+/i, "")
    .trim();
}

function containsTokenSequence(tokens: string[], sequence: string[]): boolean {
  if (!tokens.length || !sequence.length || sequence.length > tokens.length) {
    return false;
  }
  for (let i = 0; i <= tokens.length - sequence.length; i += 1) {
    if (sequence.every((token, index) => tokens[i + index] === token)) {
      return true;
    }
  }
  return false;
}

function mergeFallbackTailIntoCompound(compound: string, fallback: string): string {
  const cleanCompound = compound.replace(/\s+/g, " ").trim();
  const cleanFallback = fallback.replace(/\s+/g, " ").trim();
  if (!cleanCompound || !cleanFallback) return cleanCompound || cleanFallback;

  const compoundTokens = normalizeLine(cleanCompound).split(" ").filter(Boolean);
  const fallbackWords = cleanFallback.split(/\s+/).filter(Boolean);
  const fallbackTokens = fallbackWords.map((word) => normalizeLine(word)).filter(Boolean);
  let prefixLength = 0;
  for (let length = Math.min(fallbackTokens.length, compoundTokens.length); length >= 3; length -= 1) {
    if (containsTokenSequence(compoundTokens, fallbackTokens.slice(0, length))) {
      prefixLength = length;
      break;
    }
  }

  if (!prefixLength || prefixLength >= fallbackWords.length) {
    return cleanCompound;
  }

  const suffix = fallbackWords.slice(prefixLength).join(" ").trim();
  if (!suffix) return cleanCompound;
  return `${cleanCompound.replace(/[?.!,;:]+$/g, "")} ${suffix}`
    .replace(/\s+/g, " ")
    .trim();
}

function pickWindow(
  entries: AdaptiveTranscriptEntry[],
  count: number,
  timeWindowMs: number,
): AdaptiveTranscriptEntry[] {
  if (!entries.length) return [];
  const byCount = entries.slice(-count);
  const lastTs = entries[entries.length - 1]?.timestamp;
  if (typeof lastTs !== "number") {
    return byCount;
  }
  const cutoff = lastTs - timeWindowMs;
  const byTime = entries.filter(
    (entry) => typeof entry.timestamp === "number" && entry.timestamp >= cutoff,
  );
  return byTime.length > byCount.length ? byTime : byCount;
}

function buildPreviousAnswers(
  aiMessages: AdaptiveAiAnswerMessage[],
): AdaptivePreviousAnswer[] {
  return aiMessages
    .filter((message) => (message.text || "").trim().length > 0)
    .slice(-AI_ANSWER_LIMITS.previousAiAnswersMax)
    .map((message) => {
      const answer = (message.text || "").trim();
      const question = (message.question || "").trim();
      const codeBlocks = extractCodeBlocks(answer);
      return {
        ...(question ? { question } : {}),
        answer,
        ...(codeBlocks.length > 0 ? { codeBlocks } : {}),
      };
    });
}

export function buildAdaptiveAiContext(input: {
  transcriptMessages: AdaptiveTranscriptEntry[];
  aiMessages: AdaptiveAiAnswerMessage[];
  fallbackQuestion?: string;
  liveInterimQuestion?: string;
  cutoffTimestamp?: number | null;
}): AdaptiveContextResult {
  const transcriptMessages = input.transcriptMessages
    .filter((entry) => (entry.text || "").trim().length > 0)
    .map((entry) => ({
      sender: entry.sender,
      text: normalizeSttTranscript(entry.text),
      ...(typeof entry.timestamp === "number"
        ? { timestamp: entry.timestamp }
        : {}),
    }));

  const scoped = typeof input.cutoffTimestamp === "number"
    ? transcriptMessages.filter(
        (entry) =>
          typeof entry.timestamp !== "number" || entry.timestamp > input.cutoffTimestamp!,
      )
    : transcriptMessages;
  const mergedScoped = dedupeAndMergeEntries(scoped);
  const mergedAll = dedupeAndMergeEntries(transcriptMessages);
  const selectedSource = mergedScoped.length > 0 ? mergedScoped : mergedAll;

  let windowSizeUsed = 20;
  let expandedReason: AdaptiveContextResult["expandedReason"] = "base";
  let selected = pickWindow(selectedSource, windowSizeUsed, 90_000);
  const selectedChars = selected.reduce((sum, entry) => sum + entry.text.length, 0);

  if (selected.length < 10 || selectedChars < 300) {
    windowSizeUsed = 40;
    expandedReason = "small_context";
    selected = pickWindow(selectedSource, windowSizeUsed, 180_000);
  }

  let interviewerQuestion = buildInterviewerCompoundQuestion(selected);
  let transcriptQuestion = interviewerQuestion || buildTranscriptCompoundQuestion(selected);
  const fallbackQuestion = normalizeSttTranscript(input.fallbackQuestion || "");
  const liveInterimQuestion = normalizeSttTranscript(input.liveInterimQuestion || "");
  if (transcriptQuestion && fallbackQuestion) {
    transcriptQuestion = mergeFallbackTailIntoCompound(
      transcriptQuestion,
      fallbackQuestion,
    );
  }
  let currentQuestion = transcriptQuestion || fallbackQuestion || liveInterimQuestion;

  const shouldUseInterviewerCompound =
    transcriptQuestion &&
    fallbackQuestion &&
    transcriptQuestion.split(/\s+/).length > fallbackQuestion.split(/\s+/).length + 4 &&
    tokenOverlapRatio(transcriptQuestion, fallbackQuestion) >= 0.2 &&
    tokenOverlapRatio(transcriptQuestion, fallbackQuestion) <= 0.85;
  if (shouldUseInterviewerCompound) {
    currentQuestion = transcriptQuestion;
  }

  if (isLikelyIncomplete(currentQuestion) && windowSizeUsed < 60) {
    windowSizeUsed = 60;
    expandedReason = "weak_question";
    selected = pickWindow(selectedSource, windowSizeUsed, 240_000);
    interviewerQuestion = buildInterviewerCompoundQuestion(selected);
    transcriptQuestion = interviewerQuestion || buildTranscriptCompoundQuestion(selected);
    if (transcriptQuestion && fallbackQuestion) {
      transcriptQuestion = mergeFallbackTailIntoCompound(
        transcriptQuestion,
        fallbackQuestion,
      );
    }
    currentQuestion = transcriptQuestion || currentQuestion;
  }

  currentQuestion = currentQuestion.replace(/\s+/g, " ").trim();

  const recentTranscriptWindow = selected.map(
    (entry) => `[${entry.sender}]: ${entry.text}`,
  );
  const speakerSeparatedTranscript = selected.map((entry) => ({
    speakerType: normalizeSpeakerType(entry.sender),
    content: entry.text,
    ...(typeof entry.timestamp === "number" ? { timestamp: entry.timestamp } : {}),
  }));

  const previousAiAnswers = buildPreviousAnswers(input.aiMessages);
  const latest = previousAiAnswers[previousAiAnswers.length - 1];

  return {
    currentQuestion,
    recentTranscriptWindow,
    speakerSeparatedTranscript,
    previousAiAnswers,
    ...(latest ? { previousAiAnswer: latest.answer } : {}),
    ...(latest?.codeBlocks?.length ? { previousCodeBlocks: latest.codeBlocks } : {}),
    windowSizeUsed,
    expandedReason,
  };
}
