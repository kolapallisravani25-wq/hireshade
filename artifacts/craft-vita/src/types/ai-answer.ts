export type AIAnswerSpeakerType =
  | "interviewer"
  | "candidate"
  | "assistant"
  | "system";

export interface AIAnswerSpeakerEntry {
  speakerType: AIAnswerSpeakerType;
  content: string;
  timestamp?: number;
}

export interface ActiveQuestionDetectionPayload {
  activeQuestion: string;
  cleanedQuestion: string;
  isFollowUp: boolean;
  topicChanged: boolean;
  confidenceScore: number;
  ignoredNoise: boolean;
  referencedHistoryTurnId?: string;
}

export interface QuestionMetaCorrection {
  from: string;
  to: string;
  reason: string;
}

export interface QuestionMeta {
  displayQuestion: string;
  intent: string;
  confidence: number;
  topic: string;
  isFollowUp: boolean;
  shouldAnswer: boolean;
  source: string;
  corrections: QuestionMetaCorrection[];
}

export interface PreviousAIAnswerMemory {
  question?: string;
  answer: string;
  codeBlocks?: string[];
}

export interface AIAnswerRequestPayload {
  transcript: string;
  requestId?: string;
  sessionId?: string;
  currentQuestion?: string;
  patchedTranscript?: string;
  isCustomQuery?: boolean;
  recentTranscriptWindow?: string[];
  speakerSeparatedTranscript?: AIAnswerSpeakerEntry[];
  previousAiAnswer?: string;
  previousAiAnswers?: PreviousAIAnswerMemory[];
  previousCodeBlocks?: string[];
  selectedAnswerId?: string;
  selectedAnswerQuestion?: string;
  selectedAnswerText?: string;
  selectedAnswerCodeBlocks?: string[];
  selectedAnswerTopic?: string;
  latestAnswerId?: string;
  latestAnswerQuestion?: string;
  latestAnswerText?: string;
  latestAnswerTopic?: string;
  selectedIntentId?: string;
  selectedAnswerIntentId?: string;
  answerClickMode?:
    | "answer_latest_unanswered"
    | "answer_selected_intent"
    | "reanswer_previous"
    | "regenerate_answer"
    | "answer_followup";
  answerMode?:
    | "auto"
    | "theory_only"
    | "minimal_code"
    | "code_required"
    | "explain_existing_code"
    | "system_design";
  sourcePlatform?: "web" | "tauri";
  triggerSource?: "auto" | "manual_click" | "overlay_click" | "custom_query";
  activeInterviewMode?: string;
  manualQueryType?: "full_question" | "short_followup" | "command" | "unknown";
  isRegenerate?: boolean;
  regenerateTargetAnswerId?: string;
  regenerateInstruction?: string;
  activeQuestionDetection?: ActiveQuestionDetectionPayload;
}

export const AI_ANSWER_LIMITS = {
  recentTranscriptWindowMax: 60,
  previousAiAnswerMaxChars: 3000,
  previousAiAnswersMax: 3,
  previousAiAnswerQuestionMaxChars: 500,
  previousCodeBlocksMax: 2,
  previousCodeBlockMaxChars: 1500,
  selectedAnswerQuestionMaxChars: 500,
  selectedAnswerTextMaxChars: 3000,
  selectedAnswerTopicMaxChars: 80,
  latestAnswerIdMaxChars: 120,
  regenerateTargetAnswerIdMaxChars: 120,
  regenerateInstructionMaxChars: 500,
} as const;

export function normalizeSpeakerType(input: string): AIAnswerSpeakerType {
  const key = (input || "").toLowerCase().trim();
  if (key === "interviewer") return "interviewer";
  if (key === "candidate" || key === "user") return "candidate";
  if (key === "assistant" || key === "ai") return "assistant";
  return "system";
}

export function extractCodeBlocks(text: string): string[] {
  if (!text?.trim()) return [];
  const matches = text.match(/```[\s\S]*?```/g) || [];
  return matches;
}

const SHORT_FOLLOWUP_COMMANDS = new Set([
  "example",
  "explain",
  "explain it",
  "give example",
  "give me example",
  "show example",
  "more",
  "why",
  "how",
  "continue",
  "elaborate",
]);

