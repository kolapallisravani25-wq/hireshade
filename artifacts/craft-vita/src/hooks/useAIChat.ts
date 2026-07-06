import { useState, useCallback, useRef, useEffect } from "react";
import { Message } from "@/pages/Sessions/ActiveSession/Transcript";
import {
  type AIAnswerRequestPayload,
  AI_ANSWER_LIMITS,
  extractCodeBlocks,
  type QuestionMeta,
  sanitizeAIAnswerPayload,
  resolveQueryFromAIAnswerPayload,
  classifyManualQueryType,
} from "@/types/ai-answer";
import { isTauri } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/globalAuth";
import {
  createSessionOperationRegistry,
  type SessionOperationKind,
} from "@/features/session/runtime/sessionRuntime";
import {
  type ConversationContinuityState,
  type ConversationMode,
  extractTopicAndEntities,
  resolveQuestionWithContinuity,
  summarizeAnswerForMemory,
} from "@/lib/conversation-continuity";
import {
  prepareGeneration,
  createGenerationGuard,
  generateSegmentId,
  type GenerationMode,
  type GenerationDecision
} from '@/lib/generation-pipeline';
import { normalizeSttTranscript } from "@/features/session/transcript/stt-normalizer";

const SEGMENT_MARKER = /\n?={3,}NEXT_QUESTION={3,}\n?/;
const QUESTION_MARKER = /(?:\*\*\s*)?QUESTION\s*:/i;
// Backend sentinel: the model returns this single line when the input block
// contains no genuine new interview question. We must not render a card for it.
const NO_QUESTION_MARKER = /={3,}\s*NO_NEW_QUESTION\s*={3,}/i;
const QUESTION_META_MARKER = /={3,}QUESTION_META=([^\n]+?)={3,}\n?/i;
const NO_QUESTION_MESSAGE =
  "No question found on this screen. If you have a question, let me know.";

function sanitizeGeneratedQuestionTitle(text: string): string {
  return (text || "")
    .replace(/\[(?:user|candidate|interviewer|assistant|system)\]\s*:\s*/gi, "")
    .replace(/(^|[.!?]\s+)(?:candidate|user|interviewer|assistant|system)\s*:\s*/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function removeEmptyAiPlaceholders(messages: Message[]): Message[] {
  return messages.filter((message) => {
    if (message.sender !== "AI") return true;
    if (message.text.trim()) return true;
    if (message.question?.trim()) return true;
    if (message.questionMeta) return true;
    if (message.snapshotId) return true;
    if (message.originalGenerationContext?.originalQuestion?.trim()) return true;
    if (message.originalGenerationContext?.currentQuestion?.trim()) return true;
    return false;
  });
}

type AIAnswerRequestInput = string | AIAnswerRequestPayload;
type OriginalGenerationContext = NonNullable<Message["originalGenerationContext"]>;
/**
 * Session-gone (HTTP 410) contract. The server returns 410 SESSION_NOT_ACTIVE
 * from /ai-answer and /analyze-screen when the session has been settled
 * (credit exhaustion, free-cap, reaper, ended on another device) — in-session
 * AI is billed by the per-minute meter, so it is only reachable while ACTIVE.
 * 409 could not be reused: these hooks treat 409 as "duplicate request in
 * flight" and silently drop the card, which is exactly the wrong UX for an
 * ended session. On 410 we notify the page (same teardown path the heartbeat
 * uses) and let the caller clean up its placeholder.
 */
export const SESSION_NOT_ACTIVE_EVENT = "hireshade:session-not-active";

function notifySessionGone(sessionId: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent(SESSION_NOT_ACTIVE_EVENT, { detail: { sessionId } }),
    );
  } catch {
    /* non-DOM context */
  }
}

const REGENERATE_DEFAULT_INSTRUCTION =
  "Regenerate the same answer with more depth and clearer structure. Do not say previous context is unavailable.";

function buildOriginalGenerationContextFromPayload(
  payload: AIAnswerRequestPayload,
  fallbackSourcePlatform: "web" | "tauri",
): OriginalGenerationContext {
  const transcript = (payload.transcript || "").slice(0, 8_000);
  const currentQuestion = (payload.currentQuestion || "").slice(0, 1_000);
  const recentTranscriptWindow = (payload.recentTranscriptWindow || [])
    .slice(-AI_ANSWER_LIMITS.recentTranscriptWindowMax)
    .map((item) => item.slice(0, 600));
  const speakerSeparatedTranscript = (payload.speakerSeparatedTranscript || [])
    .slice(-AI_ANSWER_LIMITS.recentTranscriptWindowMax)
    .map((entry) => ({
      speakerType: entry.speakerType,
      content: (entry.content || "").slice(0, 600),
      ...(typeof entry.timestamp === "number" ? { timestamp: entry.timestamp } : {}),
    }));
  const previousAiAnswers = (payload.previousAiAnswers || [])
    .slice(-AI_ANSWER_LIMITS.previousAiAnswersMax)
    .map((entry) => ({
      ...(entry.question ? { question: entry.question.slice(0, 500) } : {}),
      answer: (entry.answer || "").slice(0, 1000),
      ...(entry.codeBlocks?.length
        ? {
            codeBlocks: entry.codeBlocks
              .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
              .map((block) =>
                block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars),
              ),
          }
        : {}),
    }));
  return {
    originalQuestion: (currentQuestion || transcript).slice(0, 1000),
    originalTranscript: transcript,
    currentQuestion: currentQuestion || undefined,
    ...(recentTranscriptWindow.length > 0 ? { recentTranscriptWindow } : {}),
    ...(speakerSeparatedTranscript.length > 0 ? { speakerSeparatedTranscript } : {}),
    ...(previousAiAnswers.length > 0 ? { previousAiAnswers } : {}),
    ...(payload.latestAnswerId ? { latestAnswerId: payload.latestAnswerId } : {}),
    ...(payload.latestAnswerQuestion
      ? {
          latestAnswerQuestion: payload.latestAnswerQuestion.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerQuestionMaxChars,
          ),
        }
      : {}),
    ...(payload.latestAnswerText
      ? {
          latestAnswerText: payload.latestAnswerText.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerTextMaxChars,
          ),
        }
      : {}),
    ...(payload.latestAnswerTopic
      ? {
          latestAnswerTopic: payload.latestAnswerTopic.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerTopicMaxChars,
          ),
        }
      : {}),
    ...(payload.selectedAnswerId ? { selectedAnswerId: payload.selectedAnswerId } : {}),
    ...(payload.selectedAnswerQuestion
      ? {
          selectedAnswerQuestion: payload.selectedAnswerQuestion.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerQuestionMaxChars,
          ),
        }
      : {}),
    ...(payload.selectedAnswerText
      ? {
          selectedAnswerText: payload.selectedAnswerText.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerTextMaxChars,
          ),
        }
      : {}),
    ...(payload.selectedAnswerCodeBlocks?.length
      ? {
          selectedAnswerCodeBlocks: payload.selectedAnswerCodeBlocks
            .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
            .map((block) =>
              block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars),
            ),
        }
      : {}),
    ...(payload.selectedAnswerTopic
      ? {
          selectedAnswerTopic: payload.selectedAnswerTopic.slice(
            0,
            AI_ANSWER_LIMITS.selectedAnswerTopicMaxChars,
          ),
        }
      : {}),
    ...(payload.requestId ? { requestId: payload.requestId } : {}),
    ...(payload.answerClickMode ? { answerClickMode: payload.answerClickMode } : {}),
    ...(payload.manualQueryType ? { manualQueryType: payload.manualQueryType } : {}),
    ...(payload.activeInterviewMode ? { activeInterviewMode: payload.activeInterviewMode } : {}),
    answerMode: payload.answerMode || "auto",
    sourcePlatform: payload.sourcePlatform || fallbackSourcePlatform,
    generatedAnswerText: "",
    generatedCodeBlocks: [],
  };
}

/**
 * Sanitizes input question text to remove duplicate questions, sentences,
 * or consecutive repeating phrases before triggering AI answer.
 */
function deduplicateQuestionsInText(text: string): string {
  if (!text?.trim()) return text;

  // 1. Sentence-level deduplication
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const seen = new Set<string>();
  const uniqueSentences: string[] = [];

  for (const rawSentence of sentences) {
    const trimmed = rawSentence.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/gi, "").trim();
    if (!normalized) {
      uniqueSentences.push(trimmed);
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueSentences.push(trimmed);
  }
  let result = uniqueSentences.join(" ");

  // 2. Phrase-level consecutive sequence deduplication
  const deduplicatePhrases = (str: string): string => {
    const words = str.split(/\s+/);
    const normalizedWords = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, ""));
    for (let len = 2; len <= Math.floor(words.length / 2); len++) {
      for (let i = 0; i <= words.length - 2 * len; i++) {
        const first = normalizedWords.slice(i, i + len).join(" ");
        const second = normalizedWords.slice(i + len, i + 2 * len).join(" ");
        if (first && first === second) {
          words.splice(i + len, len);
          return deduplicatePhrases(words.join(" "));
        }
      }
    }
    return words.join(" ");
  };

  return deduplicatePhrases(result);
}

