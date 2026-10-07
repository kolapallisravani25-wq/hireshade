/**
 * useFloatingSession — business logic hook for the FloatingApp mini window.
 *
 * Composes:
 *  - Redux slice (floatingSessionSlice) for serializable session state
 *  - Local state for hardware/ephemeral state (mic, tab audio, streaming)
 *  - All Tauri event listeners for session-init, transcript, overlay events
 *  - AI chat via useAIChat
 *  - Timer, heartbeat, SSE hooks
 *
 * The component (FloatingApp) consumes this hook and remains a pure
 * presentation shell with no direct state management.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/globalAuth";
import { isTauri } from "@/lib/utils";
import { useAIChat } from "@/hooks/useAIChat";
import { detectIntent, isFillerPhrase } from "@/lib/intent-detector";
import { useFreeSessionTimer } from "@/hooks/useFreeSessionTimer";
import { useSessionHeartbeat } from "@/hooks/useSessionHeartbeat";
import { createAudioSessionController } from "@/features/session/audio/audioSessionController";
import { deriveCaptureStatus } from "@/features/session/audio/captureStatus";
import { classifySystemHealth } from "@/features/session/audio/systemHealth";
import { extractInterviewKeywordsFromParts } from "@/utils/keywordExtractor";
import { normalizeSttTranscript } from "@/features/session/transcript/stt-normalizer";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  initSession,
  setSelectedModel,
  addMessage,
  patchMessage,
  clearMessages,
  setCreditWarning,
  setIsWindowCollapsed,
  setIsResponsesExpanded,
  setIsTranscriptExpanded,
  setCurrentResponseIndex,
  setAutoGenerate,
  setAutoScroll,
  endSessionThunk,
  isValidModel,
  getValidModel,
  type SessionInitData,
  type TranscriptMessage,
} from "@/features/session/slices/floatingSessionSlice";
import {
  selectSessionInfo,
  selectSelectedModel,
  selectMessages,
  selectCreditWarning,
  selectIsEnding,
  selectIsWindowCollapsed,
  selectIsResponsesExpanded,
  selectIsTranscriptExpanded,
  selectCurrentResponseIndex,
  selectAutoGenerate,
  selectAutoScroll,
  selectLastMessage,
  selectHeartbeatParams,
  selectTimerParams,
} from "@/features/session/selectors/floatingSessionSelectors";
import { isScenarioBased, extractContextFromMessages, buildDynamicTranscriptWindow } from "@/semantic";
import { detectActiveQuestion } from "@/features/session/detection/activeQuestionDetector";
import { buildAdaptiveAiContext } from "@/features/session/context/adaptiveAiContext";
import {
  createTranscriptStabilizer,
  shouldTriggerGeneration,
  classifyTranscript,
  isContinuationOfPreviousQuestion,
  segmentQuestions,
} from "@/lib/generation-pipeline";
import {
  isUtteranceComplete,
  shouldForceCommitInterim,
} from "@/lib/utterance-completeness";
import { resolveEffectiveLiveInterimText } from "./autoGenQuestionSource";
import { attachCancellableListener } from "./cancellableListener";
import {
  AUTO_GEN_INACTIVITY_MS,
  computeTrailingInterviewerMessages,
  findNewestInterviewerMessageId,
  shouldFeedAutoGenCandidate,
} from "./autoGenTrailingTranscript";
import {
  createSessionOperationRegistry,
  createSessionTransitionGuard,
  type SessionLifecycleState,
} from "@/features/session/runtime/sessionRuntime";
import type { AIAnswerRequestPayload } from "@/types/ai-answer";
import { resolveDeepgramKey } from "@/lib/deepgramAuth";
import {
  decideAutoScrollOnAppend,
  nextResponseIndexOnToggle,
} from "@/features/session/hooks/autoScrollPolicy";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
// Deepgram credentials are minted server-side per-session via
// resolveDeepgramKey(); the long-lived master key is never read here, so it
// can't be inlined into the shipped bundle. (Was VITE_DEEPGRAM_API_KEY.)
// Spec §8c/§8.7a: GPT-4o is excluded platform-wide. Screen analysis uses the
// fastest PERMITTED model (Gemini Flash-Lite) for low-latency question reads.
const ANALYZE_SCREEN_FAST_MODEL = "google/gemini-3.1-flash-lite-preview";

/**
 * POST a session-persistence payload with bounded retry + backoff.
 *
 * Transcript writes (save-message, transcript patch) were previously
 * fire-and-forget (`.catch(console.error)`), so ANY transient failure — a
 * dropped Wi-Fi frame, a VPS restart, a 502 during deploy — silently lost that
 * line: it stayed in local Redux but never reached the backend, and the review
 * page (which reads from the backend) would be missing it. That violates the
 * "no data loss" guarantee.
 *
 * Because the backend save-message / transcript-patch writes are now idempotent
 * on the client message id, retrying the same payload is safe (a duplicate
 * delivery updates in place instead of creating a second row). We retry a few
 * times with exponential backoff; only a sustained outage across all attempts
 * gives up, and that is logged loudly.
 */
async function persistWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  attempts = 4,
): Promise<boolean> {
  let delay = 500;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return true;
      // 4xx (except 408/429) won't be fixed by retrying — stop early.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        console.error(`[persist] ${label} rejected ${res.status} — not retrying`);
        return false;
      }
    } catch {
      // network error — fall through to backoff/retry
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 4000);
    }
  }
  console.error(`[persist] ${label} FAILED after ${attempts} attempts — data may be lost on review`);
  return false;
}

function normalizeTranscriptText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Deduplicates repeated adjacent phrases within a single transcript string (up to 6 words).
 */
function deduplicatePhrases(text: string): string {
  let cleaned = text.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  for (let n = 1; n <= Math.min(6, Math.floor(words.length / 2)); n++) {
    for (let i = 0; i <= words.length - 2 * n; i++) {
      const first = words.slice(i, i + n).join(" ").toLowerCase();
      const second = words.slice(i + n, i + 2 * n).join(" ").toLowerCase();
      const normFirst = first.replace(/[^a-z0-9\s]/gi, "").trim();
      const normSecond = second.replace(/[^a-z0-9\s]/gi, "").trim();
      if (normFirst === normSecond && normFirst.length > 0) {
        words.splice(i + n, n);
        i--;
      }
    }
  }
  return words.join(" ");
}

/**
 * Removes sliding-window overlaps between the end of lastText and the start of newText.
 */
function removeOverlap(lastText: string, newText: string): string {
  const normLast = lastText.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, "");
  const normNew = newText.toLowerCase().trim().replace(/[^a-z0-9\s]/gi, "");
  
  const lastWords = normLast.split(/\s+/);
  const newWords = normNew.split(/\s+/);
  
  let overlapWordsCount = 0;
  const maxSearch = Math.min(lastWords.length, newWords.length, 15);
  
  for (let len = 1; len <= maxSearch; len++) {
    const lastSuffix = lastWords.slice(-len).join(" ");
    const newPrefix = newWords.slice(0, len).join(" ");
    if (lastSuffix === newPrefix) {
      overlapWordsCount = len;
    }
  }
  
  if (overlapWordsCount > 0) {
    const actualNewWords = newText.trim().split(/\s+/);
    return actualNewWords.slice(overlapWordsCount).join(" ");
  }
  
  return newText;
}

function getLanguageCode(lang: string): string {
  const mapping: Record<string, string> = {
    English: "en",
    Spanish: "es",
    French: "fr",
    German: "de",
    Hindi: "hi",
    Arabic: "ar",
    Chinese: "zh",
    Portuguese: "pt",
    Japanese: "ja",
  };
  return mapping[lang] || "en";
}

// Fallback window (ms) used only when no AI answer has been given yet in this
// session. Covers a multi-question interviewer monologue at the very start.
const FIRST_ANSWER_WINDOW_MS = 120_000;
const ACTIVE_QUESTION_CONFIDENCE_THRESHOLD = 0.58;

// When regenerate is clicked we intentionally wait a bit so additional
// transcript chunks can arrive before rebuilding the question context.
const REGENERATE_CONTEXT_DELAY_MS = 2200;

// Extra historical context added during regenerate.
// Helps reconstruct incomplete interviewer questions.
const REGENERATE_CONTEXT_LOOKBACK_MS = 15000;

// Fallback message count used when transcript is fragmented.

/**
 * Resolve question from multiple fallback sources.
 *
 * cutoffTimestamp is the timestamp of the LAST successful AI answer.
 * Only messages AFTER that timestamp are considered — this prevents
 * previously-answered questions from being merged with the current one
 * when the user asks a series of short questions one by one.
 *
 * Priority:
 * 1. Live interim text from system audio (Interviewer / tab audio)
 * 2. All Interviewer messages after the cutoff, joined as one transcript
 * 3. All User messages after the cutoff, joined as one transcript
 * 4. Fallback: most recent N messages regardless of cutoff — ensures AI
 *    Answer always has something to send when the user explicitly clicks
 *    it mid-session (e.g. the cutoff has advanced past all transcript).
 *
 * Returns { question, source } or null if there are no messages at all.
 */
const FALLBACK_MSG_COUNT = 12;
const NEAR_DUPLICATE_GAP_MS = 2500;
const STT_INTERIM_FALLBACK_MS = 600;
const SYSTEM_STT_INTERIM_FALLBACK_MS = 300;
// Parity with page.tsx's SYSTEM_INTERIM_MAX_INCOMPLETE_WAIT_MS: bound on how
// long an INCOMPLETE interim fragment (per isUtteranceComplete — dangling
// connector, no terminal punctuation, too few words) can withhold a forced
// fallback commit, e.g. across a natural mid-question pause. Prevents an
// unpunctuated-but-truly-finished utterance (no real STT final ever arrives)
// from being lost forever.
const FALLBACK_MAX_INCOMPLETE_WAIT_MS = 6000;
const MIN_INCLUDE_DUPLICATE_LEN = 20;
const SYSTEM_EMPTY_FINAL_STORM_COUNT = 6;
const SYSTEM_EMPTY_FINAL_STORM_WINDOW_MS = 10_000;
const SYSTEM_NO_EVENTS_STALE_MS = 10_000;
const SYSTEM_NO_MEANINGFUL_STALE_MS = 20_000;
const SYSTEM_HEALTH_LOG_INTERVAL_MS = 5000;
// Rust emits stt:health:system every 1 s while the send loop is alive. Allow a
// few missed beats (event-loop jitter / brief stalls) before treating the
// transport as dead — this is the ONLY signal that force-reacquires capture, so
// it must not trip on ordinary silence, only on a genuinely dead heartbeat.
const SYSTEM_HEARTBEAT_STALE_MS = 6000;
const SYSTEM_RESTART_MAX_PER_WINDOW = 3;
const SYSTEM_RESTART_WINDOW_MS = 60_000;
const SYSTEM_RESTART_BUDGET_RESET_MS = 75_000;
const EMPTY_FINAL_LOG_THRESHOLDS = [3, 6, 10] as const;
const isDeepgramAuthFailureMessage = (value: string | null | undefined): boolean => {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes("http 401")
    || normalized.includes("invalid_auth")
    || normalized.includes("invalid credentials")
  );
};
type TranscriptInsertSource =
  | "stt:user"
  | "stt:interviewer"
  | "overlay"
  | "restore"
  | "save-response"
  | "patch";
type SttSourceKey = "mic" | "system";
type CommitOutcome =
  | { status: "inserted"; id: string }
  | { status: "patched"; id: string; reason?: string }
  | { status: "suppressed"; reason: string }
  | { status: "empty"; reason: string };
type SystemHealthPayload = {
  channel: "system";
  captureRunning: boolean;
  deepgramRunning: boolean;
  pcmFramesSent: number;
  lastPcmAt: number;
  emptyFinalStreak: number;
  generation: number;
  state: string;
};

type MacPermissionStatus =
  | "granted"
  | "denied"
  | "not_determined"
  | "restricted"
  | "unknown"
  | "restart_required";

type MacPermissionPayload = { status: MacPermissionStatus };

type MacAppIdentity = {
  bundleIdentifier: string;
  executablePath: string;
  appName: string;
  isPackaged: boolean;
  isDevMode: boolean;
};

function normalizeLoose(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function areNearDuplicateTexts(a: string, b: string): boolean {
  const na = normalizeLoose(a);
  const nb = normalizeLoose(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;

  if (shorter.length >= MIN_INCLUDE_DUPLICATE_LEN) {
    return longer.includes(shorter);
  }
  return false;
}


function endsWithConnector(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  return /\b(the|that|this|in|on|of|with|for|to|and|or|because|if|when|while)$/.test(
    t,
  );
}

function dedupeAndMergeConsecutiveChunks(
  entries: { text: string; timestamp: number }[],
): string[] {
  if (!entries.length) return [];

  const ordered = [...entries]
    .filter((e) => e.text?.trim())
    .sort((a, b) => a.timestamp - b.timestamp);

  const deduped: { text: string; timestamp: number }[] = [];
  for (const cur of ordered) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      cur.timestamp - prev.timestamp <= NEAR_DUPLICATE_GAP_MS &&
      areNearDuplicateTexts(prev.text, cur.text)
    ) {
      if (cur.text.trim().length > prev.text.trim().length) {
        deduped[deduped.length - 1] = cur;
      }
      continue;
    }
    deduped.push(cur);
  }

  const merged: string[] = [];
  for (const cur of deduped) {
    const text = cur.text.trim();
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(text);
      continue;
    }
    if (endsWithConnector(prev)) {
      merged[merged.length - 1] = `${prev} ${text}`.replace(/\s+/g, " ").trim();
      continue;
    }
    merged.push(text);
  }

  return merged;
}

function isQuestionLikeText(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (t.includes("?")) return true;
  return /^(what|why|how|when|where|which|who|can|could|would|should|is|are|do|does|did|explain|show|give|write|debug|optimi[sz]e|refactor)\b/i.test(
    t,
  );
}

function dedupeAndMergeTranscriptEntries(
  entries: { sender: "User" | "Interviewer"; text: string; timestamp: number }[],
): { sender: "User" | "Interviewer"; text: string; timestamp: number }[] {
  if (!entries.length) return [];

  const ordered = [...entries]
    .filter((e) => e.text?.trim())
    .sort((a, b) => a.timestamp - b.timestamp);

  const deduped: { sender: "User" | "Interviewer"; text: string; timestamp: number }[] = [];
  for (const cur of ordered) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.sender === cur.sender &&
      cur.timestamp - prev.timestamp <= NEAR_DUPLICATE_GAP_MS &&
      areNearDuplicateTexts(prev.text, cur.text)
    ) {
      if (cur.text.trim().length > prev.text.trim().length) {
        deduped[deduped.length - 1] = cur;
      }
      continue;
    }
    deduped.push(cur);
  }

  const merged: { sender: "User" | "Interviewer"; text: string; timestamp: number }[] = [];
  for (const cur of deduped) {
    const text = cur.text.trim();
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...cur, text });
      continue;
    }

    if (prev.sender === cur.sender && endsWithConnector(prev.text)) {
      merged[merged.length - 1] = {
        ...prev,
        text: `${prev.text} ${text}`.replace(/\s+/g, " ").trim(),
        timestamp: cur.timestamp,
      };
      continue;
    }

    merged.push({ ...cur, text });
  }

  return merged;
}