function normalizeManualCommand(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyManualQueryType(
  text: string,
): NonNullable<AIAnswerRequestPayload["manualQueryType"]> {
  const normalized = normalizeManualCommand(text);
  if (!normalized) return "unknown";
  if (SHORT_FOLLOWUP_COMMANDS.has(normalized)) return "short_followup";
  if (/^(click ai answer|clear transcript|enable automation|disable automation|next question|stop recording|start recording|open overlay|close overlay)$/i.test(normalized)) {
    return "command";
  }
  if (/[?]/.test(text) || /^(what|why|how|when|where|which|who|can|could|would|should|is|are|do|does|did|explain|define|describe|tell me|write|implement|design)\b/i.test(text)) {
    return "full_question";
  }
  return "unknown";
}

export function sanitizeAIAnswerPayload(
  payload: AIAnswerRequestPayload,
): AIAnswerRequestPayload {
  const transcript = (payload.transcript || "").trim();
  const currentQuestion = payload.currentQuestion?.trim() || undefined;
  const patchedTranscript = payload.patchedTranscript?.trim() || undefined;
  const previousAiAnswer = payload.previousAiAnswer
    ? payload.previousAiAnswer.slice(0, AI_ANSWER_LIMITS.previousAiAnswerMaxChars)
    : undefined;
  const previousAiAnswers = (payload.previousAiAnswers || [])
    .slice(-AI_ANSWER_LIMITS.previousAiAnswersMax)
    .map((entry) => ({
      ...(entry.question
        ? {
            question: entry.question
              .slice(0, AI_ANSWER_LIMITS.previousAiAnswerQuestionMaxChars)
              .trim(),
          }
        : {}),
      answer: (entry.answer || "")
        .slice(0, AI_ANSWER_LIMITS.previousAiAnswerMaxChars)
        .trim(),
      ...(Array.isArray(entry.codeBlocks)
        ? {
            codeBlocks: entry.codeBlocks
              .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
              .map((block) =>
                block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars),
              )
              .filter((block) => block.trim().length > 0),
          }
        : {}),
    }))
    .filter((entry) => entry.answer.length > 0);
  const previousCodeBlocks = (payload.previousCodeBlocks || [])
    .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
    .map((block) => block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars))
    .filter((block) => block.trim().length > 0);
  const selectedAnswerQuestion = payload.selectedAnswerQuestion
    ? payload.selectedAnswerQuestion.slice(0, AI_ANSWER_LIMITS.selectedAnswerQuestionMaxChars)
    : undefined;
  const selectedAnswerText = payload.selectedAnswerText
    ? payload.selectedAnswerText.slice(0, AI_ANSWER_LIMITS.selectedAnswerTextMaxChars)
    : undefined;
  const selectedAnswerCodeBlocks = (payload.selectedAnswerCodeBlocks || [])
    .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
    .map((block) => block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars))
    .filter((block) => block.trim().length > 0);
  const selectedAnswerTopic = payload.selectedAnswerTopic
    ? payload.selectedAnswerTopic.slice(0, AI_ANSWER_LIMITS.selectedAnswerTopicMaxChars)
    : undefined;
  const latestAnswerId = payload.latestAnswerId
    ? payload.latestAnswerId.slice(0, AI_ANSWER_LIMITS.latestAnswerIdMaxChars)
    : undefined;
  const latestAnswerQuestion = payload.latestAnswerQuestion
    ? payload.latestAnswerQuestion.slice(0, AI_ANSWER_LIMITS.selectedAnswerQuestionMaxChars)
    : undefined;
  const latestAnswerText = payload.latestAnswerText
    ? payload.latestAnswerText.slice(0, AI_ANSWER_LIMITS.selectedAnswerTextMaxChars)
    : undefined;
  const latestAnswerTopic = payload.latestAnswerTopic
    ? payload.latestAnswerTopic.slice(0, AI_ANSWER_LIMITS.selectedAnswerTopicMaxChars)
    : undefined;
  const regenerateTargetAnswerId = payload.regenerateTargetAnswerId
    ? payload.regenerateTargetAnswerId.slice(0, AI_ANSWER_LIMITS.regenerateTargetAnswerIdMaxChars)
    : undefined;
  const regenerateInstruction = payload.regenerateInstruction
    ? payload.regenerateInstruction.slice(0, AI_ANSWER_LIMITS.regenerateInstructionMaxChars)
    : undefined;
  const activeQuestionDetection = payload.activeQuestionDetection
    ? {
        activeQuestion: payload.activeQuestionDetection.activeQuestion.slice(0, 2000),
        cleanedQuestion: payload.activeQuestionDetection.cleanedQuestion.slice(0, 2000),
        isFollowUp: !!payload.activeQuestionDetection.isFollowUp,
        topicChanged: !!payload.activeQuestionDetection.topicChanged,
        confidenceScore: Math.max(0, Math.min(1, Number(payload.activeQuestionDetection.confidenceScore || 0))),
        ignoredNoise: !!payload.activeQuestionDetection.ignoredNoise,
        ...(payload.activeQuestionDetection.referencedHistoryTurnId
          ? { referencedHistoryTurnId: payload.activeQuestionDetection.referencedHistoryTurnId.slice(0, 120) }
          : {}),
      }
    : undefined;
  const recentTranscriptWindow = (payload.recentTranscriptWindow || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(-AI_ANSWER_LIMITS.recentTranscriptWindowMax);
  const speakerSeparatedTranscript = (payload.speakerSeparatedTranscript || [])
    .map((entry) => ({
      speakerType: normalizeSpeakerType(entry.speakerType),
      content: (entry.content || "").trim(),
      ...(typeof entry.timestamp === "number" ? { timestamp: entry.timestamp } : {}),
    }))
    .filter((entry) => entry.content.length > 0)
    .slice(-AI_ANSWER_LIMITS.recentTranscriptWindowMax);

  return {
    transcript,
    ...(payload.requestId ? { requestId: payload.requestId } : {}),
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(currentQuestion ? { currentQuestion } : {}),
    ...(patchedTranscript ? { patchedTranscript } : {}),
    ...(recentTranscriptWindow.length > 0 ? { recentTranscriptWindow } : {}),
    ...(speakerSeparatedTranscript.length > 0
      ? { speakerSeparatedTranscript }
      : {}),
    ...(previousAiAnswer ? { previousAiAnswer } : {}),
    ...(previousAiAnswers.length > 0 ? { previousAiAnswers } : {}),
    ...(previousCodeBlocks.length > 0 ? { previousCodeBlocks } : {}),
    ...(payload.selectedAnswerId ? { selectedAnswerId: payload.selectedAnswerId } : {}),
    ...(selectedAnswerQuestion ? { selectedAnswerQuestion } : {}),
    ...(selectedAnswerText ? { selectedAnswerText } : {}),
    ...(selectedAnswerCodeBlocks.length > 0 ? { selectedAnswerCodeBlocks } : {}),
    ...(selectedAnswerTopic ? { selectedAnswerTopic } : {}),
    ...(latestAnswerId ? { latestAnswerId } : {}),
    ...(latestAnswerQuestion ? { latestAnswerQuestion } : {}),
    ...(latestAnswerText ? { latestAnswerText } : {}),
    ...(latestAnswerTopic ? { latestAnswerTopic } : {}),
    ...(payload.selectedIntentId ? { selectedIntentId: payload.selectedIntentId } : {}),
    ...(payload.selectedAnswerIntentId ? { selectedAnswerIntentId: payload.selectedAnswerIntentId } : {}),
    ...(payload.answerClickMode ? { answerClickMode: payload.answerClickMode } : {}),
    ...(payload.answerMode ? { answerMode: payload.answerMode } : {}),
    ...(payload.sourcePlatform ? { sourcePlatform: payload.sourcePlatform } : {}),
    ...(payload.triggerSource ? { triggerSource: payload.triggerSource } : {}),
    ...(payload.activeInterviewMode ? { activeInterviewMode: payload.activeInterviewMode } : {}),
    ...(payload.manualQueryType ? { manualQueryType: payload.manualQueryType } : {}),
    ...(payload.isCustomQuery ? { isCustomQuery: true } : {}),
    ...(payload.isRegenerate ? { isRegenerate: true } : {}),
    ...(regenerateTargetAnswerId ? { regenerateTargetAnswerId } : {}),
    ...(regenerateInstruction ? { regenerateInstruction } : {}),
    ...(activeQuestionDetection ? { activeQuestionDetection } : {}),
  };
}

export function resolveQueryFromAIAnswerPayload(
  payload: AIAnswerRequestPayload,
): string {
  return (
    payload.patchedTranscript?.trim() ||
    payload.currentQuestion?.trim() ||
    payload.transcript.trim() ||
    (payload.recentTranscriptWindow || []).join("\n").trim()
  );
}

export function resolveTranscriptFromAIAnswerPayload(
  payload: AIAnswerRequestPayload,
): string {
  return (
    payload.transcript.trim() ||
    payload.currentQuestion?.trim() ||
    (payload.recentTranscriptWindow || []).join("\n").trim()
  );
}