// ── Multi-question splitter ─────────────────────────────────────────────────
// Splits a joined transcript into individual interview questions.
// Handles: digit-numbered lists (1. / 1) / 1:), word-numbered lists,
//          and '?'-terminated multi-sentence sequences.
//
// Strategy: split on newline-anchored numbered prefixes first (most reliable),
// then fall back to splitting on '?' sentence boundaries.
function splitMultiQuestions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // ── Strategy 1: newline-anchored numbered list ──────────────────────────
  // Matches lines that START with: "1." / "1)" / "1:" / "1 ." etc.
  // Uses a plain split on the boundary before the number so we keep the
  // question text without the leading digit.
  const wordNumbers =
    "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|" +
    "thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
  // Matches a newline followed by optional whitespace then a number/word + delimiter
  const numberedBoundary = new RegExp(
    `\\n\\s*(?:\\d{1,2}|${wordNumbers})\\s*[.):\\-]\\s+`,
    "gi",
  );

  if (numberedBoundary.test(trimmed)) {
    // Reset lastIndex after test()
    numberedBoundary.lastIndex = 0;
    // Split on the boundary, then re-attach stripped number prefix text.
    // We split on the WHOLE boundary (digit + delimiter) so the segment text
    // starts cleanly with the actual question.
    const parts = trimmed
      .split(numberedBoundary)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
    if (parts.length >= 2) return parts;
  }

  // ── Strategy 2: inline numbered list (no newlines) ──────────────────────
  // Handles "1. Question one? 2. Question two?" on a single line.
  const inlineNumbered = new RegExp(
    `(?<![\\d])(?:\\d{1,2}|${wordNumbers})\\s*[.):\\-]\\s+`,
    "gi",
  );
  const inlineMatches = [...trimmed.matchAll(inlineNumbered)];
  if (inlineMatches.length >= 2) {
    const parts: string[] = [];
    let lastEnd = 0;
    for (const match of inlineMatches) {
      const segEnd = match.index!;
      if (segEnd > lastEnd) {
        const seg = trimmed.slice(lastEnd, segEnd).trim();
        if (seg.length > 10) parts.push(seg);
      }
      lastEnd = match.index! + match[0].length;
    }
    // Last segment after the final numbered prefix
    const tail = trimmed.slice(lastEnd).trim();
    if (tail.length > 10) parts.push(tail);
    if (parts.length >= 2) return parts;
  }

  // ── Strategy 3: '?' boundary split ──────────────────────────────────────
  // Split on '?' followed by whitespace or newline. Keep segments that contain
  // a '?' so single statements without '?' don't get treated as questions.
  const questionParts = trimmed
    .split(/\?\s+/)
    .map((s, i, arr) => {
      // Re-append the '?' that was consumed by split (except the last segment
      // which may naturally end with '?' or be empty).
      const withQ = i < arr.length - 1 ? s.trim() + "?" : s.trim();
      return withQ;
    })
    .filter((s) => s.length > 10);

  if (questionParts.length >= 2) return questionParts;

  return [trimmed];
}

const EXTRACT_QUESTION_FROM_ANSWER_RE =
  /^\s*(?:\*+\s*)?(?:summarized\s+question|question)\s*:?\s*(?:\*+)?\s*([\s\S]*?)\s*(?:\*+\s*)?(?:answer)\s*:?\s*(?:\*+)?\s*[\s\S]*$/i;
const EXTRACT_INLINE_QUESTION_RE =
  /^\s*(?:\*+\s*)?(?:summarized\s+question|question)\s*:?\s*(?:\*+)?\s*(.+)$/im;
function extractQuestionFromAiText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "";
  const match = cleaned.match(EXTRACT_QUESTION_FROM_ANSWER_RE);
  return match?.[1]?.trim() ?? "";
}

function extractQuestionCandidate(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "";

  const structured = extractQuestionFromAiText(cleaned);
  if (structured) return structured;

  const inline = cleaned.match(EXTRACT_INLINE_QUESTION_RE)?.[1]?.trim();
  if (inline) return inline;

  return (
    cleaned
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.endsWith("?")) ?? ""
  );
}

function isSuccessfulAiAnswerMessage(message: Message): boolean {
  const text = message.text?.trim() || "";
  if (message.sender !== "AI" || !text) return false;
  if (NO_QUESTION_MARKER.test(text)) return false;
  if (/^(sorry|i couldn't|screen analysis returned no content|no question found)/i.test(text)) {
    return false;
  }
  return true;
}

function inferAnswerTopic(question: string, answer: string): string {
  const text = `${question} ${answer}`.toLowerCase();
  if (/\b(react|jsx|hooks?|component|useeffect|useref|usestate|usememo|usecallback)\b/.test(text)) {
    return "react";
  }
  if (/\b(sql|postgres|postgresql|select|query|join|table|index)\b/.test(text)) {
    return "sql";
  }
  if (/\b(pyspark|spark|databricks|dataframe|row_number|lag|lead|window function)\b/.test(text)) {
    return "pyspark";
  }
  if (/\b(node|express|api|backend)\b/.test(text)) return "backend";
  return "general";
}

function buildLatestAnswerContextPayload(
  messages: Message[],
): Partial<AIAnswerRequestPayload> {
  const successfulAnswers = messages.filter(isSuccessfulAiAnswerMessage);
  const previousAiAnswers = successfulAnswers
    .slice(-AI_ANSWER_LIMITS.previousAiAnswersMax)
    .map((message) => {
      const answer =
        message.originalGenerationContext?.generatedAnswerText?.trim() ||
        message.text.trim();
      const question =
        message.question?.trim() ||
        message.originalGenerationContext?.currentQuestion?.trim() ||
        extractQuestionCandidate(answer);
      const codeBlocks =
        message.originalGenerationContext?.generatedCodeBlocks?.length
          ? message.originalGenerationContext.generatedCodeBlocks
          : extractCodeBlocks(answer);
      return {
        ...(question ? { question } : {}),
        answer,
        ...(codeBlocks.length > 0 ? { codeBlocks } : {}),
      };
    });
  const latest = successfulAnswers[successfulAnswers.length - 1];
  if (!latest) return {};

  const latestAnswerText =
    latest.originalGenerationContext?.generatedAnswerText?.trim() ||
    latest.text.trim();
  const latestAnswerQuestion =
    latest.question?.trim() ||
    latest.originalGenerationContext?.currentQuestion?.trim() ||
    extractQuestionCandidate(latestAnswerText);
  const latestCodeBlocks =
    latest.originalGenerationContext?.generatedCodeBlocks?.length
      ? latest.originalGenerationContext.generatedCodeBlocks
      : extractCodeBlocks(latestAnswerText);
  const latestAnswerTopic =
    latest.questionMeta?.topic ||
    inferAnswerTopic(latestAnswerQuestion, latestAnswerText);

  return {
    previousAiAnswer: latestAnswerText,
    previousAiAnswers,
    ...(latestCodeBlocks.length > 0 ? { previousCodeBlocks: latestCodeBlocks } : {}),
    latestAnswerId: latest.id,
    ...(latestAnswerQuestion ? { latestAnswerQuestion } : {}),
    latestAnswerText,
    latestAnswerTopic,
  };
}

/**
 * Helper used by both handleAnalyzeScreen and handleAiAnswer to consume a
 * streaming AI response and split it into multiple Message cards on the fly
 * whenever the model emits the `===NEXT_QUESTION===` separator.
 *
 * Behaviour:
 *   - keeps the FIRST real Q/A segment flowing into the original messageId
 *   - on every new separator detected, finalises the current segment and
 *     spawns a NEW Message record (so the user sees real-time card growth
 *     instead of one pager-style blob)
 *   - **preamble filtering**: some models emit a meta header like
 *     "I can see 10 questions on the screen. I will answer each one..."
 *     before the first **QUESTION:** block. We discard that segment so the
 *     user sees only real Q/A cards and never a "summary" card.
 */
/**
 * Safely cancel a stream reader. Swallows errors (reader may already be closed).
 */
async function safelyCancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore — reader may already be closed or locked
  }
}

/**
 * Shared utility: parses raw AI backend text into structured { question, answer }.
 *
 * The backend may return text in one of two forms:
 *   1. "**QUESTION:** ... **ANSWER:** ..."  — structured (new format)
 *   2. Plain answer text                    — legacy / custom-query
 *
 * This is the SINGLE SOURCE OF TRUTH for parsing. Both the streaming data layer
 * (flushToState in consumeSegmentedStream) and the render layer (ChatMessage)
 * must call this function to guarantee identical results.
 *
 * Mid-stream safety: when **ANSWER:** hasn't arrived yet during streaming,
 * the entire text is treated as a partial answer (no question shown yet).
 */