function resolveQuestionFromContext(
  liveInterimText: string,
  allMessages: { text: string; sender: string; timestamp: number }[],
  _lastMessage: { text: string; sender: string } | null,
  lastAnswerTimestamp: number | null,
): { question: string; source: string } | null {
  const normalizedMessages = allMessages.map((message) => ({
    ...message,
    text: normalizeSttTranscript(message.text || ""),
  }));
  const normalizedLiveInterim = normalizeSttTranscript(liveInterimText || "");
  // Priority 1: Live interim text from system audio
  if (normalizedLiveInterim?.trim()) {
    // Apply intent detection to clean up speech recognition artifacts
    const intent = detectIntent(normalizedLiveInterim.trim());
    return { question: intent.cleanedQuestion, source: "live_interim" };
  }

  // Priority 1.5: Scenario-based context preservation using new semantic engine
  // Check if recent transcript contains scenario markers and extract full context block
  const recentFallback = normalizedMessages
    .filter((m) => m.text?.trim())
    .slice(-FALLBACK_MSG_COUNT);

  if (recentFallback.length > 0) {
    const fallbackText = recentFallback.map((m) => m.text.trim()).join(" ");
    
    // If this is a scenario-based question, use expanded context window
    // Wrap in try-catch to prevent app freeze if semantic engine has issues
    try {
      if (isScenarioBased(fallbackText)) {
        // Build dynamic context window for scenario-based questions
        const windowConfig = buildDynamicTranscriptWindow("scenario");
        const scenarioContext = extractContextFromMessages(allMessages, windowConfig, lastAnswerTimestamp);
        
        if (scenarioContext && scenarioContext.length > fallbackText.length) {
          console.log(
            "[resolveQuestionFromContext] Scenario-based question detected. Using expanded context window:",
            windowConfig.messageCount,
            "messages,",
            windowConfig.timeWindowMs,
            "ms",
          );
          // Apply intent detection to clean up the scenario context
          const intent = detectIntent(deduplicatePhrases(scenarioContext));
          return {
            question: intent.cleanedQuestion,
            source: "scenario_context",
          };
        }
      }
    } catch (error) {
      console.error("[resolveQuestionFromContext] Semantic engine error, falling back to standard logic:", error);
      // Fall through to standard logic below
    }
  }

  // Determine the cutoff:
  // • If an answer has been given before: use that timestamp so only messages
  //   that arrived AFTER the last answer are included.
  // • First-ever click: use a 120s fallback to capture a full opening monologue.
  // • Ensure cutoff is at least 5 seconds old to handle rapid clicks after answers.
  const cutoff =
    lastAnswerTimestamp !== null
      ? Math.min(lastAnswerTimestamp, Date.now() - 5000)
      : Date.now() - FIRST_ANSWER_WINDOW_MS;

  // Priority 2: Join all Interviewer messages that arrived after the cutoff.
  // Speech-to-text delivers each sentence as a separate Redux message, so a
  // two-question block produces two entries. Joining them reconstructs the
  // full question block without leaking previously-answered content.
  const recentInterviewer = normalizedMessages
    .filter((m) => m.sender === "Interviewer" && m.timestamp > cutoff && m.text?.trim())
    .map((m) => ({ text: m.text.trim(), timestamp: m.timestamp }));
  const mergedInterviewer = dedupeAndMergeConsecutiveChunks(recentInterviewer);

  if (mergedInterviewer.length > 0) {
    const joined = mergedInterviewer.join(" ");
    const intent = detectIntent(joined);
    return {
      question: intent.cleanedQuestion,
      source: "transcript_history",
    };
  }

  // Priority 3: Join all User messages that arrived after the cutoff.
  const recentUser = normalizedMessages
    .filter((m) => m.sender === "User" && m.timestamp > cutoff && m.text?.trim())
    .map((m) => ({ text: m.text.trim(), timestamp: m.timestamp }));
  const mergedUser = dedupeAndMergeConsecutiveChunks(recentUser);

  if (mergedUser.length > 0) {
    const joined = mergedUser.join(" ");
    // Check if the joined text is primarily filler/noise
    if (!isFillerPhrase(joined)) {
      const intent = detectIntent(joined);
      return {
        question: intent.cleanedQuestion,
        source: "user_transcript",
      };
    }
  }

  // Priority 4 fallback: cutoff-filtered sources are empty (e.g. the user
  // stopped speaking and lastAnswerTimestamp is newer than all transcript).
  // Use the most recent FALLBACK_MSG_COUNT messages regardless of cutoff so
  // that AI Answer always generates when explicitly clicked and regenerate
  // always has context to send.
  if (recentFallback.length > 0) {
    // Apply deduplication to the joined fallback text to prevent duplicate loops
    const fallbackChunks = dedupeAndMergeConsecutiveChunks(
      recentFallback.map((m) => ({ text: m.text.trim(), timestamp: m.timestamp })),
    );
    const latestMeaningfulQuestion = [...fallbackChunks]
      .reverse()
      .find((chunk) => !isFillerPhrase(chunk) && isQuestionLikeText(chunk));
    if (latestMeaningfulQuestion) {
      const intent = detectIntent(latestMeaningfulQuestion);
      return {
        question: intent.cleanedQuestion,
        source: "transcript_fallback",
      };
    }

    const joinedText = fallbackChunks.join(" ");
    const dedupedText = deduplicatePhrases(joinedText);
    // Check if the deduped text is primarily filler/noise
    if (!isFillerPhrase(dedupedText)) {
      const intent = detectIntent(dedupedText);
      return {
        question: intent.cleanedQuestion,
        source: "transcript_fallback",
      };
    }
  }

  return null;
}



/**
 * Check if a question was recently answered (within threshold ms)
 * Returns { isRecent: boolean, lastAnswerTime: number | null }
 */
function isRecentlyAnswered(
  normalizedQuestion: string,
  answeredQuestionsHistory: { text: string; normalizedText: string; timestamp: number }[],
  thresholdMs: number = 3000,
): { isRecent: boolean; lastAnswerTime: number | null } {
  const now = Date.now();
  for (const record of answeredQuestionsHistory) {
    if (record.normalizedText === normalizedQuestion) {
      const timeSinceAnswer = now - record.timestamp;
      if (timeSinceAnswer < thresholdMs) {
        return { isRecent: true, lastAnswerTime: timeSinceAnswer };
      }
    }
  }
  return { isRecent: false, lastAnswerTime: null };
}

export function useFloatingSession() {
  const audioControllerRef = useRef(
    createAudioSessionController({
      source: "floating-session",
    }),
  );

  const dispatch = useAppDispatch();

  // ── Redux state ─────────────────────────────────────────────────────────────
  const sessionInfo = useAppSelector(selectSessionInfo);
  const selectedModel = useAppSelector(selectSelectedModel);
  const messages = useAppSelector(selectMessages);
  const creditWarning = useAppSelector(selectCreditWarning);
  const isEnding = useAppSelector(selectIsEnding);
  const isWindowCollapsed = useAppSelector(selectIsWindowCollapsed);
  const isResponsesExpanded = useAppSelector(selectIsResponsesExpanded);
  const isTranscriptExpanded = useAppSelector(selectIsTranscriptExpanded);
  const currentResponseIndex = useAppSelector(selectCurrentResponseIndex);
  const autoGenerate = useAppSelector(selectAutoGenerate);
  const autoScroll = useAppSelector(selectAutoScroll);
  const lastMessage = useAppSelector(selectLastMessage);
  const heartbeatParams = useAppSelector(selectHeartbeatParams);
  const timerParams = useAppSelector(selectTimerParams);

  // ── Stable refs (prevent stale closures in Tauri event listeners) ──────────
  const sessionInfoRef = useRef<SessionInitData | null>(null);
  const messagesRef = useRef<TranscriptMessage[]>([]);
  const selectedModelRef = useRef(selectedModel);
  // Track answered questions with timestamp to allow re-answering after 3+ seconds
  const answeredQuestionsHistoryRef = useRef<{ text: string; normalizedText: string; timestamp: number }[]>([]);
  // Timestamp of the most recent successful AI answer click.
  // Used as the message cutoff so only NEW messages since the last answer
  // are included in the next question — prevents stale questions being merged.
  const lastAnswerTimestampRef = useRef<number | null>(null);
  // The cutoff that was active BEFORE the last answer was given.
  // Used by regenerate so it can widen the window back to pre-click context,
  // picking up any additional transcript that arrived after an early accidental click.
  const prevAnswerTimestampRef = useRef<number | null>(null);

  // Normalized-messages cache — recomputed only when length or last timestamp changes.
  // Both detectActiveQuestion and resolveQuestionFromContext normalize every message
  // internally; pre-computing once per click (4 calls → 1 pass) is the primary H2 fix.
  const normalizedMsgsCacheRef = useRef<{
    length: number;
    lastTimestamp: number;
    forDetection: { sender: "User" | "Interviewer"; text: string; timestamp: number }[];
    forResolution: { text: string; sender: string; timestamp: number }[];
  } | null>(null);

  const getOrBuildNormalizedMsgs = useCallback(() => {
    const msgs = messagesRef.current;
    const lastTs = msgs[msgs.length - 1]?.timestamp ?? 0;
    const c = normalizedMsgsCacheRef.current;
    if (c && c.length === msgs.length && c.lastTimestamp === lastTs) return c;
    const forDetection = msgs
      .filter((m) => (m.sender === "Interviewer" || m.sender === "User") && !!m.text?.trim())
      .map((m) => ({
        sender: m.sender as "User" | "Interviewer",
        text: normalizeSttTranscript(m.text.trim()),
        timestamp: m.timestamp,
      }));
    const forResolution = msgs.map((m) => ({
      ...m,
      text: normalizeSttTranscript(m.text || ""),
    }));
    const entry = { length: msgs.length, lastTimestamp: lastTs, forDetection, forResolution };
    normalizedMsgsCacheRef.current = entry;
    return entry;
  }, []);

  sessionInfoRef.current = sessionInfo;
  messagesRef.current = messages;
  selectedModelRef.current = selectedModel;

  // Ensure selected model is always valid
  useEffect(() => {
    if (!isValidModel(selectedModel)) {
      console.warn("[useFloatingSession] Invalid model selected, auto-correcting to default:", selectedModel);
      dispatch(setSelectedModel(getValidModel(selectedModel)));
    }
  }, [selectedModel, dispatch]);

  // Keep ref in sync with validated model
  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  // ── Hardware / ephemeral local state (NOT in Redux) ─────────────────────────
  const [isMicActive, setIsMicActive] = useState(false);
  const [isMicConnecting, setIsMicConnecting] = useState(false);
  const [micInterimTranscript, setMicInterimTranscript] = useState("");
  const [tabStatus, setTabStatus] = useState<"idle" | "connecting" | "transcribing" | "error">("idle");
  const [tabError, setTabError] = useState<string | null>(null);
  const [tabErrorPermissionType, setTabErrorPermissionType] = useState<"microphone" | "screen-recording" | null>(null);
  const [permissionIdentity, setPermissionIdentity] = useState<MacAppIdentity | null>(null);
  const [permissionRequiresRestart, setPermissionRequiresRestart] = useState(false);
  const [tabInterimTranscript, setTabInterimTranscript] = useState("");
  const [captureArmed, setCaptureArmed] = useState(false);
  // Ref that always reflects the current captureArmed value — allows interval
  // callbacks to read fresh state without relying on a stale closure.
  const captureArmedRef = useRef(captureArmed);
  captureArmedRef.current = captureArmed;
  const [isSystemStale, setIsSystemStale] = useState(false);
  const systemStartIssuedForSessionRef = useRef<string | null>(null);
  const systemStartInFlightRef = useRef(false);
  const micStartInFlightRef = useRef(false);
  const systemHealthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const systemReacquireInFlightRef = useRef(false);
  const lastLoggedHealthAtRef = useRef(0);
  const lastLoggedEmptyFinalThresholdRef = useRef(0);
  const previousHealthStateRef = useRef("idle");
  const previousCaptureRunningRef = useRef(false);
  const previousDeepgramRunningRef = useRef(false);
  const previousIsSystemStaleRef = useRef(false);
  const previousSystemPhaseRef = useRef<"idle" | "connecting" | "transcribing" | "stale" | "reconnecting" | "error">("idle");
  const lastPcmFramesCheckedRef = useRef(0);
  const systemHealthRef = useRef<{
    lastSystemInterimAt: number;
    lastSystemFinalAt: number;
    lastMeaningfulSystemTranscriptAt: number;
    lastSystemEventAt: number;
    emptyFinalStreak: number;
    emptyFinalWindowStartAt: number;
    systemRestartCount: number;
    systemRestartWindowStartAt: number;
    lastSystemRestartAt: number;
    lastHealthyAt: number;
    lastPcmAt: number;
    lastPcmFramesSent: number;
    lastDeepgramRunningAt: number;
    lastHeartbeatAt: number;
    captureRunning: boolean;
    deepgramRunning: boolean;
    healthState: string;
    isSystemSilent: boolean;
  }>({
    lastSystemInterimAt: 0,
    lastSystemFinalAt: 0,
    lastMeaningfulSystemTranscriptAt: 0,
    lastSystemEventAt: 0,
    emptyFinalStreak: 0,
    emptyFinalWindowStartAt: 0,
    systemRestartCount: 0,
    systemRestartWindowStartAt: 0,
    lastSystemRestartAt: 0,
    lastHealthyAt: 0,
    lastPcmAt: 0,
    lastPcmFramesSent: 0,
    lastDeepgramRunningAt: 0,
    lastHeartbeatAt: 0,
    captureRunning: false,
    deepgramRunning: false,
    healthState: "idle",
    isSystemSilent: false,
  });
  const logSystemHealthSummary = useCallback(
    (state: string, stale: boolean) => {
      if (!import.meta.env.DEV) return;
      const now = Date.now();
      if (now - lastLoggedHealthAtRef.current < SYSTEM_HEALTH_LOG_INTERVAL_MS) return;
      lastLoggedHealthAtRef.current = now;
      const health = systemHealthRef.current;
      console.log("[audio-lifecycle] systemHealthSummary", {
        state,
        pcmFramesSent: health.lastPcmFramesSent,
        emptyFinalStreak: health.emptyFinalStreak,
        silent: health.isSystemSilent,
        stale,
      });
    },
    [],
  );
  const logSystemTransition = useCallback(
    (from: "idle" | "connecting" | "transcribing" | "stale" | "reconnecting" | "live" | "error", to: "idle" | "connecting" | "transcribing" | "stale" | "reconnecting" | "live" | "error") => {
      if (!import.meta.env.DEV || from === to) return;
      console.log("[audio-lifecycle] systemTransition", { transition: `${from} -> ${to}` });
    },
    [],
  );
  const [isCapturing, setIsCapturing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const patchPersistTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const recentInsertionsRef = useRef<
    { sender: "User" | "Interviewer"; normalized: string; timestamp: number }[]
  >([]);
  const editingMessageIdsRef = useRef<Set<string>>(new Set());
  const sttSourceStateRef = useRef<
    Record<
      SttSourceKey,
      {
        latestInterimText: string;
        latestInterimAt: number;
        fallbackMessageId: string | null;
        fallbackCommittedAt: number | null;
        timer: ReturnType<typeof setTimeout> | null;
        // Timestamp of when the current uncommitted interim text started
        // accumulating without a real STT final — bounds how long an
        // incomplete fragment can withhold a forced fallback commit.
        fallbackPendingSince: number | null;
      }
    >
  >({
    mic: {
      latestInterimText: "",
      latestInterimAt: 0,
      fallbackMessageId: null,
      fallbackCommittedAt: null,
      timer: null,
      fallbackPendingSince: null,
    },
    system: {
      latestInterimText: "",
      latestInterimAt: 0,
      fallbackMessageId: null,
      fallbackCommittedAt: null,
      timer: null,
      fallbackPendingSince: null,
    },
  });

  useEffect(() => {
    return () => {
      Object.values(patchPersistTimersRef.current).forEach((timer) => clearTimeout(timer));
      patchPersistTimersRef.current = {};
      const st = sttSourceStateRef.current;
      if (st.mic.timer) clearTimeout(st.mic.timer);
      if (st.system.timer) clearTimeout(st.system.timer);
      st.mic.timer = null;
      st.system.timer = null;
    };
  }, []);

  useEffect(() => {
    const onEditingState = (evt: Event) => {
      const custom = evt as CustomEvent<{ messageId?: string; isEditing?: boolean }>;
      const messageId = custom.detail?.messageId;
      if (!messageId) return;
      if (custom.detail?.isEditing) editingMessageIdsRef.current.add(messageId);
      else editingMessageIdsRef.current.delete(messageId);
    };
    window.addEventListener("hireshade:transcript-editing", onEditingState as EventListener);
    return () => {
      window.removeEventListener("hireshade:transcript-editing", onEditingState as EventListener);
    };
  }, []);

  // ── Mutual exclusion refs for AI operations ─────────────────────────────────
  const isEmittingRef = useRef(false);
  const isAiAnswerRunningRef = useRef(false);
  const isAnalyzeEmittingRef = useRef(false);
  const [isAiAnswerUiLocked, setIsAiAnswerUiLocked] = useState(false);
  const sessionStateRef = useRef<SessionLifecycleState>("idle");
  const transitionGuardRef = useRef(
    createSessionTransitionGuard("idle", (event) => {
      console.log("[Session][Transition]", event);
      if (event.allowed) sessionStateRef.current = event.to;
    }),
  );
  const operationRegistryRef = useRef(
    createSessionOperationRegistry((event) => {
      console.log("[Session][Operation]", event);
    }),
  );

  // ── AI Chat hook (streaming state lives here, not in Redux) ─────────────────
  const {
    aiChat,
    setAiChat,
    isAnalyzing,
    isAnswering,
    handleAiAnswer,
    handleAnalyzeScreen,
    handleCustomQuery,
    handleRegenerate,
    cancelActiveRequest,
  } = useAIChat();

  const aiResponses = aiChat.filter((m) => m.sender === "AI");

  useEffect(() => {
    if (!sessionInfo?.sessionId) {
      transitionGuardRef.current.transition("cleanup", "session_missing_or_reset");
      cancelActiveRequest("session_missing_or_reset");
      operationRegistryRef.current.clear();
      isAiAnswerRunningRef.current = false;
      isEmittingRef.current = false;
      setIsAiAnswerUiLocked(false);
      transitionGuardRef.current.transition("idle", "cleanup_completed");
      return;
    }
    if (sessionStateRef.current === "idle") {
      transitionGuardRef.current.transition("initializing", "session_detected", sessionInfo.sessionId);
      transitionGuardRef.current.transition("recording", "session_ready", sessionInfo.sessionId);
    }
  }, [cancelActiveRequest, sessionInfo?.sessionId]);

  // ── Deduplication helpers ───────────────────────────────────────────────────

  const isDupeMessage = useCallback(
    (sender: "User" | "Interviewer", text: string, timestamp: number): boolean => {
      const normalized = normalizeLoose(text);
      // Check against recent messages from the same sender (last 20)
      // with short timestamp window to suppress burst duplicates only.
      const recentMessages = messagesRef.current.slice(-20);
      return recentMessages.some((m) => {
        if (m.sender !== sender) return false;
        if (typeof m.timestamp !== "number") return false;
        if (Math.abs(timestamp - m.timestamp) > NEAR_DUPLICATE_GAP_MS) return false;
        const existing = normalizeLoose(m.text);
        return areNearDuplicateTexts(existing, normalized);
      });
    },
    [],
  );

  const CROSS_SENDER_GAP_MS = 800;
  const shouldSuppressInsertion = useCallback(
    (sender: "User" | "Interviewer", text: string, timestamp: number): boolean => {
      const normalized = normalizeLoose(text);
      if (!normalized) return true;

      // 1) Check recent in-memory insertions first (covers bursts before Redux settles).
      const arr = recentInsertionsRef.current;
      let stale = 0;
      while (stale < arr.length && timestamp - arr[stale].timestamp > NEAR_DUPLICATE_GAP_MS) stale++;
      if (stale > 0) arr.splice(0, stale);
      const dupFromRecentInsertions = recentInsertionsRef.current.some((entry) => {
        const gap = Math.abs(timestamp - entry.timestamp);
        if (!areNearDuplicateTexts(entry.normalized, normalized)) return false;
        // Same sender: suppress within normal near-duplicate window.
        if (entry.sender === sender) return gap <= NEAR_DUPLICATE_GAP_MS;
        // Cross sender: suppress only in very short overlap bursts.
        return gap <= CROSS_SENDER_GAP_MS;
      });
      if (dupFromRecentInsertions) return true;

      // 2) Check current state messages with the same sender-aware windows.
      const recentMessages = messagesRef.current.slice(-30);
      const dupFromState = recentMessages.some((m) => {
        if (typeof m.timestamp !== "number") return false;
        const gap = Math.abs(timestamp - m.timestamp);
        if (!areNearDuplicateTexts(normalizeLoose(m.text), normalized)) return false;
        if (m.sender === sender) return gap <= NEAR_DUPLICATE_GAP_MS;
        return gap <= CROSS_SENDER_GAP_MS;
      });
      return dupFromState;
    },
    [],
  );

  const replaceNearDuplicateIfRicher = useCallback(
    (sender: "User" | "Interviewer", text: string, timestamp: number): { handled: boolean; patchedId?: string } => {
      const normalized = normalizeLoose(text);
      const candidates = messagesRef.current
        .filter((m) => m.sender === sender && typeof m.timestamp === "number")
        .slice(-20);
      const match = candidates.findLast(
        (m) =>
          Math.abs(timestamp - m.timestamp) <= NEAR_DUPLICATE_GAP_MS &&
          areNearDuplicateTexts(normalized, normalizeLoose(m.text)),
      );
      if (!match) return { handled: false };
      if (text.trim().length <= match.text.trim().length) return { handled: true };
      dispatch(
        patchMessage({
          id: match.id,
          patchedText: text.trim(),
          patchedAt: timestamp,
          patchedByUser: false,
        }),
      );
      recentInsertionsRef.current.push({ sender: sender as "User" | "Interviewer", normalized, timestamp });
      if (recentInsertionsRef.current.length > 40) recentInsertionsRef.current.splice(0, recentInsertionsRef.current.length - 40);
      return { handled: true, patchedId: match.id };
    },
    [dispatch],
  );

  // ── Transcript message handlers ─────────────────────────────────────────────
  const clearSttSourceTimer = useCallback((source: SttSourceKey) => {
    const sourceState = sttSourceStateRef.current[source];
    if (sourceState.timer) {
      clearTimeout(sourceState.timer);
      sourceState.timer = null;
    }
  }, []);

  const senderForSource = useCallback(
    (source: SttSourceKey): "User" | "Interviewer" =>
      source === "mic" ? "User" : "Interviewer",
    [],
  );

  const shouldPreferFinalOverInterim = useCallback((finalText: string, interimText: string): boolean => {
    const finalNorm = normalizeLoose(finalText);
    const interimNorm = normalizeLoose(interimText);
    if (!finalNorm) return false;
    if (!interimNorm) return true;
    if (areNearDuplicateTexts(finalNorm, interimNorm)) {
      return finalNorm.length >= interimNorm.length;
    }
    return finalNorm.length >= interimNorm.length;
  }, []);

  const persistAutoTranscriptUpgrade = useCallback(
    (
      messageId: string,
      sender: "User" | "Interviewer",
      originalText: string,
      patchedText: string,
      timestamp?: number,
    ) => {
      const sid = sessionInfoRef.current?.sessionId;
      if (!sid || sessionInfoRef.current?.saveTranscript === false) return;
      getAuthHeaders().then((authHeaders) =>
        persistWithRetry(
          `${BACKEND_URL}/api/session/${sid}/transcript/${messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              patchedText,
              originalText,
              patchedAt: new Date().toISOString(),
              patchedByUser: false,
              sender,
              timestamp,
            }),
          },
          "transcript-auto-upgrade",
        ),
      ).catch((err) => console.error("[useFloatingSession] auto transcript upgrade PATCH failed:", err));
    },
    [],
  );

  const commitTranscriptMessage = useCallback(
    (
      sender: "User" | "Interviewer",
      rawText: string,
      source: TranscriptInsertSource,
      forcedTimestamp?: number,
    ): CommitOutcome | void => {
      if (!rawText.trim()) return { status: "empty", reason: "empty_input" };

      let cleanText = deduplicatePhrases(normalizeSttTranscript(rawText));
      const lastSameSenderMsg = messagesRef.current.findLast((m) => m.sender === sender);
      if (lastSameSenderMsg) {
        cleanText = removeOverlap(lastSameSenderMsg.text, cleanText);
      }
      cleanText = cleanText.trim();
      if (!cleanText) return { status: "empty", reason: "empty_after_cleanup" };

      const sid = sessionInfoRef.current?.sessionId;
      const now = forcedTimestamp ?? Date.now();

      const replaceResult = replaceNearDuplicateIfRicher(sender, cleanText, now);
      if (replaceResult.handled) {
        if (replaceResult.patchedId) {
          return { status: "patched", id: replaceResult.patchedId, reason: "updated_fallback_row" };
        }
        return { status: "suppressed", reason: "weaker_than_existing" };
      }
      if (shouldSuppressInsertion(sender, cleanText, now)) {
        return { status: "suppressed", reason: "suppressed_duplicate" };
      }

      const generatedId = Math.random().toString(36).slice(7);
      dispatch(
        addMessage({
          id: generatedId,
          sender,
          text: cleanText,
          timestamp: now,
        }),
      );
      recentInsertionsRef.current.push({ sender, normalized: normalizeLoose(cleanText), timestamp: now });
      if (recentInsertionsRef.current.length > 40) recentInsertionsRef.current.splice(0, recentInsertionsRef.current.length - 40);

      // Skip persistence for ephemeral sessions (saveTranscript === false),
      // matching the transcript PATCH which already guards on this. Previously
      // the POST ignored the flag and persisted anyway — an ephemeral session
      // still wrote its transcript to the backend.
      if (sid && sessionInfoRef.current?.saveTranscript !== false) {
        getAuthHeaders().then((authHeaders) =>
          persistWithRetry(
            `${BACKEND_URL}/api/session/${sid}/save-message`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({
                messageId: generatedId,
                role: sender === "User" ? "USER" : "INTERVIEWER",
                question: cleanText,
                answer: "",
                time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              }),
            },
            "save-message",
          ),
        ).catch(console.error);
      }

      return { status: "inserted", id: generatedId };
    },
    [dispatch, replaceNearDuplicateIfRicher, shouldSuppressInsertion],
  );

  const scheduleFallbackCommit = useCallback(
    (source: SttSourceKey) => {
      clearSttSourceTimer(source);
      const sourceState = sttSourceStateRef.current[source];
      if (sourceState.fallbackPendingSince === null) {
        sourceState.fallbackPendingSince = Date.now();
      }
      const intervalMs =
        source === "system" ? SYSTEM_STT_INTERIM_FALLBACK_MS : STT_INTERIM_FALLBACK_MS;

      const runCheck = () => {
        sourceState.timer = null;
        const interim = sourceState.latestInterimText.trim();
        if (!interim) {
          sourceState.fallbackPendingSince = null;
          return;
        }

        // Parity fix (long-question split root cause): a bare elapsed-timer
        // must not force-commit an obviously incomplete fragment ("Can you
        // explain the difference between an interface and an abstract") just
        // because no new interim arrived for `intervalMs` — a natural
        // mid-question pause looks identical to "done speaking" to a bare
        // timer, and each premature commit was becoming its OWN separate
        // transcript row (confirmed via runtime trace: repeated
        // [DIAG][stt-fallback-outcome] status: "inserted" on progressive
        // fragments). Reuse the same isUtteranceComplete-based gate
        // page.tsx's scheduleSystemInterimCommit already uses, bounded by
        // FALLBACK_MAX_INCOMPLETE_WAIT_MS so a genuinely stalled/unpunctuated
        // utterance still commits eventually rather than being lost forever.
        const pendingSince = sourceState.fallbackPendingSince ?? Date.now();
        const waitedMs = Date.now() - pendingSince;
        if (!shouldForceCommitInterim(interim, waitedMs, FALLBACK_MAX_INCOMPLETE_WAIT_MS)) {
          // TEMP DIAGNOSTIC (long-question split investigation, remove
          // after): proves the gate is actively holding back an incomplete
          // fragment instead of committing it. Dev-only.
          if (import.meta.env.DEV) {
            console.log("[DIAG][stt-fallback-waiting]", {
              source,
              interim,
              waitedMs,
              at: Date.now(),
            });
          }
          sourceState.timer = setTimeout(runCheck, intervalMs);
          return;
        }

        sourceState.fallbackPendingSince = null;
        const sender = senderForSource(source);
        const sourceLabel: TranscriptInsertSource =
          source === "mic" ? "stt:user" : "stt:interviewer";
        // TEMP DIAGNOSTIC (long-question split investigation, remove after):
        // the fallback timer fired — this is the exact text it's about to
        // force-commit as a "final" row. Answers "did scheduleFallbackCommit
        // fire during the natural mid-question pause?". Dev-only.
        if (import.meta.env.DEV) {
          console.log("[DIAG][stt-fallback-firing]", {
            source,
            interim,
            interimLength: interim.length,
            at: Date.now(),
          });
        }
        const outcome = commitTranscriptMessage(sender, interim, sourceLabel, Date.now());
        // TEMP DIAGNOSTIC (long-question split investigation, remove after):
        // the actual commitTranscriptMessage outcome for THIS fallback fire —
        // "inserted" means a NEW transcript row was created; "patched" means
        // an existing (near-duplicate) row was extended in place. Answers
        // "did it create a separate transcript row or extend the existing
        // one?". Dev-only.
        if (import.meta.env.DEV) {
          console.log("[DIAG][stt-fallback-outcome]", {
            source,
            status: outcome?.status,
            id: (outcome as { id?: string } | undefined)?.id,
            reason: (outcome as { reason?: string } | undefined)?.reason,
            at: Date.now(),
          });
        }
        if (outcome?.status === "inserted" || outcome?.status === "patched") {
          sourceState.fallbackMessageId = outcome.id;
          sourceState.fallbackCommittedAt = Date.now();
          console.log("[stt-fallback] fallbackCommitted", {
            source,
            fallbackCommitted: true,
            messageId: outcome.id,
            textLength: interim.length,
            sourcePlatform: "tauri",
          });
        }
      };

      sourceState.timer = setTimeout(runCheck, intervalMs);
    },
    [clearSttSourceTimer, commitTranscriptMessage, senderForSource],
  );

  const reconcileFinalForSource = useCallback(
    (source: SttSourceKey, finalText: string) => {
      const sourceState = sttSourceStateRef.current[source];
      clearSttSourceTimer(source);
      const interimText = sourceState.latestInterimText.trim();
      const sender = senderForSource(source);
      const sourceLabel: TranscriptInsertSource =
        source === "mic" ? "stt:user" : "stt:interviewer";
      const finalTrimmed = (finalText || "").trim();

      if (sourceState.fallbackMessageId) {
        const fallbackId = sourceState.fallbackMessageId;
        const fallbackRow = messagesRef.current.find((m) => m.id === fallbackId);
        if (fallbackRow) {
          if (editingMessageIdsRef.current.has(fallbackId)) {
            console.log("[stt-final] editingProtected", { source, messageId: fallbackId });
          } else if (fallbackRow.patchedByUser) {
            console.log("[stt-final] editingProtected", { source, messageId: fallbackId, patchedByUser: true });
          } else if (!finalTrimmed) {
            console.log("[stt-final] suppressedWeakerFinal", { source, droppedReason: "empty_final" });
          } else if (!shouldPreferFinalOverInterim(finalTrimmed, fallbackRow.text)) {
            console.log("[stt-final] suppressedWeakerFinal", { source, droppedReason: "weaker_than_existing" });
          } else if (!areNearDuplicateTexts(finalTrimmed, fallbackRow.text) || finalTrimmed.length > fallbackRow.text.length) {
            dispatch(
              patchMessage({
                id: fallbackId,
                patchedText: finalTrimmed,
                patchedAt: Date.now(),
                patchedByUser: false,
              }),
            );
            persistAutoTranscriptUpgrade(
              fallbackId,
              sender,
              fallbackRow.originalText || fallbackRow.text,
              finalTrimmed,
              fallbackRow.timestamp,
            );
            console.log("[stt-final] updatedFallbackRow", { source, updatedFallbackRow: true, messageId: fallbackId });
          } else {
            console.log("[stt-final] suppressedWeakerFinal", { source, droppedReason: "suppressed_duplicate" });
          }
        }
      } else {
        const chosen =
          finalTrimmed && shouldPreferFinalOverInterim(finalTrimmed, interimText)
            ? finalTrimmed
            : interimText || finalTrimmed;
        if (chosen) {
          if (chosen !== finalTrimmed) {
            console.log("[stt-final] suppressedWeakerFinal", { source, droppedReason: "weaker_than_interim" });
          }
          commitTranscriptMessage(sender, chosen, sourceLabel, Date.now());
        }
      }

      sourceState.latestInterimText = "";
      sourceState.latestInterimAt = 0;
      sourceState.fallbackMessageId = null;
      sourceState.fallbackCommittedAt = null;
      sourceState.fallbackPendingSince = null;
    },
    [
      clearSttSourceTimer,
      commitTranscriptMessage,
      persistAutoTranscriptUpgrade,
      senderForSource,
      shouldPreferFinalOverInterim,
      dispatch,
    ],
  );

  const handleUserTranscript = useCallback(
    (text: string, isFinal: boolean): CommitOutcome | void => {
      const source: SttSourceKey = "mic";
      const sourceState = sttSourceStateRef.current[source];
      const normalizedText = normalizeSttTranscript(text || "");
      if (isFinal) {
        return reconcileFinalForSource(source, normalizedText);
      }
      const interim = normalizedText.trim();
      if (!interim) return;
      sourceState.latestInterimText = interim;
      sourceState.latestInterimAt = Date.now();
      scheduleFallbackCommit(source);
    },
    [reconcileFinalForSource, scheduleFallbackCommit],
  );

  const handleInterviewerTranscript = useCallback(
    (text: string, isFinal: boolean): CommitOutcome | void => {
      const source: SttSourceKey = "system";
      const sourceState = sttSourceStateRef.current[source];
      const normalizedText = normalizeSttTranscript(text || "");
      // TEMP DIAGNOSTIC (long-question split investigation, remove after):
      // raw STT event as received from Rust, before any of our own
      // commit/fallback/stabilizer logic runs. Answers "did Deepgram itself
      // emit this as two separate is_final chunks?". Dev-only, no PII beyond
      // the interview transcript text itself (no secrets/tokens/resume).
      if (import.meta.env.DEV) {
        console.log("[DIAG][stt-raw][system]", {
          isFinal,
          text: normalizedText,
          length: normalizedText.length,
          at: Date.now(),
        });
      }
      // Activity heartbeat (Layer 1). The auto-gen stabilizer is only FED from
      // committed transcript rows, which lag raw STT by scheduleFallbackCommit's
      // debounce (300ms, extendable to FALLBACK_MAX_INCOMPLETE_WAIT_MS while the
      // fragment still looks incomplete) plus Deepgram's own final latency. That
      // left the inactivity countdown running off transcript-COMMIT timing
      // rather than off actual speech: a fresh interim arriving 100ms before the
      // 3000ms window elapsed could not stop the fire, so a still-speaking
      // interviewer got answered mid-turn. Note it here — the single shared
      // interviewer entry point, covering interim AND final — before any
      // commit/fallback/completeness logic. Deliberately NOT done for mic input
      // (handleUserTranscript): candidate speech must not extend the
      // interviewer's turn. noteActivity() never mutates the generation
      // snapshot, so unstable interim text cannot leak into a question.
      if (normalizedText.trim()) {
        autoGenStabilizerRef.current?.noteActivity();
      }
      if (isFinal) {
        return reconcileFinalForSource(source, normalizedText);
      }
      const interim = normalizedText.trim();
      if (!interim) return;
      sourceState.latestInterimText = interim;
      sourceState.latestInterimAt = Date.now();
      scheduleFallbackCommit(source);
    },
    [reconcileFinalForSource, scheduleFallbackCommit],
  );

  // Keep stable refs for Tauri event listeners
  const handleInterviewerTranscriptRef = useRef(handleInterviewerTranscript);
  const handleUserTranscriptRef = useRef(handleUserTranscript);
  handleInterviewerTranscriptRef.current = handleInterviewerTranscript;
  handleUserTranscriptRef.current = handleUserTranscript;

  // ── End session ─────────────────────────────────────────────────────────────

  const endSession = useCallback(() => {
    dispatch(endSessionThunk());
  }, [dispatch]);

  // ── Credit callbacks ────────────────────────────────────────────────────────

  const handleExhausted = useCallback(() => {
    toast.error("Session ended — credits exhausted.", { duration: 6000 });
    dispatch(endSessionThunk());
  }, [dispatch]);

  const handleSessionEndedRemotely = useCallback(() => {
    toast.info(
      "This session was ended (inactive too long or ended on another device).",
      { duration: 6000 },
    );
    dispatch(endSessionThunk());
  }, [dispatch]);

  const handleCreditWarning = useCallback(
    (remaining: number) => {
      dispatch(setCreditWarning(remaining));
      toast.warning(
        `Only ${remaining} minute${remaining === 1 ? "" : "s"} of credit remaining!`,
        { duration: 8000 },
      );
    },
    [dispatch],
  );

  // ── Free session timer ──────────────────────────────────────────────────────

  const onTimeUp = useCallback(() => {
    toast.info("Free session time is up!");
    dispatch(endSessionThunk());
  }, [dispatch]);

  const { formattedTime } = useFreeSessionTimer({
    sessionId: timerParams.sessionId,
    onTimeUp,
    maxAllowedMinutes: timerParams.maxAllowedMinutes,
    startedAt: timerParams.startedAt,
  });

  // ── Heartbeat + SSE (paid sessions) ────────────────────────────────────────

  useSessionHeartbeat({
    sessionId: heartbeatParams.sessionId,
    enabled: heartbeatParams.enabled,
    startedAt: heartbeatParams.startedAt,
    onExhausted: handleExhausted,
    onWarning: handleCreditWarning,
    onSessionEnded: handleSessionEndedRemotely,
  });

  // Retired dead SSE ("/events") channel — see the identical note in
  // pages/Sessions/ActiveSession/page.tsx. useSessionHeartbeat above already
  // covers the full exhaustion/warning/remote-end contract.

  // ── System audio (Rust STT) ─────────────────────────────────────────────────

  const logMacPermission = useCallback((event: string, payload?: unknown) => {
    if (!import.meta.env.DEV) return;
    console.warn(`[audio-lifecycle] ${event}`, payload ?? {});
  }, []);

  const getMacIdentity = useCallback(async (): Promise<MacAppIdentity | null> => {
    try {
      const identity = await invoke<MacAppIdentity>("get_macos_app_identity");
      setPermissionIdentity(identity);
      logMacPermission("macAppIdentity", identity);
      return identity;
    } catch {
      return null;
    }
  }, [logMacPermission]);

  const preflightSystemPermission = useCallback(async (isRetry = false): Promise<boolean> => {
    if (isRetry) logMacPermission("permissionRetryClicked", { permissionType: "screen-recording" });
    logMacPermission("macPermissionCheckStarted", { permissionType: "screen-recording" });
    const [identity, check] = await Promise.all([
      getMacIdentity(),
      invoke<MacPermissionPayload>("check_screen_recording_permission"),
    ]);
    logMacPermission("screenRecordingPermissionStatus", check);
    if (check.status === "granted") {
      logMacPermission("permissionRecheckPassed", { permissionType: "screen-recording" });
      setTabErrorPermissionType(null);
      setPermissionRequiresRestart(false);
      return true;
    }
    const requested = await invoke<MacPermissionPayload>("request_screen_recording_permission");
    logMacPermission("screenRecordingPermissionStatus", { requested });
    if (requested.status === "granted") {
      logMacPermission("permissionRecheckPassed", { permissionType: "screen-recording" });
      setTabErrorPermissionType(null);
      setPermissionRequiresRestart(false);
      return true;
    }
    const restartRequired = requested.status === "restart_required";
    setPermissionRequiresRestart(restartRequired);
    setTabErrorPermissionType("screen-recording");
    const detail = identity
      ? ` [bundleIdentifier=${identity.bundleIdentifier}, executablePath=${identity.executablePath}]`
      : "";
    setTabError(
      restartRequired
        ? `Screen Recording permission requires app restart after enabling.${detail}`
        : `Screen Recording permission denied. Open Settings and retry.${detail}`,
    );
    logMacPermission("permissionDeniedReason", { permissionType: "screen-recording", restartRequired });
    logMacPermission("permissionRecheckFailed", { permissionType: "screen-recording", restartRequired });
    return false;
  }, [getMacIdentity, logMacPermission]);

  const preflightMicPermission = useCallback(async (isRetry = false): Promise<boolean> => {
    if (isRetry) logMacPermission("permissionRetryClicked", { permissionType: "microphone" });
    logMacPermission("macPermissionCheckStarted", { permissionType: "microphone" });
    const [identity, check] = await Promise.all([
      getMacIdentity(),
      invoke<MacPermissionPayload>("check_microphone_permission"),
    ]);
    logMacPermission("micPermissionStatus", check);
    if (check.status === "granted") {
      logMacPermission("permissionRecheckPassed", { permissionType: "microphone" });
      setTabErrorPermissionType(null);
      return true;
    }
    const requested = await invoke<MacPermissionPayload>("request_microphone_permission");
    logMacPermission("micPermissionStatus", { requested });
    if (requested.status === "granted") {
      logMacPermission("permissionRecheckPassed", { permissionType: "microphone" });
      setTabErrorPermissionType(null);
      return true;
    }
    setTabErrorPermissionType("microphone");
    const detail = identity
      ? ` [bundleIdentifier=${identity.bundleIdentifier}, executablePath=${identity.executablePath}]`
      : "";
    const msg = `Microphone permission denied. Open Settings and retry.${detail}`;
    setTabError(msg);
    logMacPermission("permissionDeniedReason", { permissionType: "microphone" });
    logMacPermission("permissionRecheckFailed", { permissionType: "microphone" });
    return false;
  }, [getMacIdentity, logMacPermission]);

  const buildDeepgramKeyterms = useCallback((): string[] => {
    const info = sessionInfoRef.current;
    const transcriptHints = messagesRef.current
      .slice(-24)
      .map((m) => m.text)
      .join(" ");

    return extractInterviewKeywordsFromParts([
      info?.companyName,
      info?.language,
      transcriptHints,
    ]);
  }, []);

  const startSystemAudio = useCallback(async () => {
    if (!sessionInfoRef.current) return;
    if (systemStartInFlightRef.current) return;
    systemStartInFlightRef.current = true;
    const lang = getLanguageCode(sessionInfoRef.current.language ?? "English");
    const keyterms = buildDeepgramKeyterms();
    try {
      setTabError(null);
      setTabErrorPermissionType(null);
      setPermissionRequiresRestart(false);
      const allowed = await preflightSystemPermission(false);
      if (!allowed) {
        setTabStatus("error");
        return;
      }
      setIsSystemStale(false);
      setTabStatus("connecting");
      audioControllerRef.current.startAudioSession("system", "start_system_audio");
      try {
        const dgKey = await resolveDeepgramKey();
        await invoke("start_system_audio_transcription", {
          language: lang,
          model: "nova-3",
          keyterms,
          apiKey: dgKey,
        });
      } catch (e: unknown) {
        const msg = String(e);
        setTabError(msg);
        setTabStatus("error");
      }
    } finally {
      systemStartInFlightRef.current = false;
    }
  }, [buildDeepgramKeyterms, preflightSystemPermission]);

  const retrySystemAudio = useCallback(async () => {
    if (!sessionInfoRef.current) return;
    if (systemStartInFlightRef.current) return;
    if (isDeepgramAuthFailureMessage(tabError)) {
      setTabStatus("error");
      return;
    }
    setTabError(null);
    setTabErrorPermissionType(null);
    setIsSystemStale(false);
    setTabStatus("connecting");
    const allowed = await preflightSystemPermission(true);
    if (!allowed) {
      setTabStatus("error");
      return;
    }
    try {
      await audioControllerRef.current.stopAudioSession("system", "manual_retry_system_audio");
    } catch {
      // best effort stop; continue with fresh start attempt
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await startSystemAudio();
  }, [preflightSystemPermission, startSystemAudio, tabError]);

  const reacquireSystemAudio = useCallback(async (reason: string) => {
    if (systemReacquireInFlightRef.current) return;
    const now = Date.now();
    const health = systemHealthRef.current;
    if (health.lastHealthyAt && now - health.lastHealthyAt >= SYSTEM_RESTART_BUDGET_RESET_MS) {
      health.systemRestartCount = 0;
      health.systemRestartWindowStartAt = now;
    }
    if (!health.systemRestartWindowStartAt || now - health.systemRestartWindowStartAt > SYSTEM_RESTART_WINDOW_MS) {
      health.systemRestartWindowStartAt = now;
      health.systemRestartCount = 0;
    }
    if (health.systemRestartCount >= SYSTEM_RESTART_MAX_PER_WINDOW) {
      if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] systemRestartRateLimited", {
          stopReason: reason,
          restartCount: health.systemRestartCount,
          sessionActive: !!sessionInfoRef.current?.sessionId,
        });
      }
      setTabStatus("error");
      setTabError("System audio restart limit reached. Check Screen Recording/audio device and retry.");
      setIsSystemStale(true);
      return;
    }

    systemReacquireInFlightRef.current = true;
    health.systemRestartCount += 1;
    health.lastSystemRestartAt = now;
    setIsSystemStale(true);
    setTabStatus("connecting");
    if (import.meta.env.DEV) {
      console.log("[audio-lifecycle] systemStaleReacquireStart", {
        stopReason: reason,
        restartCount: health.systemRestartCount,
        sessionActive: !!sessionInfoRef.current?.sessionId,
      });
    }
    try {
      await audioControllerRef.current.stopAudioSession("system", "system_stale_reacquire");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await startSystemAudio();
      if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] systemStaleReacquireSuccess", {
          stopReason: reason,
          sessionActive: !!sessionInfoRef.current?.sessionId,
        });
      }
    } catch (err) {
      const msg = String(err);
      setTabStatus("error");
      setTabError(msg);
      if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] systemStaleReacquireFailed", {
          stopReason: reason,
          sessionActive: !!sessionInfoRef.current?.sessionId,
          error: msg,
        });
      }
    } finally {
      systemReacquireInFlightRef.current = false;
    }
  }, [startSystemAudio]);

  // System audio transcript + status listeners (unconditional — wires up once)
  //
  // StrictMode-safe registration: listen() is async, and dev-mode
  // double-invoke (mount → cleanup → mount again) can run this effect's
  // cleanup BEFORE the first listen() promise resolves. attachCancellableListener
  // guards that race — if cleanup already ran by the time registration
  // resolves, the just-registered listener is unlistened immediately instead
  // of leaking (which previously caused duplicate STT event delivery in dev).
  useEffect(() => {
    console.log("[Tauri][WindowLifecycle] stt system listeners register count=3");

    const txListener = attachCancellableListener(
      listen<{ text: string; is_final: boolean }>("stt:system-audio", (event) => {
      const { text, is_final } = event.payload;
      const normalizedText = normalizeSttTranscript(text || "");
      const now = Date.now();
      const health = systemHealthRef.current;
      health.lastSystemEventAt = now;
      if (is_final) {
        health.lastSystemFinalAt = now;
        const trimmed = normalizedText.trim();
        if (!trimmed) {
          if (!health.emptyFinalWindowStartAt || now - health.emptyFinalWindowStartAt > SYSTEM_EMPTY_FINAL_STORM_WINDOW_MS) {
            health.emptyFinalWindowStartAt = now;
            health.emptyFinalStreak = 0;
          }
          health.emptyFinalStreak += 1;
          const threshold = EMPTY_FINAL_LOG_THRESHOLDS.find((t) => health.emptyFinalStreak >= t);
          if (import.meta.env.DEV && threshold && threshold > lastLoggedEmptyFinalThresholdRef.current) {
            lastLoggedEmptyFinalThresholdRef.current = threshold;
            console.log("[audio-lifecycle] systemEmptyFinalStreak", {
              emptyFinalStreak: health.emptyFinalStreak,
              threshold,
            });
          }
        } else {
          health.lastMeaningfulSystemTranscriptAt = now;
          health.emptyFinalStreak = 0;
          health.emptyFinalWindowStartAt = 0;
          lastLoggedEmptyFinalThresholdRef.current = 0;
          health.lastHealthyAt = now;
          health.isSystemSilent = false;
          setIsSystemStale(false);
        }
      } else {
        health.lastSystemInterimAt = now;
        if (normalizedText.trim().length > 0) {
          health.lastMeaningfulSystemTranscriptAt = now;
          health.emptyFinalStreak = 0;
          health.emptyFinalWindowStartAt = 0;
          lastLoggedEmptyFinalThresholdRef.current = 0;
          health.lastHealthyAt = now;
          health.isSystemSilent = false;
          setIsSystemStale(false);
        }
      }
      if (is_final) {
        setTabInterimTranscript("");
        handleInterviewerTranscriptRef.current(normalizedText, true);
      } else {
        setTabInterimTranscript(normalizedText);
        handleInterviewerTranscriptRef.current(normalizedText, false);
      }
      }),
      (fn) => fn(),
    );

    const stListener = attachCancellableListener(
      listen<{ status: string; error?: string }>("stt:status:system", (event) => {
      const { status, error } = event.payload;
      if (import.meta.env.DEV) {
        if (status === "connecting" && previousSystemPhaseRef.current === "idle") {
          logSystemTransition("idle", "connecting");
          previousSystemPhaseRef.current = "connecting";
        } else if (status === "transcribing" && previousSystemPhaseRef.current === "connecting") {
          logSystemTransition("connecting", "transcribing");
          previousSystemPhaseRef.current = "transcribing";
        } else if (status === "error") {
          logSystemTransition(previousSystemPhaseRef.current, "error");
          previousSystemPhaseRef.current = "error";
        }
      }
      setTabStatus(status as "idle" | "connecting" | "transcribing" | "error");
       if (status === "transcribing") {
        const now = Date.now();
        const health = systemHealthRef.current;
        health.lastDeepgramRunningAt = now;
        health.lastHealthyAt = now;
        setIsSystemStale(false);
      }
      if (status === "error" && error) {
        setTabError(error);
        if (isDeepgramAuthFailureMessage(error)) {
          // Explicit auth failures are non-retryable until the key changes.
          setPermissionRequiresRestart(false);
          setTabErrorPermissionType(null);
        }
      } else if (status === "transcribing") {
        setTabError(null);
      }
      }),
      (fn) => fn(),
    );

    const healthListener = attachCancellableListener(
      listen<SystemHealthPayload>("stt:health:system", (event) => {
      const now = Date.now();
      const payload = event.payload;
      const health = systemHealthRef.current;
      health.lastHeartbeatAt = now;
      health.captureRunning = !!payload.captureRunning;
      health.deepgramRunning = !!payload.deepgramRunning;
      health.lastPcmAt = Number(payload.lastPcmAt) || 0;
      health.lastPcmFramesSent = Number(payload.pcmFramesSent) || 0;
      health.healthState = payload.state;
      if (health.deepgramRunning) {
        health.lastDeepgramRunningAt = now;
      }
      if (payload.state === "capturing" || payload.state === "connected") {
        health.lastHealthyAt = now;
      }
      if (import.meta.env.DEV) {
        const stateChanged = previousHealthStateRef.current !== health.healthState;
        const captureChanged = previousCaptureRunningRef.current !== health.captureRunning;
        const deepgramChanged = previousDeepgramRunningRef.current !== health.deepgramRunning;
        if (stateChanged || captureChanged || deepgramChanged) {
          if (health.healthState === "error") {
            logSystemTransition(previousSystemPhaseRef.current, "error");
            previousSystemPhaseRef.current = "error";
          }
          previousHealthStateRef.current = health.healthState;
          previousCaptureRunningRef.current = health.captureRunning;
          previousDeepgramRunningRef.current = health.deepgramRunning;
        }
      }
      logSystemHealthSummary(health.healthState, previousIsSystemStaleRef.current);
      }),
      (fn) => fn(),
    );

    return () => {
      txListener.cancel();
      stListener.cancel();
      healthListener.cancel();
      console.log("[Tauri][WindowLifecycle] stt system listeners unregister count=3");
    };
  }, []);

  // Arm → start system audio (only on live session-init, not sessionStorage hydration)
  // Important: do NOT auto-stop system audio in cleanup here.
  // React remount/strict-mode cleanup can race and immediately release system
  // capture right after startup. Full teardown belongs to terminal session
  // lifecycle (set_session_active false / end-session destroy).
  useEffect(() => {
    const sessionId = sessionInfo?.sessionId;
    if (!captureArmed || !sessionId) return;
    if (systemStartIssuedForSessionRef.current === sessionId) return;
    systemStartIssuedForSessionRef.current = sessionId;
    void startSystemAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureArmed, sessionInfo?.sessionId]);

  // Reset per-session start marker when the session is gone so a future
  // session can auto-arm and start system capture again.
  useEffect(() => {
    if (!sessionInfo?.sessionId) {
      systemStartIssuedForSessionRef.current = null;
      systemHealthRef.current = {
        lastSystemInterimAt: 0,
        lastSystemFinalAt: 0,
        lastMeaningfulSystemTranscriptAt: 0,
        lastSystemEventAt: 0,
        emptyFinalStreak: 0,
        emptyFinalWindowStartAt: 0,
        systemRestartCount: 0,
        systemRestartWindowStartAt: 0,
        lastSystemRestartAt: 0,
        lastHealthyAt: 0,
        lastPcmAt: 0,
        lastPcmFramesSent: 0,
        lastDeepgramRunningAt: 0,
        lastHeartbeatAt: 0,
        captureRunning: false,
        deepgramRunning: false,
        healthState: "idle",
        isSystemSilent: false,
      };
      lastLoggedHealthAtRef.current = 0;
      lastLoggedEmptyFinalThresholdRef.current = 0;
      previousHealthStateRef.current = "idle";
      previousCaptureRunningRef.current = false;
      previousDeepgramRunningRef.current = false;
      previousIsSystemStaleRef.current = false;
      previousSystemPhaseRef.current = "idle";
      lastPcmFramesCheckedRef.current = 0;
      setIsSystemStale(false);
    }
  }, [sessionInfo?.sessionId]);

  // Health monitor: classify silent vs stale and do controlled system-only reacquire.
  useEffect(() => {
    if (systemHealthIntervalRef.current) {
      clearInterval(systemHealthIntervalRef.current);
      systemHealthIntervalRef.current = null;
    }

    if (!captureArmed || !sessionInfo?.sessionId) return;

    systemHealthIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const health = systemHealthRef.current;
      const sessionActive = !!sessionInfoRef.current?.sessionId && captureArmedRef.current;
      if (!sessionActive || tabStatus === "error") return;
      if (isDeepgramAuthFailureMessage(tabError)) return;

      if (health.lastHealthyAt && now - health.lastHealthyAt >= SYSTEM_RESTART_BUDGET_RESET_MS) {
        health.systemRestartCount = 0;
        health.systemRestartWindowStartAt = now;
      }

      const pcmIncreasing = health.lastPcmFramesSent > lastPcmFramesCheckedRef.current;
      const pcmRecent = health.lastPcmAt > 0 && now - health.lastPcmAt <= SYSTEM_NO_EVENTS_STALE_MS;
      lastPcmFramesCheckedRef.current = health.lastPcmFramesSent;
      const meaningfulRecent = health.lastMeaningfulSystemTranscriptAt > 0
        && now - health.lastMeaningfulSystemTranscriptAt <= SYSTEM_NO_MEANINGFUL_STALE_MS;
      const inEmptyStormWindow =
        health.emptyFinalWindowStartAt > 0 && now - health.emptyFinalWindowStartAt <= SYSTEM_EMPTY_FINAL_STORM_WINDOW_MS;
      const emptyFinalStorm = inEmptyStormWindow && health.emptyFinalStreak >= SYSTEM_EMPTY_FINAL_STORM_COUNT;

      // A fresh 1 s heartbeat is positive proof capture + Deepgram are alive, so
      // silence never tears down the socket; reconnect only on confirmed
      // transport/capture failure (see classifySystemHealth).
      const decision = classifySystemHealth(
        {
          hadHeartbeat: health.lastHeartbeatAt > 0,
          msSinceHeartbeat: health.lastHeartbeatAt > 0 ? now - health.lastHeartbeatAt : 0,
          captureRunning: health.captureRunning,
          deepgramRunning: health.deepgramRunning,
          healthState: health.healthState,
          pcmRecent,
          pcmIncreasing,
          meaningfulRecent,
          deepgramStallWithActivePcm: emptyFinalStorm && pcmIncreasing,
        },
        { heartbeatStaleMs: SYSTEM_HEARTBEAT_STALE_MS },
      );
      const stale = decision.class === "reconnect";
      health.isSystemSilent = decision.class === "silent";

      logSystemHealthSummary(health.healthState, stale);

      if (import.meta.env.DEV && stale !== previousIsSystemStaleRef.current) {
        if (stale) {
          logSystemTransition("transcribing", "stale");
          previousSystemPhaseRef.current = "stale";
        } else if (previousSystemPhaseRef.current === "reconnecting" || previousSystemPhaseRef.current === "stale") {
          logSystemTransition(previousSystemPhaseRef.current, "live");
          previousSystemPhaseRef.current = "transcribing";
        }
      }
      previousIsSystemStaleRef.current = stale;

      if (!stale) {
        setIsSystemStale(false);
        return;
      }
      setIsSystemStale(true);
      // Privacy-safe diagnostic: reconnect reason + PCM counters only (no audio,
      // no transcript text, no secrets). Emitted in prod too so live WASAPI/
      // ScreenCaptureKit failures are diagnosable from logs we cannot reproduce.
      console.warn("[audio-lifecycle] systemReconnect", {
        reason: decision.reason,
        healthState: health.healthState,
        captureRunning: health.captureRunning,
        deepgramRunning: health.deepgramRunning,
        pcmFramesSent: health.lastPcmFramesSent,
        msSinceHeartbeat: health.lastHeartbeatAt > 0 ? now - health.lastHeartbeatAt : -1,
        msSincePcm: health.lastPcmAt > 0 ? now - health.lastPcmAt : -1,
      });
      if (import.meta.env.DEV) {
        logSystemTransition("stale", "reconnecting");
        previousSystemPhaseRef.current = "reconnecting";
      }
      void reacquireSystemAudio(`system_reacquire_${decision.reason}`);
    }, 2000);

    return () => {
      if (systemHealthIntervalRef.current) {
        clearInterval(systemHealthIntervalRef.current);
        systemHealthIntervalRef.current = null;
      }
    };
  }, [captureArmed, sessionInfo?.sessionId, tabStatus, tabError, reacquireSystemAudio]);

  // Mic STT listeners
  //
  // StrictMode-safe registration — see the system-audio effect above for why
  // attachCancellableListener is needed here (dev-mode double-invoke can run
  // cleanup before listen() resolves, leaking an orphaned listener).
  useEffect(() => {
    const txListener = attachCancellableListener(
      listen<{ text: string; is_final: boolean }>("stt:mic", (event) => {
        const { text, is_final } = event.payload;
        const normalizedText = normalizeSttTranscript(text || "");
        if (is_final) {
          setMicInterimTranscript("");
          handleUserTranscriptRef.current(normalizedText, true);
        } else {
          setMicInterimTranscript(normalizedText);
          handleUserTranscriptRef.current(normalizedText, false);
        }
      }),
      (fn) => fn(),
    );

    const stListener = attachCancellableListener(
      listen<{ status: string; error?: string }>("stt:status:mic", (event) => {
        const { status, error } = event.payload;
        if (status === "transcribing") {
          setIsMicActive(true);
          setIsMicConnecting(false);
        } else if (status === "connecting") {
          setIsMicConnecting(true);
        } else {
          setIsMicActive(false);
          setIsMicConnecting(false);
        }
        if (status === "error" && error) {
          toast.error(`Mic: ${error}`, { duration: 6000 });
        }
      }),
      (fn) => fn(),
    );

    return () => {
      txListener.cancel();
      stListener.cancel();
    };
  }, []);

  // ── sessionStorage hydration — HMR / page-reload recovery ─────────────────
  // The floating window reuses the same WebView across sessions (it is never
  // destroyed, only hidden). On a Vite HMR reload React fully remounts, wiping
  // all in-memory state. The session-init Tauri event is one-shot and will
  // NOT be re-emitted. Read the payload we persisted on the last live event
  // and restore Redux so the UI continues from where it was.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("hireshade.session-init");
      if (!raw) return;
      const info: SessionInitData = JSON.parse(raw);
      if (!info?.sessionId) return;

      console.log("[useFloatingSession] HMR/reload detected — restoring session from sessionStorage:", info.sessionId);

      // Restore Redux session state (model, sessionId, etc.).
      // messages are not persisted — they are ephemeral transcript entries.
      dispatch(initSession(info));

      // Tell Rust the session is still active (guards private mode lock etc.)
      invoke("set_session_active", { active: true }).catch(() => {});

      // Re-arm system audio: HMR cleanup tore down the audio pipeline,
      // so we need it to restart. captureArmed → true triggers the
      // "Arm → start system audio" effect below.
      setCaptureArmed(true);
    } catch {
      // Corrupt or missing sessionStorage entry — start fresh.
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── session-init Tauri event ────────────────────────────────────────────────

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<SessionInitData>("session-init", (event) => {
      const info = event.payload;
      try {
        sessionStorage.setItem("hireshade.session-init", JSON.stringify(info));
      } catch {}

      // Dismiss lingering toasts from prior session (e.g. "Session ended")
      toast.dismiss();

      // Reset all prior-session AI chat state and deduplication history
      setAiChat([]);
      answeredQuestionsHistoryRef.current = [];
      lastAnswerTimestampRef.current = null;

      // Hydrate Redux slice (resets messages, panels, warnings, isEnding)
      dispatch(initSession(info));

      invoke("set_session_active", { active: true }).catch(() => {});
      setCaptureArmed(true);

      // Ack so the sender can stop retrying. Idempotent — safe to ack
      // multiple times if multiple session-init payloads arrive.
      emit("session-init-ack").catch(() => {});
    })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);

    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  // ── overlay-transcript event (from main window / page.tsx) ─────────────────

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<{ sender: "User" | "Interviewer"; text: string; timestamp: number }>(
      "overlay-transcript",
      (event) => {
        // Mini window already receives direct STT events; ignore relay events
        // while a live floating session is active to prevent double appends.
        if (sessionInfoRef.current?.sessionId) return;
        const { sender, text, timestamp } = event.payload;
        if (!text.trim()) return;
        if (isDupeMessage(sender, text, timestamp)) return;
        dispatch(
          addMessage({
            id: Math.random().toString(36).slice(7),
            sender,
            text,
            timestamp,
          }),
        );
      },
    )
      .then((fn) => { unlisten = fn; })
      .catch(console.error);

    return () => { unlisten?.(); };
  }, [dispatch, isDupeMessage]);

  // ── Auto-expand responses panel ─────────────────────────────────────────────
  // TODO(follow-up): rendered component coverage for the responses panel
  // scroll behavior — pending jsdom/@testing-library approval. Decision logic
  // is unit-tested in autoScrollPolicy.test.ts; the panel rendering wiring in
  // FloatingApp remains manually verified only.

  // Track the previous count so we can detect newly appended responses.
  // Auto-scroll follows the newest card; when disabled, manual browsing is
  // preserved unless the user was already viewing the latest response.
  // (Decision logic lives in autoScrollPolicy for unit-testability.)
  const prevResponsesLenRef = useRef(0);
  const wasGeneratingResponseRef = useRef(false);

  useEffect(() => {
    const prev = prevResponsesLenRef.current;
    const curr = aiResponses.length;

    const decision = decideAutoScrollOnAppend({
      prevLen: prev,
      currLen: curr,
      currentIndex: currentResponseIndex,
      autoScroll,
    });
    if (decision.type === "first-arrived") {
      dispatch(setCurrentResponseIndex(0));
      dispatch(setIsResponsesExpanded(true));
    } else if (decision.type === "advance") {
      dispatch(setCurrentResponseIndex(decision.index));
    }

    prevResponsesLenRef.current = curr;
  }, [aiResponses.length, autoScroll, currentResponseIndex, dispatch]);

  // Auto-expand the responses panel the moment the user triggers a generation
  // (AI Answer or Analyze Screen) so the "Generating response…" loader is
  // visible immediately.
  useEffect(() => {
    if (isAnswering || isAnalyzing) {
      dispatch(setIsResponsesExpanded(true));
    }
  }, [isAnswering, isAnalyzing, dispatch]);

  useEffect(() => {
    const isGenerating = isAnswering || isAnalyzing;
    const justFinishedGenerating =
      wasGeneratingResponseRef.current && !isGenerating;

    if (
      justFinishedGenerating &&
      aiResponses.length > 0 &&
      !isTranscriptExpanded
    ) {
      dispatch(setCurrentResponseIndex(aiResponses.length - 1));
      dispatch(setIsResponsesExpanded(true));
    }

    wasGeneratingResponseRef.current = isGenerating;
  }, [
    aiResponses.length,
    dispatch,
    isAnalyzing,
    isAnswering,
    isTranscriptExpanded,
  ]);

  // ── AI action handlers ──────────────────────────────────────────────────────

  const handleAiAnswerClick = useCallback(async (
    origin: "overlay_click" | "manual_click" | "auto" = "overlay_click",
    // Mini-Phase B: only ever passed for origin === "auto" — the exact
    // stabilized/classified text (or individual segment) that caused
    // autoGenFireRef to fire. See resolveEffectiveLiveInterimText below for
    // the invariant this enforces. Manual origins never pass this and are
    // byte-for-byte unaffected.
    stabilizedQuestion?: string,
  ) => {
    console.log("[AI Answer][Click] received", {
      clickSource: "button",
      isDuplicateSuppressed: false,
      requestId: null,
      hasSession: !!sessionInfoRef.current?.sessionId,
      isRefLocked: isAiAnswerRunningRef.current,
      isEmitting: isEmittingRef.current,
      isAnswering,
    });
    // TEMP DIAGNOSTIC (long-question split investigation, remove after):
    // marks the start of EVERY handleAiAnswerClick invocation with its
    // origin, so multiple calls (e.g. from the multi-segment stagger) can be
    // correlated against [DIAG][autogen-fire-start] by timestamp. Dev-only.
    if (import.meta.env.DEV) {
      console.log("[DIAG][handle-ai-answer-click-start]", {
        origin,
        isAiAnswerRunning: isAiAnswerRunningRef.current,
        isEmitting: isEmittingRef.current,
        at: Date.now(),
      });
    }

    // Mini-Phase B invariant: for origin === "auto", never fall back to live
    // interim text (tabInterimTranscript) — that fallback is exactly the
    // race condition being fixed (a newer, still-forming interim fragment
    // winning over the stabilized snapshot that actually triggered this
    // call). Computed once, up front, before any state/lock is touched, so
    // an invariant violation is a true no-op bail-out.
    const effectiveLiveInterimText = resolveEffectiveLiveInterimText(
      origin,
      stabilizedQuestion,
      tabInterimTranscript,
    );
    if (effectiveLiveInterimText === null) {
      if (import.meta.env.DEV) {
        console.warn("[DIAG][auto-invariant-violation]", {
          origin,
          stabilizedQuestion,
          reason:
            "origin===\"auto\" but stabilizedQuestion was missing/empty — skipping generation instead of falling back to live interim text",
          at: Date.now(),
        });
      }
      return;
    }

    // Validation: Ensure a valid model is selected
    const currentModel = selectedModelRef.current;
    if (!isValidModel(currentModel)) {
      console.error("[useFloatingSession] Invalid model selected:", currentModel);
      toast.error("Please select a valid AI model before continuing");
      dispatch(setSelectedModel(getValidModel(currentModel)));
      return;
    }

    if (isAiAnswerRunningRef.current || isEmittingRef.current || isAnswering || isAiAnswerUiLocked) {
      console.log("[AI Answer][Dedup] duplicate click ignored", {
        clickSource: "button",
        isDuplicateSuppressed: true,
        requestId: null,
        reason: isAiAnswerRunningRef.current
          ? "ref_locked"
          : isEmittingRef.current
            ? "emitting"
            : isAiAnswerUiLocked
              ? "ui_locked"
              : "isAnswering_state",
      });
      return;
    }
    const info = sessionInfoRef.current;
    if (!info) {
      console.log("[useFloatingSession] handleAiAnswerClick: Suppressed click (no sessionInfo available).");
      return;
    }
    const opRequestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const opAcquire = operationRegistryRef.current.acquire(
      info.sessionId,
      "ai-answer",
      opRequestId,
    );
    if (!opAcquire.acquired) {
      console.log("[AI Answer][Dedup] duplicate ai-answer ignored (operation registry)", {
        clickSource: "button",
        isDuplicateSuppressed: true,
        sessionId: info.sessionId,
        requestId: opRequestId,
      });
      return;
    }
    isEmittingRef.current = true;
    isAiAnswerRunningRef.current = true;
    setIsAiAnswerUiLocked(true);
    transitionGuardRef.current.transition("processing", "ai_answer_click", info.sessionId);
    transitionGuardRef.current.transition("answering", "ai_answer_dispatch", info.sessionId);
    try {

    const contextBuildStartedAt = Date.now();
    // 1) Build immediate snapshot (zero wait). Normalizing once here covers all
    //    detectActiveQuestion and resolveQuestionFromContext calls below.
    const { forDetection: normalizedForDetection, forResolution: normalizedForResolution } = getOrBuildNormalizedMsgs();
    const preDebounceDetection = detectActiveQuestion({
      liveInterimText: effectiveLiveInterimText,
      allMessages: normalizedForDetection,
      cutoffTimestamp:
        lastAnswerTimestampRef.current !== null
          ? Math.min(lastAnswerTimestampRef.current, Date.now() - 5000)
          : Date.now() - FIRST_ANSWER_WINDOW_MS,
      selectedAnswerQuestion: "",
      answeredQuestionKeys: answeredQuestionsHistoryRef.current.map((a) => a.text),
    });
    const evolving = false;

    // 2) Freeze immutable snapshot used for this request only.
    const snapshotTimestamp = Date.now();
    const msgsSnapshot = [...messagesRef.current];
    const liveInterviewerTextSnapshot = effectiveLiveInterimText;

    console.log("[useFloatingSession] Creating transcript snapshot at timestamp:", snapshotTimestamp);
    console.log("[useFloatingSession] Snapshot contains", msgsSnapshot.length, "messages");


    const cutoff =
      lastAnswerTimestampRef.current !== null
        ? Math.min(lastAnswerTimestampRef.current, Date.now() - 5000)
        : Date.now() - FIRST_ANSWER_WINDOW_MS;
    const detection = detectActiveQuestion({
      liveInterimText: liveInterviewerTextSnapshot,
      allMessages: normalizedForDetection,
      cutoffTimestamp: cutoff,
      selectedAnswerQuestion: "",
      answeredQuestionKeys: answeredQuestionsHistoryRef.current.map((a) => a.text),
    });

    // TEMP DIAGNOSTIC (long-question split investigation, remove after):
    // exactly what THIS invocation of handleAiAnswerClick resolved as the
    // active question, and what was already in answeredQuestionKeys at that
    // moment. Answers "why did the card receive only the trailing clause?"
    // and "was the first clause already marked answered before the second
    // call ran?". Dev-only.
    if (import.meta.env.DEV) {
      console.log("[DIAG][detect-active-question]", {
        origin,
        resolvedQuestion: detection.cleanedQuestion,
        source: detection.source,
        confidenceScore: detection.confidenceScore,
        ignoredNoise: detection.ignoredNoise,
        answeredQuestionKeysAtCallTime: answeredQuestionsHistoryRef.current.map((a) => a.text),
        at: Date.now(),
      });
    }

    let question = detection.cleanedQuestion.trim();
    const source = detection.source;
    let effectiveDetection = detection;
    // Invoked by explicit user actions (overlay AI Answer button, Cmd/Ctrl+G
    // shortcut) and by the auto-generation path (which passes origin="auto").
    // Always-answer contract: a deliberate click must
    // produce an answer even while the transcript is still evolving. Rapid
    // double-clicks are already debounced by `isAnswering` in FloatingApp and
    // the backend in-flight (409) lock, so we never silently drop a click.
    let forcedByExplicitClick = true;
    const stableQuestionHash =
      preDebounceDetection.cleanedQuestion.trim().toLowerCase() ===
      question.toLowerCase();
    const confidenceDelta = Math.abs(
      (preDebounceDetection.confidenceScore || 0) - (detection.confidenceScore || 0),
    );
    const semanticallyStable = stableQuestionHash && confidenceDelta <= 0.2;
    const failedConfidenceGate =
      !question ||
      detection.ignoredNoise ||
      detection.confidenceScore < ACTIVE_QUESTION_CONFIDENCE_THRESHOLD;

    if (failedConfidenceGate) {
      const interviewerPreferredQuestion = [
        detection.source === "transcript_history"
          ? detection.cleanedQuestion.trim()
          : "",
        preDebounceDetection.source === "transcript_history"
          ? preDebounceDetection.cleanedQuestion.trim()
          : "",
      ].find((candidate) => candidate && !isFillerPhrase(candidate));
      const fallbackResolved = resolveQuestionFromContext(
        liveInterviewerTextSnapshot,
        normalizedForResolution,
        lastMessage,
        lastAnswerTimestampRef.current,
      );
      const fallbackQuestion = (
        interviewerPreferredQuestion ||
        fallbackResolved?.question?.trim() ||
        preDebounceDetection.cleanedQuestion.trim() ||
        question
      ).trim();

      if (fallbackQuestion && !isFillerPhrase(fallbackQuestion)) {
        forcedByExplicitClick = true;
        question = fallbackQuestion;
        effectiveDetection = {
          ...detection,
          activeQuestion: fallbackQuestion,
          cleanedQuestion: fallbackQuestion,
          confidenceScore: Math.max(
            detection.confidenceScore || 0,
            ACTIVE_QUESTION_CONFIDENCE_THRESHOLD,
          ),
          ignoredNoise: false,
        };
        console.log("[AI Answer][Click] low-confidence detection recovered via explicit-click fallback", {
          fallbackSource: fallbackResolved?.source || "pre_debounce",
          confidence: effectiveDetection.confidenceScore,
        });
	      } else {
	        const transcriptFallback = msgsSnapshot
	          .filter((m) => (m.sender === "Interviewer" || m.sender === "User") && !!m.text?.trim())
	          .slice(-20)
	          .map((m) => m.text.trim())
	          .join(" ");
	        question = transcriptFallback || liveInterviewerTextSnapshot || "";
	        forcedByExplicitClick = true;
	        effectiveDetection = {
	          ...detection,
	          activeQuestion: question,
	          cleanedQuestion: question,
	          confidenceScore: Math.max(detection.confidenceScore || 0, 0.2),
	          ignoredNoise: false,
	        };
	        console.log("[useFloatingSession] handleAiAnswerClick: No confident active question; sending transcript to backend composer.", {
	          evolving,
	          semanticallyStable,
	          snapshotTimestamp,
	        });
	      }
	    }

    const preNormalizedQuestion = normalizeTranscriptText(
      preDebounceDetection.cleanedQuestion || "",
    );
    const postNormalizedQuestion = normalizeTranscriptText(
      effectiveDetection.cleanedQuestion || question,
    );
    const preTokens = new Set(
      preNormalizedQuestion.split(" ").map((t) => t.trim()).filter(Boolean),
    );
    const postTokens = new Set(
      postNormalizedQuestion.split(" ").map((t) => t.trim()).filter(Boolean),
    );
    const overlapCount = [...postTokens].filter((t) => preTokens.has(t)).length;
    const overlapRatio = postTokens.size > 0 ? overlapCount / postTokens.size : 0;
    const minorQuestionEvolution =
      (preNormalizedQuestion &&
        postNormalizedQuestion &&
        (preNormalizedQuestion.includes(postNormalizedQuestion) ||
          postNormalizedQuestion.includes(preNormalizedQuestion))) ||
      overlapRatio >= 0.72;
    const shouldAllowEvolvingFollowup =
      minorQuestionEvolution &&
      effectiveDetection.confidenceScore >= ACTIVE_QUESTION_CONFIDENCE_THRESHOLD;

    if (
      evolving &&
      !semanticallyStable &&
      !forcedByExplicitClick &&
      !shouldAllowEvolvingFollowup
    ) {
      console.log("[useFloatingSession] handleAiAnswerClick: Transcript still semantically evolving, skip this click.", {
        evolving,
        detection: effectiveDetection,
        preDebounceDetection,
        semanticallyStable,
        overlapRatio,
        minorQuestionEvolution,
        snapshotTimestamp,
      });
      return;
    }

    if (evolving && !semanticallyStable && shouldAllowEvolvingFollowup) {
      console.log("[AI Answer][Click] allowing semantically-evolving followup due to high overlap", {
        evolving,
        overlapRatio,
      });
    }

    console.log("[useFloatingSession] handleAiAnswerClick: Resolved question", {
      source,
      questionChars: question.length,
      snapshotTimestamp,
    });

    // Removed rapid re-answer blocking - user wants to be able to click multiple times
    // even for the same question to get different answers

    const normalizedQuestion = normalizeTranscriptText(question);

    console.log("[useFloatingSession] handleAiAnswerClick: Invoking handleAiAnswer with:", {
      sessionId: info.sessionId,
      questionChars: question.length,
      source,
      model: selectedModelRef.current,
      snapshotTimestamp,
      selectedContextSuppressed: true,
      suppressedReason: "normal_ai_answer_latest_transcript",
      activeQuestionDetectionIsFollowUp: effectiveDetection.isFollowUp,
    });

    const recentMessages = msgsSnapshot
      .filter(
        (m) =>
          (m.sender === "User" || m.sender === "Interviewer") &&
          !!m.text?.trim() &&
          typeof m.timestamp === "number",
      )
      .map((m) => ({
        sender: m.sender as "User" | "Interviewer",
        text: m.text.trim(),
        timestamp: m.timestamp,
      }));
    const adaptiveContext = buildAdaptiveAiContext({
      transcriptMessages: recentMessages,
      aiMessages: aiChat
        .filter((m) => m.sender === "AI")
        .map((m) => ({
          sender: "AI" as const,
          text: m.text,
          question: m.question,
        })),
      fallbackQuestion: question,
      liveInterimQuestion: liveInterviewerTextSnapshot,
      cutoffTimestamp: lastAnswerTimestampRef.current,
    });
    const recentTranscriptWindow = adaptiveContext.recentTranscriptWindow;
    const speakerSeparatedTranscript = adaptiveContext.speakerSeparatedTranscript;

    const selectedAnswerQuestion = "";
    const effectiveCurrentQuestion = adaptiveContext.currentQuestion || question;

    const rawTranscript =
      recentTranscriptWindow.length > 0
        ? recentTranscriptWindow.join("\n")
        : question;
    const detectionHint = effectiveCurrentQuestion || rawTranscript.slice(-500);

    const payload: AIAnswerRequestPayload = {
      requestId: opRequestId,
      sessionId: info.sessionId,
      transcript: rawTranscript,
      ...(effectiveCurrentQuestion ? { currentQuestion: effectiveCurrentQuestion } : {}),
      recentTranscriptWindow,
      speakerSeparatedTranscript,
      ...(adaptiveContext.previousAiAnswers.length > 0
        ? { previousAiAnswers: adaptiveContext.previousAiAnswers }
        : {}),
      ...(adaptiveContext.previousAiAnswer
        ? { previousAiAnswer: adaptiveContext.previousAiAnswer }
        : {}),
      ...(adaptiveContext.previousCodeBlocks?.length
        ? { previousCodeBlocks: adaptiveContext.previousCodeBlocks }
        : {}),
      answerClickMode: "answer_latest_unanswered",
      ...(detectionHint
        ? {
            activeQuestionDetection: {
              activeQuestion: detectionHint,
              cleanedQuestion: detectionHint,
              isFollowUp: effectiveDetection.isFollowUp,
              topicChanged: effectiveDetection.topicChanged,
              confidenceScore: effectiveDetection.confidenceScore,
              ignoredNoise: effectiveDetection.ignoredNoise,
              ...(effectiveDetection.referencedHistoryTurnId
                ? { referencedHistoryTurnId: effectiveDetection.referencedHistoryTurnId }
                : {}),
            },
          }
        : {}),
      answerMode: "auto",
      triggerSource: origin,
      sourcePlatform: "tauri",
    };

      console.log("[AI Answer][Timing][FE]", {
        sessionId: info.sessionId,
        requestId: payload.requestId,
        buildContextMs: Date.now() - contextBuildStartedAt,
        windowSizeUsed: adaptiveContext.windowSizeUsed,
        expandedReason: adaptiveContext.expandedReason,
        selectedContextSuppressed: true,
        suppressedReason: "normal_ai_answer_latest_transcript",
        activeQuestionDetectionIsFollowUp: effectiveDetection.isFollowUp,
      });

      console.log("[AI Answer][Request] start", {
        sessionId: info.sessionId,
        requestId: payload.requestId,
      });
      await handleAiAnswer(info.sessionId, payload, selectedModelRef.current);
      console.log("[AI Answer][Request] complete", {
        sessionId: info.sessionId,
        requestId: payload.requestId,
      });

      // Save pre-advance cutoff so regenerate can widen the window back to
      // include any transcript that arrived after an early accidental click.
      prevAnswerTimestampRef.current = lastAnswerTimestampRef.current;
      // Advance the cutoff to NOW so the next AI Answer click only picks up
      // messages that arrive after this answer completes.
      lastAnswerTimestampRef.current = Date.now();

      // TEMP DIAGNOSTIC (long-question split investigation, remove after):
      // exact moment a question is recorded as "answered" — this only
      // happens AFTER handleAiAnswer's full streaming response resolves.
      // Answers "was the first clause already added to answeredQuestionKeys
      // before the second clause arrived?" by timestamp comparison against
      // [DIAG][autogen-fire-start]/[DIAG][detect-active-question]. Dev-only.
      if (import.meta.env.DEV) {
        console.log("[DIAG][answered-history-push]", { question, at: Date.now() });
      }
      // Record this answered question for the rapid-refire dedup check.
      answeredQuestionsHistoryRef.current.push({
        text: question,
        normalizedText: normalizedQuestion,
        timestamp: Date.now(),
      });
      // Keep only last 50 answers in history to prevent memory leak
      if (answeredQuestionsHistoryRef.current.length > 50) {
        answeredQuestionsHistoryRef.current = answeredQuestionsHistoryRef.current.slice(-50);
      }
      console.log("[useFloatingSession] handleAiAnswerClick: Successfully answered question.");
      transitionGuardRef.current.transition("completed", "ai_answer_success", info.sessionId);
      transitionGuardRef.current.transition("recording", "resume_recording_after_answer", info.sessionId);
    } catch (error: any) {
      if (error?.name === "AbortError") {
        console.log("[AI Answer][Abort] request aborted", { error: String(error) });
        transitionGuardRef.current.transition("failed", "ai_answer_aborted", info.sessionId);
      } else {
        console.error("[AI Answer][Request] failed", error);
        transitionGuardRef.current.transition("failed", "ai_answer_failed", info.sessionId);
      }
    } finally {
      operationRegistryRef.current.release(info.sessionId, "ai-answer", opRequestId);
      isAiAnswerRunningRef.current = false;
      isEmittingRef.current = false;
      setIsAiAnswerUiLocked(false);
    }
  }, [
    handleAiAnswer,
    tabInterimTranscript,
    lastMessage,
    aiChat,
    aiResponses,
    currentResponseIndex,
    isAnswering,
    isAiAnswerUiLocked,
  ]);

  // ── Auto-generate (Slice 3 rewrite) ────────────────────────────────────
  //
  // Prior implementation: naive "newest interviewer message id changed →
  // wait 1500ms → fire". Every STT chunk creates a new message id, so the
  // timer was constantly resetting and either (a) never firing during a real
  // interviewer speaking burst, or (b) firing on a mid-sentence pause and
  // producing partial-question answers.
  //
  // New implementation reuses the SAME pipeline the main-window
  // handleStableTranscript uses (page.tsx:1271-1420):
  //
  //   1. Concatenate trailing consecutive Interviewer messages into a live
  //      transcript blob (bounded by a User message which acts as a natural
  //      turn break — candidate answered, next interviewer text is a new
  //      question).
  //   2. Feed that blob into a TranscriptStabilizer with a uniform 2000ms
  //      inactivity window, isUtteranceComplete gate, and 22000ms maxWait
  //      ceiling. Punctuation does not shorten the inactivity requirement.
  //   3. On stable fire: check for a follow-up continuation off the last
  //      auto-answered question, merge context if so.
  //   4. Classify + shouldTriggerGeneration to filter noise/repeats.
  //   5. Segment multi-question turns via segmentQuestions.
  //   6. Fire handleAiAnswerClick() (same entry point manual clicks use —
  //      internally resolves the current question and manages dedup).
  //
  // Baseline: the message id of the newest interviewer message already present
  // when auto-answer is enabled/re-enabled. A separate initialized flag is
  // required because `null` has two meanings: "not seeded yet" and "seeded
  // successfully when no interviewer rows existed." Distinguishing those
  // states lets the first genuine turn in a new empty session generate while
  // still suppressing transcript history on mid-session re-enable.
  const autoGenBaselineIdRef = useRef<string | null>(null);
  const autoGenBaselineInitializedRef = useRef(false);
  const autoGenWasEnabledRef = useRef(autoGenerate);
  const autoGenSessionIdRef = useRef<string | null>(null);
  // The id of the last message included in the stabilizer's current utterance.
  // Used to detect when a new interviewer message extends the current one.
  const autoGenLastFedIdRef = useRef<string | null>(null);
  // The concatenated interviewer transcript we've fed for the CURRENT
  // utterance (across consecutive Interviewer messages, bounded by any User
  // message that comes in between).
  const autoGenCurrentBlobRef = useRef<string>("");
  // Previous auto-answered context, used for follow-up continuation merges.
  const autoGenPrevContextRef = useRef<{
    transcript: string;
    timestamp: number;
  } | null>(null);
  // Recent auto-answered questions (last 10s window) used by
  // shouldTriggerGeneration to suppress rapid repeat fires on the same key.
  const autoGenRecentQuestionsRef = useRef<Array<{ q: string; t: number }>>([]);
  // Stabilizer instance for the mini overlay pipeline.
  const autoGenStabilizerRef = useRef<ReturnType<typeof createTranscriptStabilizer> | null>(null);

  // Kept stable via ref so the stabilizer callback (which is created once)
  // always sees the latest handleAiAnswerClick / state values.
  const autoGenFireRef = useRef<(snapshot: string) => void>(() => {});
  useEffect(() => {
    autoGenFireRef.current = (snapshot: string) => {
      // TEMP DIAGNOSTIC (long-question split investigation, remove after):
      // marks EVERY stabilizer onStable firing. If two of these appear
      // seconds apart (not ~500ms apart), the two generation cards came from
      // TWO SEPARATE stabilizer firings, not one firing's multi-segment
      // stagger. Dev-only.
      if (import.meta.env.DEV) {
        console.log("[DIAG][autogen-fire-start]", {
          snapshot,
          snapshotLength: snapshot.length,
          at: Date.now(),
        });
      }
      if (!autoGenerate) {
        // Toggle was turned off between the stabilizer arming and the freeze
        // window elapsing — respect the user's intent.
        console.log("[MiniAutoAnswer] Skipped: toggle off");
        return;
      }
      if (isAiAnswerRunningRef.current || isEmittingRef.current) {
        console.log("[MiniAutoAnswer] Skipped: manual generation in progress");
        return;
      }

      // ── Continuation merge (follow-up inheritance) ─────────────────────
      // If this new stable snapshot arrives within 8s of the previous auto
      // answer AND looks like a follow-up ("Why?", "Explain that"), merge
      // the previous question's text so context flows correctly.
      let effective = snapshot;
      const prev = autoGenPrevContextRef.current;
      if (prev) {
        const delta = Date.now() - prev.timestamp;
        if (isContinuationOfPreviousQuestion(snapshot, prev.transcript, delta)) {
          effective = `${prev.transcript} ${snapshot}`.replace(/\s+/g, " ").trim();
          console.log("[MiniAutoAnswer] Continuation detected", { chars: effective.length });
        }
      }

      // ── Classify ───────────────────────────────────────────────────────
      const classification = classifyTranscript(effective, prev?.transcript);

      // ── shouldTriggerGeneration gate ───────────────────────────────────
      const triggerResult = shouldTriggerGeneration({
        transcript: effective,
        isStable: true,
        classification,
        lastGenerationTimestamp: prev?.timestamp ?? 0,
        recentQuestions: autoGenRecentQuestionsRef.current,
      });
      if (!triggerResult.trigger) {
        console.log("[MiniAutoAnswer] Skipped:", triggerResult.reason);
        // Keep the exact rejected id/blob as the last observed candidate.
        // With no new interviewer activity, an identical messages update must
        // not re-arm the timer and reconsider it. The consumed baseline is
        // intentionally NOT advanced: later speech may complete this same
        // interviewer turn, and the trailing walk must retain that context.
        return;
      }

      // Turn-finalization fix: advance the consumed-boundary the moment this
      // turn is ACCEPTED for generation — not after the LLM call succeeds. A
      // failed generation must not leave the boundary ambiguous, and the auto
      // pipeline must not silently re-attempt the same turn on the next feed
      // (manual Regenerate remains available via the message card's own
      // stored context, independent of this ref — see useAIChat.ts). The new
      // baseline is autoGenLastFedIdRef: the newest Interviewer message id
      // that was actually part of THIS accepted blob (set by the "feed the
      // stabilizer" effect below on every feed). Every future trailing-walk
      // stops at this id, so an already-accepted question can never leak
      // into the next one — even with no candidate mic utterance in between.
      if (autoGenLastFedIdRef.current) {
        autoGenBaselineIdRef.current = autoGenLastFedIdRef.current;
      }

      // ── Segment multi-question turns ───────────────────────────────────
      // TEMP DIAGNOSTIC (long-question split investigation, remove after):
      // the exact full string handed to segmentQuestions(). Answers "what
      // exact full string reached segmentQuestions()?". Dev-only.
      if (import.meta.env.DEV) {
        console.log("[DIAG][segment-input]", { effective, at: Date.now() });
      }
      const segmented = segmentQuestions(effective);
      const segments =
        segmented.length >= 2
          ? segmented
          : classification.shouldGroup
            ? [effective]
            : classification.segments;

      // TEMP DIAGNOSTIC (long-question split investigation, remove after):
      // the actual segment TEXTS, not just the count — shows exactly how the
      // blob was divided (or not). Dev-only.
      if (import.meta.env.DEV) {
        console.log("[DIAG][segment-result]", { segmented, segments, at: Date.now() });
      }

      console.log("[MiniAutoAnswer] Firing", {
        segmentCount: segments.length,
        classification: classification.type,
        chars: effective.length,
      });

      // ── Fire ───────────────────────────────────────────────────────────
      // Mini-Phase B: pass the exact stabilized text through instead of
      // letting handleAiAnswerClick independently re-resolve from live
      // component state (which can race ahead to a newer, still-forming
      // interim fragment by the time this async call runs — the proven root
      // cause of a partial fragment like "And can you give a..." being
      // generated and marked answered). For truly independent multi-segment
      // turns, we fire once per segment with a small stagger, each carrying
      // its own exact segment text.
      if (segments.length <= 1) {
        void handleAiAnswerClick("auto", effective);
      } else {
        segments.forEach((seg, index) => {
          setTimeout(() => {
            if (isAiAnswerRunningRef.current || isEmittingRef.current) return;
            void handleAiAnswerClick("auto", seg);
          }, index * 500);
        });
      }

      // ── Book-keeping ───────────────────────────────────────────────────
      autoGenPrevContextRef.current = {
        transcript: effective,
        timestamp: Date.now(),
      };
      autoGenRecentQuestionsRef.current = [
        ...autoGenRecentQuestionsRef.current.filter(
          (e) => Date.now() - e.t < 10_000,
        ),
        { q: effective, t: Date.now() },
      ].slice(-20);
      // Reset current-utterance blob so the next interviewer speaking turn
      // starts fresh.
      autoGenCurrentBlobRef.current = "";
    };
  }, [autoGenerate, handleAiAnswerClick]);

  // Create the stabilizer once.
  //
  // Turn-finalization fix: a single explicit inactivity window (2000ms),
  // applied uniformly regardless of punctuation. Previously `needsConfirmation`
  // only required an extra quiet window for "."/"!"-terminated snapshots
  // (isWeakTerminator) — a "?"-terminated snapshot fired on the very first
  // freeze elapse, with zero confirmation. Since Deepgram's smart_format can
  // punctuate a natural MID-QUESTION pause with "?", that let auto-generation
  // fire while the interviewer was still mid-turn. Dropping needsConfirmation
  // entirely (not passing it) makes every complete snapshot require the same
  // single 2000ms silence window before firing — punctuation no longer
  // shortens or lengthens the wait. maxWaitMs (22000ms) is a stalled-input
  // safety valve only (see transcript-stabilizer.ts — now measured from the
  // last feed, not utterance age), not an active-question duration cap: a
  // continuously-spoken 30-60s+ question keeps resetting it via its own
  // periodic feeds and never trips this ceiling while speech continues.
  //
  // The main-window pipeline also uses an approximately 2000ms window, but its
  // weak-terminator confirmation remains independent and unchanged.
  useEffect(() => {
    if (autoGenStabilizerRef.current) return;
    autoGenStabilizerRef.current = createTranscriptStabilizer(
      (snapshot: string) => {
        // Delegate to the ref-tracked callback so we always run against the
        // freshest closure without recreating the stabilizer.
        autoGenFireRef.current(snapshot);
      },
      {
        freezeWindowMs: AUTO_GEN_INACTIVITY_MS,
        isComplete: isUtteranceComplete,
        maxWaitMs: 22000,
      },
    );
    return () => {
      autoGenStabilizerRef.current?.destroy();
      autoGenStabilizerRef.current = null;
    };
  }, []);

  // Seed lifecycle state before feeding the stabilizer. This single effect
  // deliberately handles enable/disable transitions before looking for a
  // candidate, so re-enable can never arm stale transcript content.
  useEffect(() => {
    const currentSessionId = sessionInfo?.sessionId ?? null;
    const sessionChanged = autoGenSessionIdRef.current !== currentSessionId;
    const wasEnabled = autoGenWasEnabledRef.current;
    autoGenWasEnabledRef.current = autoGenerate;

    const clearPendingCandidate = () => {
      autoGenStabilizerRef.current?.cancel();
      autoGenCurrentBlobRef.current = "";
      autoGenLastFedIdRef.current = null;
    };

    if (!currentSessionId) {
      clearPendingCandidate();
      autoGenSessionIdRef.current = null;
      autoGenBaselineIdRef.current = null;
      autoGenBaselineInitializedRef.current = false;
      return;
    }

    if (sessionChanged) {
      clearPendingCandidate();
      autoGenSessionIdRef.current = currentSessionId;
      autoGenBaselineIdRef.current = autoGenerate
        ? findNewestInterviewerMessageId(messages)
        : null;
      autoGenBaselineInitializedRef.current = autoGenerate;
      return;
    }

    if (!autoGenerate) {
      clearPendingCandidate();
      autoGenBaselineIdRef.current = null;
      autoGenBaselineInitializedRef.current = false;
      return;
    }

    // OFF → ON: seed from the transcript visible in THIS render and return
    // before candidate construction. Existing history is therefore ignored;
    // the next messages change must contain new interviewer activity.
    if (!wasEnabled || !autoGenBaselineInitializedRef.current) {
      clearPendingCandidate();
      autoGenBaselineIdRef.current = findNewestInterviewerMessageId(messages);
      autoGenBaselineInitializedRef.current = true;
      return;
    }

    // Build trailing interviewer transcript: walk backwards from the end
    // collecting consecutive Interviewer messages, stopping at the first
    // User message (candidate answered → new turn) or at the baseline id
    // (everything at/before it was already consumed by a prior accepted
    // auto-gen turn — see the baseline-advance in autoGenFireRef below).
    // Extracted to autoGenTrailingTranscript.ts for unit-testability.
    const baseline = autoGenBaselineIdRef.current;
    const trailing: TranscriptMessage[] = computeTrailingInterviewerMessages(
      messages,
      baseline,
    );

    if (trailing.length === 0) {
      // No new interviewer content past the baseline yet.
      return;
    }

    const newestId = trailing[trailing.length - 1].id;
    const blob = trailing
      .map((message) => message.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      !shouldFeedAutoGenCandidate(
        autoGenLastFedIdRef.current,
        autoGenCurrentBlobRef.current,
        newestId,
        blob,
      )
    ) {
      // Same content we already fed — skip to avoid re-arming the stabilizer
      // timer needlessly (which would push out firing indefinitely).
      return;
    }

    autoGenCurrentBlobRef.current = blob;
    autoGenLastFedIdRef.current = newestId;
    autoGenStabilizerRef.current?.feed(blob);
  }, [autoGenerate, messages, sessionInfo?.sessionId]);

  const toggleAutoGenerate = useCallback(() => {
    dispatch(setAutoGenerate(!autoGenerate));
  }, [dispatch, autoGenerate]);

  const toggleAutoScroll = useCallback(() => {
    const nextAutoScroll = !autoScroll;
    const nextIndex = nextResponseIndexOnToggle(nextAutoScroll, aiResponses.length);
    if (nextIndex !== null) {
      dispatch(setCurrentResponseIndex(nextIndex));
    }
    dispatch(setAutoScroll(nextAutoScroll));
  }, [dispatch, autoScroll, aiResponses.length]);

  const handleAnalyzeScreenClick = useCallback(
    async (screenshotBlob?: Blob) => {
      console.log("[useFloatingSession] handleAnalyzeScreenClick triggered.");

      // Validation: Ensure a valid model is selected
      const currentModel = selectedModelRef.current;
      if (!isValidModel(currentModel)) {
        console.error("[useFloatingSession] Invalid model selected:", currentModel);
        toast.error("Please select a valid AI model before continuing");
        dispatch(setSelectedModel(getValidModel(currentModel)));
        return;
      }

      if (isAnalyzeEmittingRef.current) {
        console.log("[useFloatingSession] handleAnalyzeScreenClick: Suppressed click (isAnalyzeEmittingRef is true).");
        return;
      }

      const info = sessionInfoRef.current;
      if (!info) {
        console.log("[useFloatingSession] handleAnalyzeScreenClick: Suppressed click (no sessionInfo available).");
        return;
      }

      // Use same question resolution logic as AI Answer for context
      const msgs = messagesRef.current;
      const liveInterviewerText = tabInterimTranscript.trim();
      const resolved = resolveQuestionFromContext(liveInterviewerText, getOrBuildNormalizedMsgs().forResolution, lastMessage, lastAnswerTimestampRef.current);
      const contextQuestion = resolved?.question || "(no context)";
      const adaptiveContext = buildAdaptiveAiContext({
        transcriptMessages: msgs
          .filter(
            (m) =>
              (m.sender === "User" || m.sender === "Interviewer") &&
              !!m.text?.trim() &&
              typeof m.timestamp === "number",
          )
          .map((m) => ({
            sender: m.sender as "User" | "Interviewer",
            text: m.text.trim(),
            timestamp: m.timestamp,
          })),
        aiMessages: aiChat
          .filter((m) => m.sender === "AI")
          .map((m) => ({
            sender: "AI" as const,
            text: m.text,
            question: m.question,
          })),
        fallbackQuestion: contextQuestion,
        liveInterimQuestion: liveInterviewerText,
        cutoffTimestamp: lastAnswerTimestampRef.current,
      });

      console.log("[useFloatingSession] handleAnalyzeScreenClick: Initiating handleAnalyzeScreen with:", {
        sessionId: info.sessionId,
        screenshotSize: screenshotBlob?.size,
        contextQuestionChars: contextQuestion.length,
        model: ANALYZE_SCREEN_FAST_MODEL,
        selectedModel: selectedModelRef.current,
        windowSizeUsed: adaptiveContext.windowSizeUsed,
        expandedReason: adaptiveContext.expandedReason,
      });

      isAnalyzeEmittingRef.current = true;
      setIsCapturing(true);
      try {
        await handleAnalyzeScreen(
          info.sessionId,
          screenshotBlob || null,
          ANALYZE_SCREEN_FAST_MODEL,
          {
            transcript:
              adaptiveContext.recentTranscriptWindow.length > 0
                ? adaptiveContext.recentTranscriptWindow.join("\n")
                : contextQuestion,
            currentQuestion: adaptiveContext.currentQuestion || contextQuestion,
            recentTranscriptWindow: adaptiveContext.recentTranscriptWindow,
            speakerSeparatedTranscript: adaptiveContext.speakerSeparatedTranscript,
            ...(adaptiveContext.previousAiAnswers.length > 0
              ? { previousAiAnswers: adaptiveContext.previousAiAnswers }
              : {}),
            ...(adaptiveContext.previousAiAnswer
              ? { previousAiAnswer: adaptiveContext.previousAiAnswer }
              : {}),
            ...(adaptiveContext.previousCodeBlocks?.length
              ? { previousCodeBlocks: adaptiveContext.previousCodeBlocks }
              : {}),
            activeQuestionDetection: {
              activeQuestion: adaptiveContext.currentQuestion || contextQuestion,
              cleanedQuestion: adaptiveContext.currentQuestion || contextQuestion,
              isFollowUp: false,
              topicChanged: false,
              confidenceScore: 1,
              ignoredNoise: false,
            },
            sourcePlatform: "tauri",
            answerMode: "auto",
          },
        );
      } finally {
        isAnalyzeEmittingRef.current = false;
        setIsCapturing(false);
      }
    },
    [handleAnalyzeScreen, tabInterimTranscript, lastMessage, aiChat],
  );

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !sessionInfoRef.current) return;
    // Block manual sends while AI is busy (analysis or answer generation)
    if (isAnalyzing || isAnswering || isAiAnswerUiLocked) {
      console.log("[useFloatingSession] handleSend: Suppressed (AI operation in progress).");
      return;
    }
    const query = inputValue.trim();
    setInputValue("");
    const adaptiveContext = buildAdaptiveAiContext({
      transcriptMessages: messagesRef.current
        .filter(
          (m) =>
            (m.sender === "User" || m.sender === "Interviewer") &&
            !!m.text?.trim() &&
            typeof m.timestamp === "number",
        )
        .map((m) => ({
          sender: m.sender as "User" | "Interviewer",
          text: m.text.trim(),
          timestamp: m.timestamp,
        })),
      aiMessages: aiChat
        .filter((m) => m.sender === "AI")
        .map((m) => ({
          sender: "AI" as const,
          text: m.text,
          question: m.question,
        })),
      fallbackQuestion: query,
      liveInterimQuestion: tabInterimTranscript.trim(),
      cutoffTimestamp: lastAnswerTimestampRef.current,
    });
    handleCustomQuery(sessionInfoRef.current.sessionId, query, selectedModelRef.current, {
      transcript:
        adaptiveContext.recentTranscriptWindow.length > 0
          ? adaptiveContext.recentTranscriptWindow.join("\n")
          : query,
      currentQuestion: query,
      recentTranscriptWindow: adaptiveContext.recentTranscriptWindow,
      speakerSeparatedTranscript: adaptiveContext.speakerSeparatedTranscript,
      ...(adaptiveContext.previousAiAnswers.length > 0
        ? { previousAiAnswers: adaptiveContext.previousAiAnswers }
        : {}),
      ...(adaptiveContext.previousAiAnswer
        ? { previousAiAnswer: adaptiveContext.previousAiAnswer }
        : {}),
      ...(adaptiveContext.previousCodeBlocks?.length
        ? { previousCodeBlocks: adaptiveContext.previousCodeBlocks }
        : {}),
      sourcePlatform: "tauri",
      answerMode: "auto",
    });
  }, [inputValue, handleCustomQuery, aiChat, tabInterimTranscript, isAnalyzing, isAnswering, isAiAnswerUiLocked]);

  const handleRegenerateResponse = useCallback(
    async (messageId: string) => {
      const info = sessionInfoRef.current;
      if (!info || !messageId) return;
      // Regenerate must replay the selected card's original generation context.
      // Do not override with live transcript context here.
      await handleRegenerate(info.sessionId, messageId, selectedModelRef.current);
    },
    [handleRegenerate],
  );

  // ── Mic toggle ──────────────────────────────────────────────────────────────

  const handleToggleMic = useCallback(async () => {
    if (micStartInFlightRef.current) return;
    if (isMicActive || isMicConnecting) {
      await audioControllerRef.current.stopAudioSession("mic", "mic_toggle_off");
      setIsMicActive(false);
      setIsMicConnecting(false);
      setMicInterimTranscript("");
    } else if (sessionInfoRef.current) {
      try {
        micStartInFlightRef.current = true;
        const allowed = await preflightMicPermission(false);
        if (!allowed) {
          setIsMicConnecting(false);
          return;
        }
        audioControllerRef.current.startAudioSession("mic", "mic_toggle_on");
        setIsMicConnecting(true);
        const keyterms = buildDeepgramKeyterms();
        try {
          const dgKey = await resolveDeepgramKey();
          await invoke("start_mic_transcription", {
            language: getLanguageCode(sessionInfoRef.current.language ?? "English"),
            model: "nova-3",
            keyterms,
            apiKey: dgKey,
          });
        } catch (e: unknown) {
          toast.error(`Mic: ${String(e)}`);
          setIsMicConnecting(false);
        }
      } finally {
        micStartInFlightRef.current = false;
      }
    }
  }, [buildDeepgramKeyterms, isMicActive, isMicConnecting, preflightMicPermission]);

  useEffect(() => {
    return () => {
      const sid = sessionInfoRef.current?.sessionId;
      if (sid) {
        transitionGuardRef.current.transition("stopping", "floating_unmount", sid);
        transitionGuardRef.current.transition("cleanup", "floating_unmount", sid);
      }
      operationRegistryRef.current.clear();
      cancelActiveRequest("floating_unmount");
      const hasActiveSession = !!sessionInfoRef.current?.sessionId;
      if (hasActiveSession) {
        if (import.meta.env.DEV) {
          console.log("[audio-lifecycle] floatingUnmountAudioPreserved", {
            sessionActive: true,
            reason: "floating_unmount_preserve_system",
          });
        }
        return;
      }
      void audioControllerRef.current.destroyAudioSession("floating_unmount");
      transitionGuardRef.current.forceSet("idle");
    };
  }, [cancelActiveRequest]);

  const handleClearTranscript = useCallback(() => {
    setMicInterimTranscript("");
    setTabInterimTranscript("");
    dispatch(clearMessages());
  }, [dispatch]);

  const persistPatchedTranscript = useCallback(
    (messageId: string, sender: "User" | "Interviewer", originalText: string, patchedText: string, timestamp?: number) => {
      const sid = sessionInfoRef.current?.sessionId;
      if (!sid || sessionInfoRef.current?.saveTranscript === false) return;
      getAuthHeaders().then((authHeaders) =>
        persistWithRetry(
          `${BACKEND_URL}/api/session/${sid}/transcript/${messageId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              patchedText,
              originalText,
              patchedAt: new Date().toISOString(),
              patchedByUser: true,
              sender,
              timestamp,
            }),
          },
          "transcript-user-edit",
        ),
      ).catch((err) => console.error("[useFloatingSession] Failed to patch transcript:", err));
    },
    [],
  );

  const handlePatchTranscriptMessage = useCallback(
    (messageId: string, patchedText: string) => {
      const trimmed = patchedText.trim();
      if (!trimmed) return;
      const current = messagesRef.current.find((m) => m.id === messageId);
      if (!current) return;
      dispatch(
        patchMessage({
          id: messageId,
          patchedText: trimmed,
          patchedAt: Date.now(),
        }),
      );
      if (sessionInfoRef.current?.saveTranscript === false) return;
      if (patchPersistTimersRef.current[messageId]) {
        clearTimeout(patchPersistTimersRef.current[messageId]);
      }
      patchPersistTimersRef.current[messageId] = setTimeout(() => {
        persistPatchedTranscript(
          messageId,
          current.sender,
          current.originalText || current.text,
          trimmed,
          current.timestamp,
        );
        delete patchPersistTimersRef.current[messageId];
      }, 800);
    },
    [dispatch, persistPatchedTranscript],
  );

  // ── Redux action dispatchers (stable, no closure deps) ──────────────────────

  // Collapse/expand must resize the NATIVE mini window, not just swap React
  // content. The window is a fixed 700×222 transparent, borderless frame; if we
  // only shrink the React badge to 180px the oversized frame stays behind it and
  // shows as the leftover "second bar" (Issue 1). set_mini_state shrinks the
  // native frame to hug the badge (collapse) and restores the bar (expand), and
  // keeps the window horizontally centered so the badge doesn't jump sideways.
  const collapseWindow = useCallback(() => {
    dispatch(setIsWindowCollapsed(true));
    if (isTauri()) {
      invoke("set_mini_state", { state: "badge" }).catch((err) =>
        console.error("[useFloatingSession] collapse resize failed", err),
      );
    }
  }, [dispatch]);

  const expandWindow = useCallback(() => {
    // Grow the native frame back BEFORE React paints the full widget so the
    // expanded content is never clipped by a still-collapsed window.
    if (isTauri()) {
      invoke("set_mini_state", { state: "bar" }).catch((err) =>
        console.error("[useFloatingSession] expand resize failed", err),
      );
    }
    dispatch(setIsWindowCollapsed(false));
  }, [dispatch]);

  const toggleTranscriptExpanded = useCallback(() => {
    const nextExpanded = !isTranscriptExpanded;
    dispatch(setIsTranscriptExpanded(nextExpanded));
    if (!nextExpanded) {
      if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] transcriptCollapseUiOnly", {
          reason: "transcript_collapsed",
          sessionActive: !!sessionInfoRef.current?.sessionId,
        });
      }
    }
  }, [dispatch, isTranscriptExpanded]);

  const toggleResponsesExpanded = useCallback(() => {
    dispatch(setIsResponsesExpanded(!isResponsesExpanded));
  }, [dispatch, isResponsesExpanded]);

  const expandResponses = useCallback(() => {
    dispatch(setIsResponsesExpanded(true));
  }, [dispatch]);

  const goToPrevResponse = useCallback(() => {
    dispatch(setCurrentResponseIndex(Math.max(0, currentResponseIndex - 1)));
  }, [dispatch, currentResponseIndex]);

  const goToNextResponse = useCallback(() => {
    dispatch(setCurrentResponseIndex(Math.min(aiResponses.length - 1, currentResponseIndex + 1)));
  }, [dispatch, currentResponseIndex, aiResponses.length]);

  const onModelChange = useCallback(
    (model: string) => {
      dispatch(setSelectedModel(model));
    },
    [dispatch],
  );

  // ── Derived state ───────────────────────────────────────────────────────────

  const lastTranscriptLine = lastMessage?.text ?? "";
  const lastTranscriptSender = lastMessage?.sender ?? null;
  const interimTranscript = micInterimTranscript || tabInterimTranscript;
  const isAiAnswerRunning = isAnswering || isAiAnswerRunningRef.current || isAiAnswerUiLocked;
  const isTabActive = tabStatus === "transcribing";
  const isTabConnecting = tabStatus === "connecting";
  const isSystemAuthError = tabStatus === "error" && isDeepgramAuthFailureMessage(tabError);
  const captureStatus = deriveCaptureStatus({
    tabStatus,
    isSystemStale,
    isMicConnecting,
    isMicActive,
    hasSession: !!sessionInfo,
  });

  return {
    // ── Redux state ──────────────────────────────────────────────────────────
    sessionInfo,
    selectedModel,
    messages,
    creditWarning,
    isEnding,
    isWindowCollapsed,
    isResponsesExpanded,
    isTranscriptExpanded,
    currentResponseIndex,
    autoGenerate,
    autoScroll,

    // ── AI chat (from useAIChat) ─────────────────────────────────────────────
    aiChat,
    aiResponses,
    isAnalyzing,
    isAnswering: isAiAnswerRunning,

    // ── Hardware / ephemeral state ───────────────────────────────────────────
    isMicActive,
    isMicConnecting,
    micInterimTranscript,
    tabStatus,
    tabError,
    tabErrorPermissionType,
    permissionIdentity,
    permissionRequiresRestart,
    tabInterimTranscript,
    isCapturing,
    inputValue,
    setInputValue,

    // ── Derived ──────────────────────────────────────────────────────────────
    lastTranscriptLine,
    lastTranscriptSender,
    interimTranscript,
    isTabActive,
    isTabConnecting,
    isSystemAuthError,
    captureStatus,
    formattedTime,

    // ── Action handlers ──────────────────────────────────────────────────────
    endSession,
    handleAiAnswerClick,
    handleAnalyzeScreenClick,
    handleRegenerateResponse,
    handleSend,
    handleToggleMic,
    handleClearTranscript,
    handlePatchTranscriptMessage,
    startSystemAudio,
    retrySystemAudio,
    preflightMicPermission,
    collapseWindow,
    expandWindow,
    toggleTranscriptExpanded,
    toggleResponsesExpanded,
    expandResponses,
    goToPrevResponse,
    goToNextResponse,
    onModelChange,
    toggleAutoGenerate,
    toggleAutoScroll,
  };
}