export function parseAnswerContent(rawText: string, fallbackQuestion?: string): {
  question: string;
  answer: string;
} {
  if (!rawText?.trim()) {
    return { question: fallbackQuestion?.trim() ?? "", answer: "" };
  }

  const text = rawText.trim();

  // Match structured "**QUESTION:** ... **ANSWER:** ..." format.
  // Use a non-greedy match for question, and the rest is the answer.
  const structuredMatch = text.match(
    /\*{0,2}\s*QUESTION\s*:?\s*\*{0,2}\s*([\s\S]*?)\s*\*{0,2}\s*ANSWER\s*:?\s*\*{0,2}\s*([\s\S]*)/i,
  );

  if (structuredMatch) {
    const question = sanitizeGeneratedQuestionTitle(structuredMatch[1]);
    const answer = structuredMatch[2].trim();
    return {
      question: question || fallbackQuestion?.trim() || "",
      answer,
    };
  }

  // No **ANSWER:** found yet (partial stream or plain text).
  // Treat the whole text as the answer; question comes from fallback.
  // Strip any orphaned **QUESTION:** prefix if present (mid-stream partial).
  const orphanQMatch = text.match(
    /^\*{0,2}\s*QUESTION\s*:?\s*\*{0,2}\s*([\s\S]*)$/i,
  );
  if (orphanQMatch) {
    // Partial: QUESTION content is streaming but ANSWER hasn't arrived.
    // Stream the AI-generated/cleaned question into the UI while the answer
    // is still being generated.
    const partialQuestion = sanitizeGeneratedQuestionTitle(orphanQMatch[1]
      .replace(/\*{0,2}\s*ANSWER\s*:?\s*\*{0,2}[\s\S]*$/i, "")
      .trim());
    return {
      question: partialQuestion || fallbackQuestion?.trim() || "",
      answer: "",
    };
  }

  return { question: fallbackQuestion?.trim() ?? "", answer: text };
}

function hasRenderableAnswerContent(rawText: string, fallbackQuestion?: string): boolean {
  const { answer } = parseAnswerContent(rawText, fallbackQuestion);
  return answer.trim().length > 0;
}

function extractQuestionMeta(rawText: string): {
  text: string;
  questionMeta?: QuestionMeta;
} {
  const match = rawText.match(QUESTION_META_MARKER);
  if (!match) return { text: rawText };
  try {
    const parsed = JSON.parse(match[1]) as QuestionMeta;
    return {
      text: rawText.replace(QUESTION_META_MARKER, ""),
      questionMeta: parsed,
    };
  } catch (error) {
    console.warn("[useAIChat] Failed to parse QUESTION_META marker", error);
    return { text: rawText.replace(QUESTION_META_MARKER, "") };
  }
}

interface ConsumeStreamResult {
  /** IDs of cards that were created and have real content. */
  activeIds: string[];
  questionMeta?: QuestionMeta;
  /**
   * True when the ONLY thing the backend returned was ===NO_NEW_QUESTION===.
   * Callers should treat this as a clean "nothing to answer" signal rather
   * than an error — no fallback error card should be shown.
   */
  sentinelOnly: boolean;
}

async function consumeSegmentedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialMessageId: string,
  setAiChat: React.Dispatch<React.SetStateAction<Message[]>>,
  baseTime: string,
  signal?: AbortSignal,
  requestContext?: OriginalGenerationContext,
): Promise<ConsumeStreamResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  // Number of leading `parts` to discard (preamble filtering).
  // Starts at 0; flips to 1 once we observe parts[0] is a meta preamble.
  let leadingSkip = 0;
  let preambleDecided = false;
  let streamQuestionMeta: QuestionMeta | undefined = undefined;
  // segmentTexts[i] = current text of the i-th RENDERED card; segmentIds[i] = its message id.
  const segmentTexts: string[] = [""];
  const segmentIds: string[] = [initialMessageId];

  const flushToState = () => {
    if (signal?.aborted) {
      return;
    }
    if (NO_QUESTION_MARKER.test(buffer)) {
      return;
    }
    setAiChat((prev) => {
      const next = [...prev];
      for (let i = 0; i < segmentIds.length; i++) {
        const sid = segmentIds[i];

        let rawText = segmentTexts[i];
        let snapshotId: string | undefined = undefined;
        const metaExtract = extractQuestionMeta(rawText);
        rawText = metaExtract.text;
        if (metaExtract.questionMeta) {
          streamQuestionMeta = metaExtract.questionMeta;
        }

        // Strip snapshot sentinel
        const snapMatch = rawText.match(/===SNAPSHOT_ID=([a-f0-9\-]+)===/i);
        if (snapMatch) {
          snapshotId = snapMatch[1];
          rawText = rawText.replace(/===SNAPSHOT_ID=([a-f0-9\-]+)===/gi, "");
        }

        // Extract structured question + answer from raw backend response.
        // We do this BEFORE stripping so we can populate the `question` field
        // on new segment cards (mirroring what handleAiAnswerSingle does).
        const { question: extractedQuestion } = parseAnswerContent(rawText);
        const displayText = rawText;
        const displayQuestion = sanitizeGeneratedQuestionTitle(
          extractedQuestion || streamQuestionMeta?.displayQuestion || "",
        );

        const idx = next.findIndex((m) => m.id === sid);
        if (idx >= 0) {
          // Always use the backend-extracted question as the source of truth.
          // The backend AI response contains the properly interpreted/cleaned question,
          // which should override any initial raw transcript question.
          next[idx] = {
            ...next[idx],
            text: displayText,
            question: displayQuestion,
            ...(streamQuestionMeta ? { questionMeta: streamQuestionMeta } : {}),
            ...(snapshotId ? { snapshotId } : {}),
            ...(requestContext
              ? {
                  originalGenerationContext: {
                    ...(next[idx].originalGenerationContext || requestContext),
                    generatedAnswerText: displayText.slice(0, 3_000),
                    generatedCodeBlocks: extractCodeBlocks(displayText)
                      .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
                      .map((block) =>
                        block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars),
                      ),
                  },
                }
              : {}),
          };
        } else {
          next.push({
            id: sid,
            sender: "AI",
            text: displayText,
            time: baseTime,
            question: displayQuestion,
            ...(streamQuestionMeta ? { questionMeta: streamQuestionMeta } : {}),
            ...(snapshotId ? { snapshotId } : {}),
            ...(requestContext
              ? {
                  originalGenerationContext: {
                    ...requestContext,
                    generatedAnswerText: displayText.slice(0, 3_000),
                    generatedCodeBlocks: extractCodeBlocks(displayText)
                      .slice(0, AI_ANSWER_LIMITS.previousCodeBlocksMax)
                      .map((block) =>
                        block.slice(0, AI_ANSWER_LIMITS.previousCodeBlockMaxChars),
                      ),
                  },
                }
              : {}),
          });
        }
      }
      return next;
    });
  };

  while (true) {
    if (signal?.aborted) {
      break;
    }
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (readErr: any) {
      // AbortError from reader.cancel() — treat as clean abort
      if (readErr?.name !== "AbortError" && !signal?.aborted) {
        console.error(`[useAIChat] consumeSegmentedStream: reader.read() threw unexpectedly:`, readErr);
      }
      break;
    }
    if (signal?.aborted) {
      await safelyCancelReader(reader);
      break;
    }
    const { done, value } = readResult;
    if (done) {
      break;
    }

    const chunkStr = decoder.decode(value, { stream: true });
    buffer += chunkStr;
    const bufferMetaExtract = extractQuestionMeta(buffer);
    if (bufferMetaExtract.questionMeta) {
      streamQuestionMeta = bufferMetaExtract.questionMeta;
      buffer = bufferMetaExtract.text;
    }

    const parts = buffer.split(SEGMENT_MARKER);

    // Decide preamble status as soon as we see at least one separator
    // (meaning parts[0] is finalised — no more text will be appended to it).
    if (!preambleDecided && parts.length >= 2) {
      preambleDecided = true;
      const first = parts[0].trim();
      if (!QUESTION_MARKER.test(first)) {
        // Preamble. Drop the placeholder card and shift everything by one.
        leadingSkip = 1;
        if (!signal?.aborted) {
          setAiChat((prev) => prev.filter((m) => m.id !== initialMessageId));
        }
        // Re-anchor: the first RENDERED card is now parts[1]. Reuse a fresh
        // id so the existing initialMessageId is fully forgotten.
        segmentIds[0] = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        segmentTexts[0] = "";
      }
    }

    const renderable = parts.length - leadingSkip;
    while (segmentIds.length < renderable) {
      const nextId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      segmentIds.push(nextId);
      segmentTexts.push("");
    }

    for (let i = 0; i < renderable; i++) {
      segmentTexts[i] = parts[i + leadingSkip];
    }

    flushToState();
  }

  if (signal?.aborted) {
    await safelyCancelReader(reader);
    return { activeIds: [], questionMeta: streamQuestionMeta, sentinelOnly: false };
  }

  if (NO_QUESTION_MARKER.test(buffer)) {
    return { activeIds: [], questionMeta: streamQuestionMeta, sentinelOnly: true };
  }

  // Final flush — also catches the case where the stream ended WITHOUT any
  // separator AND the single segment happened to be preamble-only (rare).
  flushToState();

  return { activeIds: segmentIds, questionMeta: streamQuestionMeta, sentinelOnly: false };
}

export const useAIChat = () => {
  const [aiChat, setAiChat] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const isMountedRef = useRef(true);

  // Stream isolation management
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const operationRegistryRef = useRef(
    createSessionOperationRegistry((event) => {
      console.log("[Session][Operation]", event);
    }),
  );
  // Track all loading-state setters for the current request so we can always
  // reset them even when a new request supersedes the old one.
  const pendingLoadingResetRef = useRef<(() => void) | null>(null);

  const aiChatRef = useRef<Message[]>([]);

  useEffect(() => {
    aiChatRef.current = aiChat;
  }, [aiChat]);

  // Pipeline generation guard: prevents duplicate stream cards for the same semantic segment.
  const generationGuardRef = useRef(createGenerationGuard());
  // Tracks the last successfully generated transcript for continuation detection.
  const previousContextRef = useRef<{ transcript: string; timestamp: number } | null>(null);
  const conversationContinuityRef = useRef<ConversationContinuityState>({
    lastResolvedQuestion: "",
    lastResolvedTopic: "",
    lastAnswerSummary: "",
    lastTechnicalEntities: [],
    lastConversationMode: "button",
    lastUpdatedAt: 0,
  });

  const logContinuity = useCallback(
    (
      sourceType: "transcript" | "manual",
      resolvedQuestion: string,
      confidence: number,
      previousTopic: string,
    ) => {
      if (!import.meta.env.DEV) return;
      console.log("[useAIChat] conversationalFollowUpDetected", {
        sourceType,
        previousTopic,
        resolvedQuestion,
        continuityConfidence: confidence,
      });
    },
    [],
  );

  const applyContinuityToQuestion = useCallback(
    (
      rawQuestion: string,
      mode: ConversationMode,
      sourceType: "transcript" | "manual",
    ) => {
      const previousTopic = conversationContinuityRef.current.lastResolvedTopic;
      const continuity = resolveQuestionWithContinuity(
        rawQuestion,
        conversationContinuityRef.current,
      );
      if (continuity.usedPreviousTopic) {
        logContinuity(
          sourceType,
          continuity.resolvedQuestion,
          continuity.confidence,
          previousTopic,
        );
      }

      const topicInfo = extractTopicAndEntities(continuity.resolvedQuestion || rawQuestion);
      conversationContinuityRef.current = {
        ...conversationContinuityRef.current,
        lastResolvedQuestion: continuity.resolvedQuestion || rawQuestion,
        lastResolvedTopic:
          topicInfo.topic || conversationContinuityRef.current.lastResolvedTopic,
        lastTechnicalEntities:
          topicInfo.entities.length > 0
            ? topicInfo.entities
            : conversationContinuityRef.current.lastTechnicalEntities,
        lastConversationMode: mode,
        lastUpdatedAt: Date.now(),
      };
      return continuity;
    },
    [logContinuity],
  );

  const commitContinuityFromAnswer = useCallback(
    (
      resolvedQuestion: string,
      answerText: string,
      mode: ConversationMode,
    ) => {
      const topicInfo = extractTopicAndEntities(resolvedQuestion);
      const answerSummary = summarizeAnswerForMemory(answerText);
      conversationContinuityRef.current = {
        ...conversationContinuityRef.current,
        lastResolvedQuestion: resolvedQuestion || conversationContinuityRef.current.lastResolvedQuestion,
        lastResolvedTopic: topicInfo.topic || conversationContinuityRef.current.lastResolvedTopic,
        lastTechnicalEntities:
          topicInfo.entities.length > 0
            ? topicInfo.entities
            : conversationContinuityRef.current.lastTechnicalEntities,
        lastAnswerSummary: answerSummary || conversationContinuityRef.current.lastAnswerSummary,
        lastConversationMode: mode,
        lastUpdatedAt: Date.now(),
      };
    },
    [],
  );

  // Stable ref so handleAiAnswer can call handleAiAnswerSingle without a
  // forward-reference ordering issue (handleAiAnswerSingle is defined after).
  const handleAiAnswerSingleRef = useRef<
    (
      sessionId: string,
      payload: AIAnswerRequestPayload,
      aiModel: string,
    ) => Promise<void>
  >(() => Promise.resolve());

  const safeSetAiChat = useCallback(
    (updater: React.SetStateAction<Message[]>) => {
      if (!isMountedRef.current) return;
      setAiChat(updater);
    },
    [],
  );

  const createRequestId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
      if (pendingLoadingResetRef.current) {
        pendingLoadingResetRef.current();
        pendingLoadingResetRef.current = null;
      }
      operationRegistryRef.current.clear();
    };
  }, []);

  const startNewRequest = useCallback(() => {
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeRequestIdRef.current = reqId;

    console.log(`[useAIChat] startNewRequest: Initialized new request ID: ${reqId}`);
    return { controller, reqId };
  }, []);

  const cancelActiveRequest = useCallback((reason: string) => {
    console.log(`[AI Answer][Abort] cancelActiveRequest invoked`, { reason, activeRequestId: activeRequestIdRef.current });
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    if (pendingLoadingResetRef.current) {
      pendingLoadingResetRef.current();
      pendingLoadingResetRef.current = null;
    }
    operationRegistryRef.current.clear();
  }, []);

  const finalizeRenderedQuestions = useCallback(
    (
      newMessageIds: string[],
      options: { fallbackQuestion?: string } = {},
    ) => {
      if (!newMessageIds.length) return;

      setAiChat((prev) => {
        const existingNewIds = new Set(newMessageIds);
        return prev.map((msg) => {
          if (!existingNewIds.has(msg.id)) return msg;
          const candidate =
            extractQuestionCandidate(msg.text) ||
            msg.question?.trim() ||
            options.fallbackQuestion?.trim() ||
            "";
          return candidate && !msg.question
            ? { ...msg, question: candidate }
            : msg;
        });
      });
    },
    [],
  );

  const handleAnalyzeScreen = useCallback(
    async (
      sessionId: string,
      screenshotBlob: Blob | null,
      aiModel: string,
      contextPayload?: Partial<AIAnswerRequestPayload>,
    ) => {
      console.log(`[useAIChat] handleAnalyzeScreen triggered. sessionId: ${sessionId}, model: ${aiModel}`);
      if (!screenshotBlob) {
        console.log("[useAIChat] handleAnalyzeScreen: No screenshot blob provided. Aborting.");
        return;
      }

      const { controller, reqId } = startNewRequest();
      console.log(`[useAIChat] handleAnalyzeScreen: Assigned request ID: ${reqId}`);
      setIsAnalyzing(true);
      setIsAnswering(false);
      // Register loading reset so startNewRequest can fire it if superseded
      pendingLoadingResetRef.current = () => setIsAnalyzing(false);

      const currentUsage = parseInt(localStorage.getItem(`aiUsage_${sessionId}`) || "0", 10);
      localStorage.setItem(`aiUsage_${sessionId}`, (currentUsage + 1).toString());
      console.log(`[useAIChat] handleAnalyzeScreen: Incremented local aiUsage to ${currentUsage + 1}`);

      const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const baseTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const newAiMessage: Message = {
        id: messageId,
        sender: "AI",
        text: "",
        time: baseTime,
      };

      console.log(`[useAIChat] handleAnalyzeScreen: Spawning temporary card messageId: ${messageId}`);
      safeSetAiChat((prev) => [...prev, newAiMessage]);

      try {
        conversationContinuityRef.current = {
          ...conversationContinuityRef.current,
          lastConversationMode: "screenshot",
          lastUpdatedAt: Date.now(),
        };
        const latestAnswerContext = buildLatestAnswerContextPayload(aiChatRef.current);
        const screenRequestContext = sanitizeAIAnswerPayload({
          transcript: "Analyze and answer the interview task visible in the screenshot.",
          sourcePlatform: contextPayload?.sourcePlatform,
          answerMode: contextPayload?.answerMode || "auto",
          // Screen content is authoritative for the question itself (we don't
          // want a stale voice transcript overriding what's on screen), so we
          // deliberately do NOT send a currentQuestion here — the backend now
          // instructs the model to identify and state the real question from
          // the image itself. We still tell the backend what was already
          // answered so it can identify the CURRENTLY active question among
          // multiple and avoid regenerating an answer for one already covered.
          previousAiAnswer: latestAnswerContext.previousAiAnswer,
          previousAiAnswers: latestAnswerContext.previousAiAnswers,
        });
        if (import.meta.env.DEV) {
          console.log("[Analyze Screen][Context][FE]", {
            sessionId,
            screenshotAuthoritative: true,
            staleTranscriptContextDropped: true,
          });
        }

        const targetUrl = `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/analyze-screen`;
        const formData = new FormData();
        formData.append("screenshot", screenshotBlob, "screenshot.jpg");
        if (aiModel) {
          formData.append("aiModel", aiModel);
        }
        formData.append("contextPayload", JSON.stringify(screenRequestContext));

        console.log(`[useAIChat] handleAnalyzeScreen: Dispatching POST to ${targetUrl}`);
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: await getAuthHeaders(),
          body: formData,
          signal: controller.signal,
        });

        if (response.status === 410) {
          console.warn("[useAIChat] handleAnalyzeScreen: session not active (410)");
          notifySessionGone(sessionId);
          throw new Error("Session has ended");
        }

        if (!response.ok) {
          console.error(`[useAIChat] handleAnalyzeScreen: Server returned status ${response.status}`);
          throw new Error(`Analysis failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");
        const consumed = await consumeSegmentedStream(
          reader,
          messageId,
          setAiChat,
          baseTime,
          controller.signal,
        );
        const renderedIds = consumed.activeIds;
        const analyzeSentinel = consumed.sentinelOnly;

        if (analyzeSentinel) {
          throw new Error("Analyze Screen returned no answer");
        }

        if (controller.signal.aborted) {
          console.log(`[useAIChat] handleAnalyzeScreen: Signal aborted during stream consumption for request: ${reqId}`);
          return;
        }

        console.log("[useAIChat] handleAnalyzeScreen: Stream consumption completed. Rendered IDs:", renderedIds);
        const primaryId = renderedIds[0] || messageId;
        const answerText =
          aiChatRef.current.find((m) => m.id === primaryId)?.text?.trim() || "";
        const continuityQuestion =
          conversationContinuityRef.current.lastResolvedQuestion || "Analyze this screen";
        commitContinuityFromAnswer(continuityQuestion, answerText, "screenshot");

        // A successful Analyze Screen call must leave a rendered answer card.
        safeSetAiChat((prev) => {
          if (renderedIds.length > 0) {
            const allHaveAnswers = renderedIds.every((rid) => {
              const msg = prev.find((m) => m.id === rid);
              if (!msg) return false;
              return hasRenderableAnswerContent(msg.text, msg.question);
            });
            if (allHaveAnswers) return prev;
          }

          const emptyCardId =
            renderedIds.find((rid) => {
              const msg = prev.find((m) => m.id === rid);
              if (!msg) return true;
              return !hasRenderableAnswerContent(msg.text, msg.question);
            }) ??
            (prev.find((m) => m.id === messageId) ? messageId : null);

          console.log(`[useAIChat] handleAnalyzeScreen: Stream ended with no content/unrendered cards. Keeping explicit failure on card ID: ${emptyCardId}`);
          if (!emptyCardId) {
            return [
              ...prev,
              {
                id: messageId,
                sender: "AI" as const,
                text: "Screen analysis returned no content. Please retry once.",
                time: baseTime,
              },
            ];
          }

          return prev.map((msg) =>
            msg.id === emptyCardId
              ? {
                  ...msg,
                  text: "Screen analysis returned no content. Please retry once.",
                  question: "",
                }
              : msg,
          );
        });
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[useAIChat] Screen analysis aborted:", reqId);
          return;
        }
        console.error("[useAIChat] AI Streaming error (screen analysis):", error);

        if (controller.signal.aborted) return;

        setAiChat((prev) => {
          const exists = prev.find((m) => m.id === messageId);
          if (exists) {
            return prev.map((msg) =>
              msg.id === messageId
                ? { ...msg, text: "Sorry, I encountered an error during analysis. Please try again." }
                : msg,
            );
          }
          return [
            ...prev,
            {
              id: messageId,
              sender: "AI" as const,
              text: "Sorry, I encountered an error during analysis. Please try again.",
              time: baseTime,
            },
          ];
        });
      } finally {
        // Always clean up — both for the active request and superseded ones.
        // The pendingLoadingResetRef guard prevents double-reset if startNewRequest
        // already fired the reset before this finally runs.
        if (activeRequestIdRef.current === reqId) {
          console.log(`[useAIChat] handleAnalyzeScreen: finally block for request ID: ${reqId}. Resetting isAnalyzing.`);
          pendingLoadingResetRef.current = null;
          setIsAnalyzing(false);
          safeSetAiChat(removeEmptyAiPlaceholders);
        } else {
          console.log(`[useAIChat] handleAnalyzeScreen: request ID mismatch in finally block (already superseded). Active: ${activeRequestIdRef.current}, Current: ${reqId}`);
          // Loading was already reset by startNewRequest — just clean empty cards.
          safeSetAiChat(removeEmptyAiPlaceholders);
        }
      }
    },
    [commitContinuityFromAnswer, startNewRequest],
  );

  const handleAiAnswer = useCallback(
    async (
      sessionId: string,
      request: AIAnswerRequestInput,
      aiModel: string,
    ) => {
      const rawPayload: AIAnswerRequestPayload =
        typeof request === "string"
          ? { transcript: request, currentQuestion: request }
          : request;
      const latestAnswerContext = buildLatestAnswerContextPayload(aiChatRef.current);
      const manualQueryType =
        rawPayload.manualQueryType ||
        classifyManualQueryType(rawPayload.currentQuestion || rawPayload.transcript || "");
      const basePayload = sanitizeAIAnswerPayload(
        {
          ...rawPayload,
          ...latestAnswerContext,
          transcript: rawPayload.transcript,
          ...(rawPayload.currentQuestion ? { currentQuestion: rawPayload.currentQuestion } : {}),
          manualQueryType,
        },
      );
      const resolvedFromPayload = resolveQueryFromAIAnswerPayload(basePayload);
      const rawQuestion = deduplicateQuestionsInText(
        normalizeSttTranscript(resolvedFromPayload),
      );
      const continuity = applyContinuityToQuestion(rawQuestion, "button", "transcript");
      const normalizedQuestion = continuity.resolvedQuestion || rawQuestion;
      const fallbackTranscriptInput =
        basePayload.transcript ||
        (basePayload.recentTranscriptWindow || []).join("\n") ||
        (basePayload.speakerSeparatedTranscript || [])
          .map((entry) => entry.content)
          .join("\n");
      const generationInput = normalizedQuestion.trim() || fallbackTranscriptInput.trim();
      if (import.meta.env.DEV) {
        console.log("[AI Answer Debug][FE] Raw input request:", request);
        console.log("[AI Answer Debug][FE] Base sanitized payload:", basePayload);
        console.log("[AI Answer Debug][FE] Resolved query before normalization:", resolvedFromPayload);
      }
      console.log(`[useAIChat] handleAiAnswer triggered. sessionId: ${sessionId}, question: "${generationInput.slice(0, 100)}...", model: ${aiModel}`);
      if (!generationInput.trim()) {
        console.log("[useAIChat] handleAiAnswer: Transcript input is empty. Aborting.");
        return;
      }

      const requestId = createRequestId();
      const normalizedPayload = sanitizeAIAnswerPayload({
        ...basePayload,
        requestId,
        sessionId,
        transcript: basePayload.transcript || generationInput,
        ...(normalizedQuestion.trim() ? { currentQuestion: normalizedQuestion } : {}),
      });
      if (import.meta.env.DEV) {
        console.log("[AI Answer Debug][FE] Final normalized payload before routing:", normalizedPayload);
      }

      // patchedTranscript is an explicit edited query signal.
      // It must bypass segmentation and be sent as-is in a single request.
      if (normalizedPayload.patchedTranscript?.trim()) {
        if (import.meta.env.DEV) {
          console.log("[AI Answer Debug][FE] patchedTranscript detected; bypassing segmentation.");
        }
        await handleAiAnswerSingleRef.current(
          sessionId,
          normalizedPayload,
          aiModel,
        );
        previousContextRef.current = {
          transcript: generationInput,
          timestamp: Date.now(),
        };
        return;
      }

      // Route through the unified generation pipeline
      // Use 'button' mode for manual clicks to bypass noise classification
      const decision = prepareGeneration(
        {
          transcript: generationInput,
          mode: "button",
          sessionId,
          aiModel,
        },
        previousContextRef.current?.transcript,
      );

      if (decision.shouldGenerate === false) {
        if (import.meta.env.DEV) {
          console.log("[AI Answer Debug][FE] Generation blocked by pipeline:", decision);
        }
        console.log(`[useAIChat] handleAiAnswer: Pipeline produced block reason but backend segmenter will handle it. Reason: ${decision.reason}`);
      }
      if (import.meta.env.DEV) {
        console.log("[AI Answer Debug][FE] Generation decision:", decision);
      }

      const groupedTranscript = decision.groupedTranscript?.trim() || generationInput;
      const segmentId = generateSegmentId(groupedTranscript);
      if (!generationGuardRef.current.canStartGeneration(segmentId, groupedTranscript)) {
        console.log(`[useAIChat] handleAiAnswer: Generation guard blocked duplicate segment.`);
        return;
      }

      generationGuardRef.current.lockGeneration(segmentId, groupedTranscript);

      try {
        await handleAiAnswerSingleRef.current(
          sessionId,
          sanitizeAIAnswerPayload({
            ...normalizedPayload,
            transcript: normalizedPayload.transcript || groupedTranscript,
            ...(normalizedQuestion.trim() ? { currentQuestion: normalizedQuestion } : {}),
          }),
          aiModel,
        );

        // Update previous context after successful generation
        previousContextRef.current = { transcript: generationInput, timestamp: Date.now() };
      } finally {
        generationGuardRef.current.releaseGeneration(segmentId);
      }
    },
    [applyContinuityToQuestion, startNewRequest],
  );

  // Inner single-question implementation — called by handleAiAnswer via ref after splitting.
  const handleAiAnswerSingle = useCallback(
    async (
      sessionId: string,
      payload: AIAnswerRequestPayload,
      aiModel: string,
    ) => {
      const resolvedQuestion = resolveQueryFromAIAnswerPayload(payload);
      if (!resolvedQuestion.trim()) return;

      const { controller, reqId } = startNewRequest();
      const requestId = payload.requestId || createRequestId();
      const opAcquire = operationRegistryRef.current.acquire(
        sessionId,
        "ai-answer",
        requestId,
        controller,
      );
      if (!opAcquire.acquired) {
        activeRequestIdRef.current = opAcquire.existing.requestId;
        activeAbortControllerRef.current =
          opAcquire.existing.controller || activeAbortControllerRef.current;
        console.warn("[AI Answer][Dedup] Ignored duplicate AI answer call while request is active", {
          sessionId,
          requestId,
          operationKind: "ai-answer",
        });
        return;
      }
      console.log(`[useAIChat] handleAiAnswerSingle: Assigned request ID: ${reqId}`);
      setIsAnswering(true);
      setIsAnalyzing(false);
      pendingLoadingResetRef.current = () => setIsAnswering(false);

      const currentUsage = parseInt(localStorage.getItem(`aiUsage_${sessionId}`) || "0", 10);
      localStorage.setItem(`aiUsage_${sessionId}`, (currentUsage + 1).toString());
      console.log(`[useAIChat] handleAiAnswer: Incremented local aiUsage to ${currentUsage + 1}`);

      const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const baseTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const newAiMessage: Message = {
        id: messageId,
        sender: "AI",
        text: "",
        time: baseTime,
        question: resolvedQuestion,
        originalGenerationContext: buildOriginalGenerationContextFromPayload(
          payload,
          isTauri() ? "tauri" : "web",
        ),
      };

      console.log(`[useAIChat] handleAiAnswer: Spawning temporary card messageId: ${messageId}`);
      safeSetAiChat((prev) => [...prev, newAiMessage]);

      try {
        const targetUrl = `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/ai-answer`;
        let renderedIds: string[] = [];
        let sentinelOnly = false;
        let questionMeta: QuestionMeta | undefined;
        const requestBody = {
          ...payload,
          requestId,
          sessionId,
          aiModel,
        };
        if (import.meta.env.DEV) {
          console.log("[AI Answer Debug][FE] POST /ai-answer body:", requestBody);
        }
        console.log(`[useAIChat] handleAiAnswer: Dispatching POST to ${targetUrl}`, {
          requestId,
        });
        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "x-session-id": sessionId,
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (response.status === 410) {
          // Session has ended (settled server-side). Remove the placeholder
          // and hand off to the page's session-ended teardown.
          console.warn("[useAIChat] handleAiAnswer: session not active (410)", { requestId });
          safeSetAiChat((prev) => prev.filter((msg) => msg.id !== messageId));
          notifySessionGone(sessionId);
          return;
        }

        if (response.status === 409) {
          // A request is already in flight for this session (e.g. user
          // clicked again while the question was still evolving). Drop this
          // duplicate's placeholder silently; the in-flight answer stands.
          console.warn("[useAIChat] handleAiAnswer: duplicate_in_flight, dropping placeholder", {
            requestId,
            messageId,
          });
          safeSetAiChat((prev) => prev.filter((msg) => msg.id !== messageId));
          return;
        }

        if (!response.ok) {
          console.error(`[useAIChat] handleAiAnswer: Server returned status ${response.status}`);
          throw new Error("AI request failed");
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");
        const consumed = await consumeSegmentedStream(
          reader,
          messageId,
          setAiChat,
          baseTime,
          controller.signal,
          newAiMessage.originalGenerationContext,
        );
        renderedIds = consumed.activeIds;
        sentinelOnly = consumed.sentinelOnly;
        questionMeta = consumed.questionMeta;

        if (controller.signal.aborted) {
          console.log(`[useAIChat] handleAiAnswer: Signal aborted during stream consumption for request: ${reqId}`);
          return;
        }

        console.log("[useAIChat] handleAiAnswer: Stream consumption completed. sentinelOnly:", sentinelOnly);

        if (sentinelOnly) {
          throw new Error("AI Answer returned no answer");
        }

        finalizeRenderedQuestions(
          renderedIds.length > 0 ? renderedIds : [messageId],
          { fallbackQuestion: resolvedQuestion },
        );

        const answerText =
          aiChatRef.current.find((m) => m.id === messageId)?.text?.trim() || "";
        commitContinuityFromAnswer(resolvedQuestion, answerText, "button");

        // Genuine empty response (model returned nothing useful) — show fallback.
        safeSetAiChat((prev) => {
          const target = prev.find((msg) => msg.id === messageId);
          if (target && hasRenderableAnswerContent(target.text, target.question)) {
            return prev;
          }
          console.log(`[useAIChat] handleAiAnswer: Stream finished but card ID: ${messageId} is empty. Showing fallback.`);
          return prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  text: "I couldn't generate an answer from the current transcript. Please try regenerate.",
                }
              : msg,
          );
        });
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[useAIChat] AI Answer aborted:", reqId);
          return;
        }
        console.error("[useAIChat] AI Answering error:", error);

        if (controller.signal.aborted) return;

        safeSetAiChat((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  text: "Sorry, I couldn't generate an answer from the transcript.",
                }
              : msg,
          ),
        );
      } finally {
        if (activeRequestIdRef.current === reqId) {
          console.log(`[useAIChat] handleAiAnswerSingle: finally block for request ID: ${reqId}. Resetting isAnswering.`);
          pendingLoadingResetRef.current = null;
          setIsAnswering(false);
          safeSetAiChat(removeEmptyAiPlaceholders);
        } else {
          console.log(`[useAIChat] handleAiAnswerSingle: request ID mismatch (already superseded). Active: ${activeRequestIdRef.current}, Current: ${reqId}`);
          safeSetAiChat(removeEmptyAiPlaceholders);
        }
        operationRegistryRef.current.release(sessionId, "ai-answer", requestId);
      }
    },
    [commitContinuityFromAnswer, createRequestId, finalizeRenderedQuestions, safeSetAiChat, startNewRequest],
  );
  // Keep the ref in sync so handleAiAnswer always calls the latest callback.
  handleAiAnswerSingleRef.current = handleAiAnswerSingle;

  const handleCustomQuery = useCallback(
    async (
      sessionId: string,
      query: string,
      aiModel: string,
      contextPayload?: Partial<AIAnswerRequestPayload>,
    ) => {
      const resolvedQuery = normalizeSttTranscript(query).trim();
      console.log(`[useAIChat] handleCustomQuery triggered. sessionId: ${sessionId}, query: "${resolvedQuery}", model: ${aiModel}`);
      if (import.meta.env.DEV) {
        console.log("[AI Answer Debug][FE][Manual] Raw manual query:", query);
        console.log("[AI Answer Debug][FE][Manual] Authoritative manual query:", resolvedQuery);
      }
      if (!resolvedQuery) {
        console.log("[useAIChat] handleCustomQuery: Query is empty. Aborting.");
        return;
      }

      const { controller, reqId } = startNewRequest();
      const customOp = operationRegistryRef.current.acquire(
        sessionId,
        "ai-answer",
        reqId,
        controller,
      );
      if (!customOp.acquired) {
        activeRequestIdRef.current = customOp.existing.requestId;
        activeAbortControllerRef.current =
          customOp.existing.controller || activeAbortControllerRef.current;
        console.warn("[AI Answer][Dedup] Ignored duplicate manual query while request is active", {
          sessionId,
          requestId: reqId,
        });
        return;
      }
      console.log(`[useAIChat] handleCustomQuery: Assigned request ID: ${reqId}`);
      setIsAnswering(true);
      setIsAnalyzing(false);
      pendingLoadingResetRef.current = () => setIsAnswering(false);

      const currentUsage = parseInt(
        localStorage.getItem(`aiUsage_${sessionId}`) || "0",
        10,
      );
      localStorage.setItem(
        `aiUsage_${sessionId}`,
        (currentUsage + 1).toString(),
      );
      console.log(`[useAIChat] handleCustomQuery: Incremented local aiUsage to ${currentUsage + 1}`);

      const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userMessage: Message = {
        id: messageId + "-user",
        sender: "User",
        text: query,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      console.log(`[useAIChat] handleCustomQuery: Spawning user message card in chat ID: ${messageId}-user`);
      setAiChat((prev) => [...prev, userMessage]);
      setInputMessage("");

      // Save user query to backend history
      const saveMessageUrl = `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/save-message`;
      console.log(`[useAIChat] handleCustomQuery: Saving user message to backend via POST to ${saveMessageUrl}`);
      getAuthHeaders().then((authHeaders) => fetch(saveMessageUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          role: "USER",
          question: query,
          answer: "",
          time: userMessage.time,
        }),
        signal: controller.signal,
      }))
        .then(() => console.log("[useAIChat] handleCustomQuery: Successfully saved user message to backend history."))
        .catch((err) => console.error("[useAIChat] Failed to save user query to backend:", err));

      const aiMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newAiMessage: Message = {
        id: aiMessageId,
        sender: "AI",
        text: "",
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        question: resolvedQuery,
      };

      // Spawn placeholder AI response card immediately
      console.log(`[useAIChat] handleCustomQuery: Spawning placeholder AI response card ID: ${aiMessageId}`);
      setAiChat((prev) => [...prev, newAiMessage]);

      // Build structured prior-answer memory and transcript context for manual asks.
      const recentAiAnswers = aiChatRef.current
         .filter((m) => m.sender === "AI" && m.text?.trim())
         .slice(-AI_ANSWER_LIMITS.previousAiAnswersMax);
      const previousAiAnswers =
        contextPayload?.previousAiAnswers?.slice(
          -AI_ANSWER_LIMITS.previousAiAnswersMax,
        ) ||
        recentAiAnswers.map((message) => {
          const answer = message.text?.trim() || "";
          const messageQuestion =
            message.question?.trim() || extractQuestionFromAiText(answer);
          return {
            ...(messageQuestion ? { question: messageQuestion } : {}),
            answer,
            ...(answer ? { codeBlocks: extractCodeBlocks(answer) } : {}),
          };
        });
      const previousAiAnswer =
        recentAiAnswers.length > 0
          ? recentAiAnswers[recentAiAnswers.length - 1].text?.trim() || ""
          : "";
      const previousCodeBlocks = previousAiAnswer
        ? extractCodeBlocks(previousAiAnswer)
        : [];
      const recentTranscriptWindow =
        contextPayload?.recentTranscriptWindow?.slice(
          -AI_ANSWER_LIMITS.recentTranscriptWindowMax,
        ) ||
        [...aiChatRef.current]
          .reverse()
          .find(
            (message) =>
              message.sender === "AI" &&
              message.originalGenerationContext?.recentTranscriptWindow?.length,
          )
          ?.originalGenerationContext?.recentTranscriptWindow?.slice(
            -AI_ANSWER_LIMITS.recentTranscriptWindowMax,
          ) ||
        [];
      const speakerSeparatedTranscript =
        contextPayload?.speakerSeparatedTranscript?.slice(
          -AI_ANSWER_LIMITS.recentTranscriptWindowMax,
        ) ||
        [...aiChatRef.current]
          .reverse()
          .find(
            (message) =>
              message.sender === "AI" &&
              message.originalGenerationContext?.speakerSeparatedTranscript?.length,
          )
          ?.originalGenerationContext?.speakerSeparatedTranscript?.slice(
            -AI_ANSWER_LIMITS.recentTranscriptWindowMax,
          ) ||
        [];
      const transcriptForRequest = resolvedQuery;
      const runtimePlatform: "web" | "tauri" = isTauri() ? "tauri" : "web";
      const latestAnswerContext = buildLatestAnswerContextPayload(aiChatRef.current);
      const manualQueryType = classifyManualQueryType(resolvedQuery);
      console.log("[useAIChat] handleCustomQuery: Context built.", {
        previousAiAnswersCount: previousAiAnswers.length,
        recentTranscriptWindowCount: recentTranscriptWindow.length,
        manualQueryType,
      });

      // Route through the unified generation pipeline
      const decision = prepareGeneration({ 
        transcript: resolvedQuery, 
        mode: 'manual', 
        sessionId, 
        aiModel, 
        isCustomQuery: true 
      }, previousContextRef.current?.transcript);

      // For custom queries, ALWAYS generate (don't block on shouldGenerate since user explicitly typed)
      // But still use the guard to prevent duplicates
      const segmentId = generateSegmentId(decision.groupedTranscript);
      if (!generationGuardRef.current.canStartGeneration(segmentId, decision.groupedTranscript)) {
        console.log(`[useAIChat] handleCustomQuery: Generation guard blocked duplicate segment.`);
        operationRegistryRef.current.release(sessionId, "ai-answer", reqId);
        if (activeRequestIdRef.current === reqId) {
          pendingLoadingResetRef.current = null;
          setIsAnswering(false);
        }
        setAiChat((prev) =>
          prev.filter((msg) => msg.id !== userMessage.id && msg.id !== aiMessageId),
        );
        return;
      }

      generationGuardRef.current.lockGeneration(segmentId, decision.groupedTranscript);

      try {
        const requestId = createRequestId();
        const targetUrl = `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/ai-answer`;
        console.log(`[useAIChat] handleCustomQuery: Dispatching POST to ${targetUrl} for streaming custom answer.`);
        const response = await fetch(
          targetUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-request-id": requestId,
              "x-session-id": sessionId,
              ...(await getAuthHeaders()),
            },
            body: JSON.stringify({
              ...sanitizeAIAnswerPayload({
                requestId,
                sessionId,
                transcript: transcriptForRequest,
                currentQuestion: resolvedQuery,
                ...(recentTranscriptWindow.length > 0
                  ? { recentTranscriptWindow }
                  : {}),
                ...(speakerSeparatedTranscript.length > 0
                  ? { speakerSeparatedTranscript }
                  : {}),
                ...(previousAiAnswers.length > 0
                  ? { previousAiAnswers }
                  : latestAnswerContext.previousAiAnswers?.length
                    ? { previousAiAnswers: latestAnswerContext.previousAiAnswers }
                    : {}),
                previousAiAnswer: previousAiAnswer || latestAnswerContext.previousAiAnswer,
                previousCodeBlocks:
                  previousCodeBlocks.length > 0
                    ? previousCodeBlocks
                    : latestAnswerContext.previousCodeBlocks || [],
                latestAnswerId: latestAnswerContext.latestAnswerId,
                latestAnswerQuestion: latestAnswerContext.latestAnswerQuestion,
                latestAnswerText: latestAnswerContext.latestAnswerText,
                latestAnswerTopic: latestAnswerContext.latestAnswerTopic,
                sourcePlatform: runtimePlatform,
                answerMode: "auto",
                triggerSource: "custom_query",
                isCustomQuery: true,
                manualQueryType,
              }),
              aiModel,
            }),
            signal: controller.signal,
          },
	        );
	        if (import.meta.env.DEV) {
          console.log("[AI Answer Debug][FE][Manual] POST /ai-answer body:", {
              ...sanitizeAIAnswerPayload({
                transcript: transcriptForRequest,
                currentQuestion: resolvedQuery,
                ...(recentTranscriptWindow.length > 0
                  ? { recentTranscriptWindow }
                  : {}),
                ...(speakerSeparatedTranscript.length > 0
                  ? { speakerSeparatedTranscript }
                  : {}),
                ...(previousAiAnswers.length > 0
                  ? { previousAiAnswers }
                  : latestAnswerContext.previousAiAnswers?.length
                    ? { previousAiAnswers: latestAnswerContext.previousAiAnswers }
                    : {}),
                previousAiAnswer: previousAiAnswer || latestAnswerContext.previousAiAnswer,
                previousCodeBlocks:
                  previousCodeBlocks.length > 0
                    ? previousCodeBlocks
                    : latestAnswerContext.previousCodeBlocks || [],
                latestAnswerId: latestAnswerContext.latestAnswerId,
                latestAnswerQuestion: latestAnswerContext.latestAnswerQuestion,
                latestAnswerText: latestAnswerContext.latestAnswerText,
                latestAnswerTopic: latestAnswerContext.latestAnswerTopic,
                sourcePlatform: runtimePlatform,
                answerMode: "auto",
                triggerSource: "custom_query",
                isCustomQuery: true,
                manualQueryType,
              }),
              aiModel,
            });
	        }

	        if (response.status === 410) {
	          console.warn("[useAIChat] handleCustomQuery: session not active (410)");
	          setAiChat((prev) => prev.filter((msg) => msg.id !== aiMessageId));
	          notifySessionGone(sessionId);
	          return;
	        }

	        if (response.status === 409) {
	          console.warn("[useAIChat] handleCustomQuery: duplicate_in_flight, dropping placeholder", {
	            requestId,
	            aiMessageId,
	          });
	          setAiChat((prev) => prev.filter((msg) => msg.id !== aiMessageId));
	          return;
	        }

	        if (!response.ok) {
	          console.error(`[useAIChat] handleCustomQuery: Server returned status ${response.status}`);
	          throw new Error("AI request failed");
        }

        console.log("[useAIChat] handleCustomQuery: Server responded OK. Obtaining stream reader.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        await consumeSegmentedStream(
          reader,
          aiMessageId,
          setAiChat,
          newAiMessage.time,
          controller.signal,
        );

        const answerText =
          aiChatRef.current.find((m) => m.id === aiMessageId)?.text?.trim() || "";
        commitContinuityFromAnswer(resolvedQuery, answerText, "manual");

        // Update previous context after successful generation
        previousContextRef.current = { transcript: resolvedQuery, timestamp: Date.now() };
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[useAIChat] Custom query aborted:", reqId);
          return;
        }
        console.error("[useAIChat] AI Custom Query error:", error);

        if (controller.signal.aborted) return;

        setAiChat((prev) =>
          prev.map((msg) =>
            msg.id === aiMessageId
              ? {
                  ...msg,
                  text: "Sorry, I couldn't process your question.",
                }
              : msg,
          ),
        );
      } finally {
        generationGuardRef.current.releaseGeneration(segmentId);
        operationRegistryRef.current.release(sessionId, "ai-answer", reqId);
        if (activeRequestIdRef.current === reqId) {
          console.log(`[useAIChat] handleCustomQuery: finally block for request ID: ${reqId}. Resetting isAnswering.`);
          pendingLoadingResetRef.current = null;
          setIsAnswering(false);
          setAiChat(removeEmptyAiPlaceholders);
        } else {
          console.log(`[useAIChat] handleCustomQuery: request ID mismatch (already superseded). Active: ${activeRequestIdRef.current}, Current: ${reqId}`);
          setAiChat(removeEmptyAiPlaceholders);
        }
      }
    },
    [commitContinuityFromAnswer, createRequestId, startNewRequest],
  );

  const handleRegenerate = useCallback(
    async (sessionId: string, messageId: string, aiModel: string) => {
      console.log(`[useAIChat] handleRegenerate triggered. sessionId: ${sessionId}, messageId: ${messageId}, model: ${aiModel}`);
      const targetMessage = aiChatRef.current.find((m) => m.id === messageId);
      if (!targetMessage) {
        console.warn(`[useAIChat] handleRegenerate: Message ID ${messageId} not found in current chat list. Aborting.`);
        return;
      }

      const extractedQ = extractQuestionFromAiText(targetMessage.text ?? "");
      const cachedContext = targetMessage.originalGenerationContext;
      const question =
        cachedContext?.originalQuestion?.trim() ||
        cachedContext?.currentQuestion?.trim() ||
        targetMessage.question?.trim() ||
        extractedQ;
      const continuity = applyContinuityToQuestion(
        question,
        "regenerate",
        "transcript",
      );
      const resolvedQuestion = continuity.resolvedQuestion || question;

      if (!resolvedQuestion) {
        console.warn("[useAIChat] handleRegenerate: No question could be resolved for this message. Aborting.");
        return;
      }

      const transcriptForReplay = cachedContext?.originalTranscript?.trim() || resolvedQuestion;
      const replayPayload = sanitizeAIAnswerPayload({
        transcript: transcriptForReplay,
        currentQuestion: resolvedQuestion,
        ...(cachedContext?.recentTranscriptWindow?.length
          ? { recentTranscriptWindow: cachedContext.recentTranscriptWindow }
          : {}),
        ...(cachedContext?.speakerSeparatedTranscript?.length
          ? { speakerSeparatedTranscript: cachedContext.speakerSeparatedTranscript }
          : {}),
        ...(cachedContext?.previousAiAnswers?.length
          ? { previousAiAnswers: cachedContext.previousAiAnswers }
          : {}),
        ...(cachedContext?.latestAnswerId ? { latestAnswerId: cachedContext.latestAnswerId } : {}),
        ...(cachedContext?.latestAnswerQuestion ? { latestAnswerQuestion: cachedContext.latestAnswerQuestion } : {}),
        ...(cachedContext?.latestAnswerText ? { latestAnswerText: cachedContext.latestAnswerText } : {}),
        ...(cachedContext?.latestAnswerTopic ? { latestAnswerTopic: cachedContext.latestAnswerTopic } : {}),
        ...(cachedContext?.selectedAnswerId ? { selectedAnswerId: cachedContext.selectedAnswerId } : {}),
        ...(cachedContext?.selectedAnswerQuestion ? { selectedAnswerQuestion: cachedContext.selectedAnswerQuestion } : {}),
        ...(cachedContext?.selectedAnswerText ? { selectedAnswerText: cachedContext.selectedAnswerText } : {}),
        ...(cachedContext?.selectedAnswerCodeBlocks?.length
          ? { selectedAnswerCodeBlocks: cachedContext.selectedAnswerCodeBlocks }
          : {}),
        ...(cachedContext?.selectedAnswerTopic ? { selectedAnswerTopic: cachedContext.selectedAnswerTopic } : {}),
        ...(cachedContext?.generatedAnswerText ? { previousAiAnswer: cachedContext.generatedAnswerText } : {}),
        ...(cachedContext?.generatedCodeBlocks?.length ? { previousCodeBlocks: cachedContext.generatedCodeBlocks } : {}),
        answerMode: cachedContext?.answerMode || "auto",
        sourcePlatform: cachedContext?.sourcePlatform || (isTauri() ? "tauri" : "web"),
        isRegenerate: true,
        regenerateTargetAnswerId: messageId,
        regenerateInstruction: REGENERATE_DEFAULT_INSTRUCTION,
      });

      console.log("[useAIChat] handleRegenerate: replay payload source=originalGenerationContext", {
        hasOriginalGenerationContext: !!cachedContext,
        hasOriginalTranscript: !!cachedContext?.originalTranscript,
        hasSelectedAnswerId: !!cachedContext?.selectedAnswerId,
        originalQuestion: resolvedQuestion.slice(0, 140),
        isRegenerate: true,
        regenerateTargetAnswerId: messageId,
      });

      const { controller, reqId } = startNewRequest();
      const regenOp = operationRegistryRef.current.acquire(
        sessionId,
        "ai-answer",
        reqId,
        controller,
      );
      if (!regenOp.acquired) {
        activeRequestIdRef.current = regenOp.existing.requestId;
        activeAbortControllerRef.current =
          regenOp.existing.controller || activeAbortControllerRef.current;
        console.warn("[AI Answer][Dedup] Ignored duplicate regenerate while request is active", {
          sessionId,
          requestId: reqId,
        });
        return;
      }
      console.log(`[useAIChat] handleRegenerate: Assigned request ID: ${reqId}`);
      setIsAnswering(true);
      setIsAnalyzing(false);

      const originalMessageText = targetMessage.text;
      console.log(`[useAIChat] handleRegenerate: Clearing text for messageId: ${messageId} to prepare for fresh stream. Preserving question field.`);
      setAiChat((prev) =>
        prev.map((msg) => (msg.id === messageId ? { ...msg, text: "" } : msg)),
      );

      const decision = prepareGeneration(
        {
          transcript: replayPayload.currentQuestion || question,
          mode: "regenerate",
          sessionId,
          aiModel,
          snapshotId: targetMessage.snapshotId,
        },
        previousContextRef.current?.transcript,
      );

      const segmentId = generateSegmentId(decision.groupedTranscript);
      if (!generationGuardRef.current.canStartGeneration(segmentId, decision.groupedTranscript)) {
        console.log("[useAIChat] handleRegenerate: Generation guard blocked duplicate segment.");
        operationRegistryRef.current.release(sessionId, "ai-answer", reqId);
        if (activeRequestIdRef.current === reqId) {
          pendingLoadingResetRef.current = null;
          setIsAnswering(false);
        }
        setAiChat((prev) =>
          prev.map((msg) =>
            msg.id === messageId ? { ...msg, text: originalMessageText } : msg,
          ),
        );
        return;
      }

      generationGuardRef.current.lockGeneration(segmentId, decision.groupedTranscript);

      try {
        const requestId = replayPayload.requestId || createRequestId();
        const targetUrl = `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/ai-answer`;
        const requestBody = {
          ...replayPayload,
          requestId,
          sessionId,
          isRegenerate: true,
          regenerate: true,
          regenerateTargetAnswerId: messageId,
          regenerateInstruction: REGENERATE_DEFAULT_INSTRUCTION,
          aiModel,
          snapshotId: targetMessage.snapshotId,
        };
	        console.log("[useAIChat] handleRegenerate: requestBody keys", Object.keys(requestBody));
	        console.log(`[useAIChat] handleRegenerate: Dispatching POST to ${targetUrl} with body:`, requestBody);
	        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
            "x-session-id": sessionId,
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
	        });

	        if (response.status === 410) {
	          console.warn("[useAIChat] handleRegenerate: session not active (410), restoring answer");
	          setAiChat((prev) =>
	            prev.map((msg) =>
	              msg.id === messageId ? { ...msg, text: originalMessageText } : msg,
	            ),
	          );
	          notifySessionGone(sessionId);
	          return;
	        }

	        if (response.status === 409) {
	          console.warn("[useAIChat] handleRegenerate: duplicate_in_flight, restoring active answer", {
	            requestId,
	            messageId,
	          });
	          setAiChat((prev) =>
	            prev.map((msg) =>
	              msg.id === messageId ? { ...msg, text: originalMessageText } : msg,
	            ),
	          );
	          return;
	        }

	        if (!response.ok) {
          console.error(`[useAIChat] handleRegenerate: Server returned status ${response.status}`);
          throw new Error("AI request failed");
        }

        console.log("[useAIChat] handleRegenerate: Server responded OK. Obtaining stream reader.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader available");

        await consumeSegmentedStream(
          reader,
          messageId,
          setAiChat,
          targetMessage.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          controller.signal,
          {
            ...(cachedContext || {}),
            originalQuestion: resolvedQuestion.slice(0, 1000),
            originalTranscript: transcriptForReplay.slice(0, 8000),
            currentQuestion: resolvedQuestion.slice(0, 1000),
            answerMode: replayPayload.answerMode || "auto",
            sourcePlatform: replayPayload.sourcePlatform || (isTauri() ? "tauri" : "web"),
            generatedAnswerText: cachedContext?.generatedAnswerText || "",
            generatedCodeBlocks: cachedContext?.generatedCodeBlocks || [],
          },
        );

        const answerText =
          aiChatRef.current.find((m) => m.id === messageId)?.text?.trim() || "";
        commitContinuityFromAnswer(resolvedQuestion, answerText, "regenerate");

        previousContextRef.current = { transcript: resolvedQuestion, timestamp: Date.now() };
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[useAIChat] Regenerate aborted:", reqId);
          return;
        }
        console.error("[useAIChat] AI Regenerate error:", error);

        if (controller.signal.aborted) return;

        setAiChat((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  text: "Sorry, I couldn't regenerate the answer.",
                }
              : msg,
          ),
        );
      } finally {
        generationGuardRef.current.releaseGeneration(segmentId);
        operationRegistryRef.current.release(sessionId, "ai-answer", reqId);
        if (activeRequestIdRef.current === reqId) {
          console.log(`[useAIChat] handleRegenerate: finally block for request ID: ${reqId}. Resetting isAnswering.`);
          pendingLoadingResetRef.current = null;
          setIsAnswering(false);
          setAiChat(removeEmptyAiPlaceholders);
        } else {
          console.log(`[useAIChat] handleRegenerate: request ID mismatch (already superseded). Active: ${activeRequestIdRef.current}, Current: ${reqId}`);
          setAiChat(removeEmptyAiPlaceholders);
        }
      }
    },
    [applyContinuityToQuestion, commitContinuityFromAnswer, createRequestId, startNewRequest],
  );

  return {
    aiChat,
    setAiChat,
    inputMessage,
    setInputMessage,
    isAnalyzing,
    isAnswering,
    handleAnalyzeScreen,
    handleAiAnswer,
    handleCustomQuery,
    handleRegenerate,
    cancelActiveRequest,
    normalizeSttTranscript,
  };
};
