import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useDeepgram } from "@/hooks/useDeepgram";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useNativeTabTranscription } from "@/hooks/useNativeTabTranscription";
import { useAIChat } from "@/hooks/useAIChat";
import { useKeyboardShortcut } from "@/hooks/useKeyboardShortcut";
import { useFreeSessionTimer } from "@/hooks/useFreeSessionTimer";
import { useSessionHeartbeat } from "@/hooks/useSessionHeartbeat";
import { createAudioSessionController } from "@/features/session/audio/audioSessionController";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/globalAuth";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/utils";
import { detectIntent, isFillerPhrase } from "@/lib/intent-detector";
import {
  createTranscriptStabilizer,
  prepareGeneration,
  shouldTriggerGeneration,
  classifyTranscript,
  isContinuationOfPreviousQuestion,
} from "@/lib/generation-pipeline";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

import { ScreenCapture } from "./components/ScreenCapture";
import { AIChatPanel } from "./components/AIChatPanel";
import { OverlayContainer } from "./components/OverlayContainer";
import { EndSessionDialog } from "./EndSessionDialog";
import { Transcript, type Message } from "./Transcript";
import {
  ActivateResponseData,
  ConnectDialog,
} from "@/components/Sessions/ConnectDialog";
import { BuyCreditsDialog } from "@/components/Billing/BuyCreditsDialog";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { useCreditBrackets } from "@/hooks/useCreditBrackets";
import type { AIAnswerRequestPayload } from "@/types/ai-answer";
import { detectActiveQuestion } from "@/features/session/detection/activeQuestionDetector";
import { extractInterviewKeywordsFromParts } from "@/utils/keywordExtractor";
import { buildAdaptiveAiContext } from "@/features/session/context/adaptiveAiContext";
import { normalizeSttTranscript } from "@/features/session/transcript/stt-normalizer";
import { resolveDeepgramKey } from "@/lib/deepgramAuth";

/**
 * Segments a single transcript chunk into individual interview questions.
 *
 * Handles three patterns commonly produced by interviewer speech:
 *   1. '?'-terminated:        "What is X? How does Y work?"
 *   2. Digit-numbered list:   "1. Explain X. 2. Explain Y."
 *   3. Word-numbered list:    "One: X. Two, Y. Three: Z."
 *
 * Returns an empty array if no clear segmentation is detected — caller falls
 * back to treating the whole chunk as one question.
 */
function segmentQuestions(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Word-number prefixes (lowercase): used to split spoken numbered lists.
  const wordNumbers =
    "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)";

  // Pattern: a number marker (digit or word) followed by `:`, `.`, `,`, `)` or whitespace
  // Examples matched: "1.", "1)", "Two:", "Three,", "Four "
  // We use lookahead to KEEP the marker on the next segment.
  const numberedPattern = new RegExp(
    `(?=(?:^|[\\s.])\\s*(?:\\d{1,2}|${wordNumbers})\\s*[.:),]\\s+)`,
    "gi",
  );

  // First try numbered split.
  const numberedParts = trimmed
    .split(numberedPattern)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);

  if (numberedParts.length >= 2) {
    return numberedParts;
  }

  // Otherwise split on '?' boundaries (preserving the '?').
  const questionParts = trimmed
    .split(/(?<=\?)\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length > 6);

  if (questionParts.length >= 1) return questionParts;

  return [];
}

function normalizeLineForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEAR_DUPLICATE_GAP_MS = 2500;
const SYSTEM_INTERIM_COMMIT_MS = 300;
const SYSTEM_FINAL_RECONCILE_WINDOW_MS = 8000;
const MIN_INCLUDE_DUPLICATE_LEN = 20;
const OVERLAY_TRANSCRIPT_MAX_MESSAGES = 60;
const OVERLAY_TRANSCRIPT_MAX_CHARS = 6000;

function areNearDuplicateTexts(a: string, b: string): boolean {
  const na = normalizeLineForDedup(a);
  const nb = normalizeLineForDedup(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length < MIN_INCLUDE_DUPLICATE_LEN) return false;
  return longer.includes(shorter);
}

function buildOverlayTranscript(messages: Message[]): string {
  const joined = messages
    .slice(-OVERLAY_TRANSCRIPT_MAX_MESSAGES)
    .map((m) => m.text)
    .join("\n")
    .trim();
  if (joined.length <= OVERLAY_TRANSCRIPT_MAX_CHARS) return joined;
  return joined.slice(joined.length - OVERLAY_TRANSCRIPT_MAX_CHARS);
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
        i--; // Step back to check again with the updated array
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

export default function ActiveSession() {
  const stopWebMicRef = useRef<() => void>(() => {});
  const stopWebSystemRef = useRef<() => void>(() => {});
  const audioControllerRef = useRef(
    createAudioSessionController({
      source: "active-session",
      stopWebMic: () => stopWebMicRef.current(),
      stopWebSystem: () => stopWebSystemRef.current(),
    }),
  );

  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_session_active", { active: true });
    return () => {
      const preserveFloatingSession = !!sessionStorage.getItem("hireshade.session-init");
      if (preserveFloatingSession) {
        if (import.meta.env.DEV) {
          console.log("[audio-lifecycle] mainUnmountPreservedForFloatingSession", {
            reason: "active_session_unmount_hmr_or_hidden_main",
          });
        }
        return;
      }
      invoke("set_session_active", { active: false });
      void audioControllerRef.current.destroyAudioSession("active_session_unmount");
    };
  }, []);

  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [isEndSessionDialogOpen, setIsEndSessionDialogOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const PREFERRED_MODEL_KEY = "hireshade_preferred_model";
  const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
  
  // Available models - should match ModelSelector.AI_MODELS
  const AVAILABLE_MODELS = [
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-sonnet-4-5",
    "google/gemini-3.1-flash-lite-preview",
    "openai/gpt-5",
  ];
  
  const [selectedModel, setSelectedModel] = useState(() => {
    // Priority: 1. Navigation state, 2. Stored preference (if valid), 3. Default
    const navModel = location.state?.connectData?.aiModel;
    const storedModel = localStorage.getItem(PREFERRED_MODEL_KEY);
    
    // Validate and return a valid model
    if (navModel && AVAILABLE_MODELS.includes(navModel)) {
      return navModel;
    }
    if (storedModel && AVAILABLE_MODELS.includes(storedModel)) {
      return storedModel;
    }
    return DEFAULT_MODEL;
  });

  const [selectedLanguage, setSelectedLanguage] = useState(
    location.state?.connectData?.language || "English",
  );
  const selectedModelRef = useRef(selectedModel);
  // Keep ref in sync so callbacks that close over it always read the latest model.
  useEffect(() => {
    selectedModelRef.current = selectedModel;
    // Persist to localStorage whenever it changes
    localStorage.setItem(PREFERRED_MODEL_KEY, selectedModel);
  }, [selectedModel]);


  // Stable ref to handleAiAnswer — set after useAIChat() is called below.
  // Using a ref allows handleTranscript (defined before useAIChat) to call
  // handleAiAnswer without creating a forward-reference ordering problem.
  const handleAiAnswerRef = useRef<((sessionId: string, payload: AIAnswerRequestPayload, aiModel: string) => void) | null>(null);

  const getLanguageCode = (lang: string) => {
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
  };

  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(
    !!location.state?.showConnect,
  );
  const patchPersistTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const connectData = location.state?.connectData || {};
  const deepgramKeyterms = useMemo(
    () =>
      extractInterviewKeywordsFromParts([
        connectData?.companyName,
        connectData?.jobTitle,
        connectData?.extraContext,
      ]),
    [connectData?.companyName, connectData?.jobTitle, connectData?.extraContext],
  );
  // Ephemeral mode flag — false means nothing persists after the session ends.
  // Defaults to true to match backend (saveTranscription defaults to true).
  const saveTranscriptEnabled: boolean = connectData?.saveTranscript !== false;

  // Activate response data — populated once the ConnectDialog succeeds
  const [maxAllowedMinutes, setMaxAllowedMinutes] = useState<number | null>(
    null,
  );
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [creditWarning, setCreditWarning] = useState<number | null>(null); // remaining minutes
  const [buyCreditsOpen, setBuyCreditsOpen] = useState(false);
  const { refresh: refreshBalance } = useCreditsBalance();
  const { brackets: creditBrackets } = useCreditBrackets();
  const graceZoneMinutes = creditBrackets[0]?.graceZoneMinutes ?? 5;
  const creditsPerMinute = parseFloat(creditBrackets[0]?.creditsPerMinute ?? "0.5");

  const handleConnectSuccess = useCallback(
    (
      finalModel: string,
      finalLanguage: string,
      activateData: ActivateResponseData,
    ) => {
      setIsConnectDialogOpen(false);
      if (finalModel) setSelectedModel(finalModel);
      if (finalLanguage) setSelectedLanguage(finalLanguage);
      setMaxAllowedMinutes(activateData.maxAllowedMinutes);
      setSessionStartedAt(activateData.startedAt);
    },
    [],
  );

  const handleConnectCancel = useCallback(() => {
    setIsConnectDialogOpen(false);
    navigate("/sessions");
  }, [navigate]);

  const stopHeartbeatRef = useRef<(() => void) | null>(null);
  const isEndingRef = useRef(false);
  const sessionStartedAtRef = useRef<string | null>(null);

  // Keep ref in sync with state so endSessionNow always reads the latest value
  sessionStartedAtRef.current = sessionStartedAt;

  const endSessionNow = useCallback(async ({ skipWindowManagement = false }: { skipWindowManagement?: boolean } = {}) => {
    if (!id) return;
    // Guard against double-invocation (both heartbeat and SSE can fire simultaneously)
    if (isEndingRef.current) return;
    isEndingRef.current = true;

    toast.info("Ending session...", {
      duration: 3000,
    });

    // Stop heartbeat immediately so no new ticks fire during cleanup
    stopHeartbeatRef.current?.();

    // Calculate exact elapsed duration so the backend can apply the free-zone rule
    // Use ref to get the latest value (avoids stale closure — sessionStartedAt not in deps)
    const startedAt = sessionStartedAtRef.current;
    const durationMinutes = startedAt
      ? Math.ceil((Date.now() - new Date(startedAt).getTime()) / 60_000)
      : null;

    // Client-side grace-zone determination (≤ graceZoneMinutes → no charge)
    const isFreeZone = durationMinutes !== null && durationMinutes <= graceZoneMinutes;

    try {
      // For ephemeral sessions, do NOT send transcript to the backend.
      // Sending it would trigger background analytics generation on the server.
      const transcript = saveTranscriptEnabled
        ? messages.map((m) => `[${m.sender}]: ${m.text}`).join("\n")
        : undefined;
      const aiUsage = parseInt(localStorage.getItem(`aiUsage_${id}`) || "0");
      const deactivateAuthHeaders = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/session/${id}/deactivate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...deactivateAuthHeaders,
          },
          body: JSON.stringify({ transcript, aiUsage, durationMinutes }),
        },
      );
      localStorage.removeItem(`aiUsage_${id}`);

      // Grace-zone: no credits charged — no need to poll
      if (isFreeZone) {
        toast.success(`Session ended — no credits charged (under ${graceZoneMinutes} min)`);
      }

      // For paid sessions, read the settlement result. The backend now
      // settles synchronously and returns { status, creditsDeducted,
      // deductionReason } directly; the COMPLETING poll below remains as a
      // fallback for async settlement paths.
      if (res.ok && maxAllowedMinutes !== null && !isFreeZone) {
        const data = await res.json();
        if (data.status === "COMPLETING") {
          let attempts = 0;
          let deductedCredits: string | null = null;
          let deductedReason: string | null = null;
          while (attempts < 4) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const poll = await fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/session/${id}`,
                { headers: await getAuthHeaders() },
              );
              if (poll.ok) {
                const session = await poll.json();
                const sessionData = session.data || session;
                const status = sessionData?.status;
                deductedCredits = sessionData?.creditsDeducted ?? null;
                deductedReason = sessionData?.deductionReason ?? null;
                if (status === "COMPLETED" || status === "CREDIT_EXHAUSTED")
                  break;
              }
            } catch {
              // ignore poll errors — we'll navigate regardless
            }
            attempts++;
          }
          if (deductedReason === "FREE_ZONE") {
            toast.success(`Session ended — no credits charged (under ${graceZoneMinutes} min)`);
          } else if (deductedCredits) {
            const mins = durationMinutes ?? 0;
            toast.info(`Session ended — ${deductedCredits} credits deducted (${mins} min × ${creditsPerMinute} credits/min)`);
          }
        } else if (data.deductionReason === "FREE_ZONE") {
          toast.success(`Session ended — no credits charged (under ${graceZoneMinutes} min)`);
        } else if (data.creditsDeducted && parseFloat(data.creditsDeducted) > 0) {
          const mins = data.minutes ?? durationMinutes ?? 0;
          toast.info(`Session ended — ${data.creditsDeducted} credits deducted (${mins} min × ${creditsPerMinute} credits/min)`);
        }
      }
    } catch (error) {
      console.error("Error ending session directly:", error);
    } finally {
      // Stop all transcription streams and screen share gracefully
      try {
        await audioControllerRef.current.destroyAudioSession("end_session");
        
        // Stop screen share stream
        if (stream) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (e) {
              console.warn("Error stopping track:", e);
            }
          });
        }
      } catch (err) {
        console.error("Stream cleanup error:", err);
      }

      // Clean up overlay and main windows — only when ended from the main window.
      // When ended from the floating window, the endSessionThunk already handles
      // window transitions (shows launcher, hides mini); showing main here would
      // bring it on top of the launcher and break the overlay UX.
      if (!skipWindowManagement) {
        try {
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const mini = await WebviewWindow.getByLabel("mini");
          if (mini) {
            await mini.hide(); // hide not close — mini WebView is reused across sessions
          }
          const mainWindow = await WebviewWindow.getByLabel("main");
          if (mainWindow) {
            await mainWindow.show();
            await mainWindow.unminimize();
            await mainWindow.setFocus();
          }
        } catch (err) {
          console.error("Window mgmt error:", err);
        }
        navigate("/sessions");
      }
    }
  }, [id, messages, maxAllowedMinutes, navigate, saveTranscriptEnabled, graceZoneMinutes, creditsPerMinute]);

  const onTimeUp = useCallback(async () => {
    toast.info("Free session time is up!");
    endSessionNow();
  }, [endSessionNow]);

  const onCreditExhausted = useCallback(() => {
    toast.error("Session ended — credits exhausted.", { duration: 6000 });
    endSessionNow();
  }, [endSessionNow]);

  const onCreditWarning = useCallback((remaining: number) => {
    setCreditWarning(remaining);
    toast.warning(
      `Only ${remaining} minute${remaining === 1 ? "" : "s"} of credit remaining!`,
      { duration: 8000 },
    );
  }, []);

  const { isFreeSession, formattedTime } = useFreeSessionTimer({
    sessionId: id,
    onTimeUp,
    maxAllowedMinutes,
  });

  const onSessionEndedRemotely = useCallback(() => {
    toast.info(
      "This session was ended (inactive too long or ended on another device).",
      { duration: 6000 },
    );
    endSessionNow();
  }, [endSessionNow]);

  // Heartbeat: runs every 60s for ALL sessions after activation.
  // Free sessions need it too: it's the liveness signal that (a) lets the
  // server's stale-session reaper distinguish a crashed client from a live
  // one, and (b) enforces the free-session time cap server-side.
  const { stop: stopHeartbeat } = useSessionHeartbeat({
    sessionId: id,
    enabled: !isConnectDialogOpen && sessionStartedAt !== null,
    startedAt: sessionStartedAt,
    onExhausted: onCreditExhausted,
    onWarning: onCreditWarning,
    onSessionEnded: onSessionEndedRemotely,
  });

  // NOTE: a separate SSE ("/events") channel used to run alongside the
  // heartbeat here. It was retired: the endpoint had no auth/ownership check
  // (any caller could open an SSE stream for any session id) and never
  // actually emitted CREDIT_WARNING/SESSION_CLOSED — it only sent keep-alive
  // pings, so the listener was permanently dead code promising a contract it
  // never fulfilled. useSessionHeartbeat (above) already delivers the same
  // CREDIT_WARNING / CREDIT_EXHAUSTED / TIME_EXHAUSTED / SESSION_NOT_ACTIVE
  // outcomes every 60s via an authenticated, ownership-checked endpoint.

  // Keep the ref current so endSessionNow (defined above) can call stop
  stopHeartbeatRef.current = stopHeartbeat;

  //   const { showDialog: showInactivityDialog, remainingTime, onStayActive } = useInactivityObserver(
  //     undefined, // Use default from env
  //     endSessionNow
  //   );

  const { stream, videoRef, startShare, captureScreenshot } = useScreenShare();

  // NOTE: Do NOT auto-start getDisplayMedia from useEffect — WKWebView in
  // production strictly requires getDisplayMedia to originate from a direct
  // synchronous user gesture (button click). The ScreenCapture panel's
  // "Select Screen / Tab" button serves as the user gesture entry point.

  // Auto-answer master switch. ROOT-CAUSE FIX: this used to be
  //   location.state?.connectData?.autoGenerateResponse ?? false
  // but no navigation path ever set connectData.autoGenerateResponse — the
  // wizard persists the toggle to the DB and GET /api/session/:id returns it,
  // yet the live page never read it. Net effect: the entire auto-answer
  // pipeline (stabilizer → segmentation → generation) was permanently gated
  // OFF on web, and any mid-session refresh (nav state lost) had the same
  // effect. Now: seed from nav state when explicitly provided, then hydrate
  // from the session record (see settings-hydration effect below).
  const [autoGenerateResponse, setAutoGenerateResponse] = useState<boolean>(
    typeof location.state?.connectData?.autoGenerateResponse === "boolean"
      ? location.state.connectData.autoGenerateResponse
      : false,
  );
  const [sessionSimpleLanguage, setSessionSimpleLanguage] = useState<boolean>(
    !!location.state?.connectData?.simpleLanguage,
  );

  // One-shot hydration of session settings from the server record, filling
  // anything the navigation state didn't explicitly carry. Covers rejoin from
  // the sessions list (which passes partial hardcoded connectData) and browser
  // refresh mid-session (which loses location.state entirely).
  const settingsHydratedRef = useRef(false);
  useEffect(() => {
    if (!id || settingsHydratedRef.current) return;
    settingsHydratedRef.current = true;
    const nav = location.state?.connectData ?? {};
    getAuthHeaders()
      .then((authHeaders) =>
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/session/${id}`, { headers: authHeaders }),
      )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const sessionData = data.data ?? data;
        if (
          typeof nav.autoGenerateResponse !== "boolean" &&
          typeof sessionData.autoGenerateResponse === "boolean"
        ) {
          setAutoGenerateResponse(sessionData.autoGenerateResponse);
        }
        if (
          typeof nav.simpleLanguage !== "boolean" &&
          typeof sessionData.simpleLanguage === "boolean"
        ) {
          setSessionSimpleLanguage(sessionData.simpleLanguage);
        }
        if (!nav.language && typeof sessionData.language === "string" && sessionData.language) {
          setSelectedLanguage(sessionData.language);
        }
        // Model priority stays nav > stored preference > default; the saved
        // session model only fills in when neither of those is present/valid.
        const storedModel = localStorage.getItem(PREFERRED_MODEL_KEY);
        const navModelValid = nav.aiModel && AVAILABLE_MODELS.includes(nav.aiModel);
        const storedValid = storedModel && AVAILABLE_MODELS.includes(storedModel);
        if (
          !navModelValid &&
          !storedValid &&
          typeof sessionData.aiModel === "string" &&
          AVAILABLE_MODELS.includes(sessionData.aiModel)
        ) {
          setSelectedModel(sessionData.aiModel);
        }
      })
      .catch(() => {
        // Best-effort: on failure keep nav/default seeds.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Comprehensive cleanup on unmount ──────────────────────────────────────
  // Each transcription hook (useDeepgram, useNativeTabTranscription) has its own
  // cleanup effect that calls stopTranscription(). We don't duplicate that here.
  // The parent only cleans up screen stream and internal refs.
  useEffect(() => {
    return () => {
      const preserveFloatingSession = isTauri() && !!sessionStorage.getItem("hireshade.session-init");
      if (!preserveFloatingSession) {
        void audioControllerRef.current.destroyAudioSession("component_unmount");
      } else if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] componentUnmountPreservedForFloatingSession", {
          reason: "component_unmount_hmr_or_hidden_main",
        });
      }
      // Stop screen share stream (not handled by hooks)
      try {
        if (stream) {
          stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (e) {
              console.warn("Error stopping screen track on unmount:", e);
            }
          });
        }
      } catch (err) {
        console.warn("Error stopping screen stream on unmount:", err);
      }

      // Clear pending timers and refs (not handled by hooks)
      try {
        pendingTranscriptRef.current = [];
        stabilizerRef.current?.destroy();
        stabilizerRef.current = null;
        previousAutoContextRef.current = null;
      } catch (err) {
        console.warn("Error clearing refs on unmount:", err);
      }
    };
    // Empty dependency array ensures this only runs on unmount
  }, []);

  // ── Screen stream cleanup on stream change ──────────────────────────────────
  // When user picks a new tab/screen, the old stream's tracks should stop.
  // This is separate from the unmount cleanup to handle mid-session stream changes.
  useEffect(() => {
    return () => {
      // This cleanup runs when the component unmounts OR when 'stream' changes
      // If stream changes (user picked a new tab), the old stream is cleaned up
      // by the useScreenShare hook, so this is just a safety measure.
      if (stream) {
        stream.getTracks().forEach((track) => {
          try {
            if (track.readyState === 'live') {
              track.stop();
            }
          } catch (e) {
            console.warn("Error stopping screen track in stream cleanup:", e);
          }
        });
      }
    };
  }, [stream]);


  // Monotonic sequence + per-source dedup memory.
  // - `transcriptSeqRef` provides a strict ordering stamp on every accepted
  //   transcript chunk. Useful for replay safety and downstream consumers.
  // - `recentChunksRef` remembers the last ~20 normalized chunks per source
  //   with their timestamp so duplicate websocket events / replays / Deepgram
  //   re-emits cannot create double entries even outside the cross-source
  //   echo window below.
  const transcriptSeqRef = useRef(0);
  const recentChunksRef = useRef<{ key: string; t: number }[]>([]);

  // ── Interviewer-chunk debouncing (auto-answer pipeline) ───────────────────
  // Speech-to-text emits each spoken sentence as its own `isFinal: true`
  // chunk. A scenario-style prompt ("Your company is building... Suddenly...
  // API time spiked... How would you fix it?") arrives as 6-10 separate
  // chunks within ~5-10 seconds. If we fire the AI on every chunk we get:
  //   (a) 8 redundant AI calls + 8 cards in the UI for ONE question
  //   (b) early calls only see a fragment ("Suddenly,") and answer nonsense
  //   (c) wasted credits
  //
  // Strategy: buffer interviewer chunks; reset a 1.8 s silence timer on each
  // new chunk; when the timer fires (no speech for 1.8 s), treat the whole
  // joined buffer as a single transcript and run segmentQuestions on it.
  // This naturally merges scenario fragments into one AI call while still
  // producing one AI call per question for genuinely separate spoken
  // questions (since speakers pause >1.8 s between distinct topics).
  const pendingTranscriptRef = useRef<string[]>([]);
  const recentAutoQuestionsRef = useRef<Array<{ q: string; t: number }>>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const systemInterimCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSystemInterimRef = useRef("");
  const DEBOUNCE_MS = 1200;

  // Stabilizer-based auto-answer pipeline
  const stabilizerRef = useRef<ReturnType<typeof createTranscriptStabilizer> | null>(null);
  const previousAutoContextRef = useRef<{ transcript: string; timestamp: number } | null>(null);

  // Clear any pending debounce timer and refs on unmount (also covered by
  // comprehensive cleanup above, but kept for clarity of intent).
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (systemInterimCommitTimerRef.current) {
        clearTimeout(systemInterimCommitTimerRef.current);
        systemInterimCommitTimerRef.current = null;
      }
      Object.values(patchPersistTimersRef.current).forEach((timer) =>
        clearTimeout(timer),
      );
      patchPersistTimersRef.current = {};
    };
  }, []);

  const handleTranscript = useCallback(
    (sender: "User" | "Interviewer", text: string, isFinal: boolean) => {
      const normalizedText = normalizeSttTranscript(text || "");
      if (isFinal && normalizedText.trim()) {
        const now = Date.now();
        console.log(`[Transcript Final Input] ${sender}: ${normalizedText}`);
        setMessages((prev) => {
          let cleanText = deduplicatePhrases(normalizedText);
          // removeOverlap is only meaningful for the Interviewer (tab/system audio)
          // path where Deepgram streams overlapping context windows. Applying it
          // to User (mic) transcription strips valid words that happen to match
          // the end of the previous message, silently dropping mic utterances.
          if (sender === "Interviewer") {
            const lastSameSenderMsg = [...prev].reverse().find((m) => m.sender === sender);
            if (lastSameSenderMsg) {
              cleanText = removeOverlap(lastSameSenderMsg.text, cleanText);
            }
          }
          cleanText = cleanText.trim();
          if (!cleanText) {
            console.log(`[Dedupe] Empty after overlap removal from ${sender}: "${normalizedText}"`);
            return prev;
          }

          // Filter tiny filler-only interviewer finals to improve transcript quality.
          if (
            sender === "Interviewer" &&
            cleanText.split(/\s+/).length <= 6 &&
            isFillerPhrase(cleanText)
          ) {
            console.log(`[Transcript] Skipped filler-only interviewer chunk: "${cleanText}"`);
            return prev;
          }

          const normalizedNew = normalizeLineForDedup(cleanText);
          const ownKey = `${sender}::${normalizedNew}`;

          // ── Pass 1: same-source replay/duplicate within 5s ────────────
          // Catches Deepgram re-emitting the same final, websocket reconnect replays.
          // IMPORTANT: Only suppress if ALREADY in current state. This prevents
          // React StrictMode double-renders from suppressing valid new messages.
          // StrictMode renders the component twice in dev; the second render with
          // the same input should add the message, not suppress it.
          const sameSenderDedupeWindow =
            sender === "Interviewer"
              ? SYSTEM_FINAL_RECONCILE_WINDOW_MS
              : NEAR_DUPLICATE_GAP_MS;
          let sameSenderNearIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const m = prev[i];
            if (m.sender !== sender) continue;
            if (!m.timestamp || now - m.timestamp > sameSenderDedupeWindow) continue;
            if (areNearDuplicateTexts(m.text, cleanText)) {
              sameSenderNearIdx = i;
              break;
            }
          }

          if (sameSenderNearIdx >= 0) {
            const prevMsg = prev[sameSenderNearIdx];
            if (cleanText.length > prevMsg.text.length) {
              const next = [...prev];
              next[sameSenderNearIdx] = {
                ...prevMsg,
                text: cleanText,
                time: new Date().toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                timestamp: now,
              };
              return next;
            }
            console.log(`[Dedup-self] Suppressed replay from ${sender}: "${cleanText}"`);
            return prev;
          }

          // Track in ref for future dedup, but don't use it to suppress messages
          // that aren't already in state.
          const recent = recentChunksRef.current.filter((c) => now - c.t < 5000);
          recentChunksRef.current = [...recent, { key: ownKey, t: now }].slice(-20);

          // ── Pass 2: cross-source echo within 2s (mic ↔ tab audio) ─────
          const isEcho = prev.some((m) => {
            if (m.sender === sender) return false;
            if (!m.timestamp || now - m.timestamp > NEAR_DUPLICATE_GAP_MS) return false;
            return areNearDuplicateTexts(m.text, cleanText);
          });

          if (isEcho) {
            console.log(`[Dedupe] Suppressed echo from ${sender}: "${cleanText}"`);
            return prev;
          }

          // Stable, content-derived id — same chunk replayed across renders
          // produces the same id, so React keys never accidentally split a
          // single utterance into two list items.
          const seq = ++transcriptSeqRef.current;
          const stableId = `t-${seq}-${sender[0]}-${normalizedNew.slice(0, 24)}`;

          const newMsg: Message = {
            id: stableId,
            sender,
            text: cleanText,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: now,
          };

          // Save to backend — skip entirely for ephemeral sessions, and skip under Tauri
          // because the mini window (useFloatingSession) handles DB persistence for Tauri.
          if (saveTranscriptEnabled && !isTauri()) {
            getAuthHeaders().then((authHeaders) =>
              fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/session/${id}/save-message`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...authHeaders },
                  body: JSON.stringify({
                    messageId: newMsg.id,
                    role: sender === "User" ? "USER" : "INTERVIEWER",
                    question: cleanText,
                    answer: "",
                    time: newMsg.time,
                  }),
                },
              ),
            ).catch((err) =>
              console.error("Failed to save transcript segment:", err),
            );
          }

          // Auto-answer: when the user opted in during session setup, each
          // finalised Interviewer chunk is buffered. The AI call fires only
          // after DEBOUNCE_MS of silence so multi-sentence scenarios
          // ("Your company is building... Suddenly... How would you fix it?")
          // arrive as ONE coherent prompt instead of 8 fragmented calls.
          //
          // Multi-question handling: once the silence window elapses, the
          // joined buffer is segmented using segmentQuestions(); each truly
          // distinct question (numbered list, '?'-terminated sequence, or
          // word-numbered list) gets its own AI call with a small stagger.
          if (sender === "Interviewer" && autoGenerateResponse && id) {
            pendingTranscriptRef.current.push(cleanText);
            const joined = pendingTranscriptRef.current.join(" ").trim();
            stabilizerRef.current?.feed(joined);
          }

          return [...prev, newMsg];
        });
      }
    },
    [id, autoGenerateResponse, saveTranscriptEnabled],
  );

  const persistPatchedTranscript = useCallback(
    (message: Message, patchedText: string) => {
      if (!id || !saveTranscriptEnabled) return;
      getAuthHeaders().then((authHeaders) =>
        fetch(`${import.meta.env.VITE_BACKEND_URL}/api/session/${id}/transcript/${message.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            patchedText,
            originalText: message.originalText || message.text,
            patchedAt: new Date().toISOString(),
            patchedByUser: true,
            sender: message.sender,
            timestamp: message.timestamp,
          }),
        }),
      ).catch((err) => console.error("Failed to patch transcript segment:", err));
    },
    [id, saveTranscriptEnabled],
  );

  const onPatchMessage = useCallback(
    (messageId: string, patchedText: string) => {
      const trimmed = patchedText.trim();
      if (!trimmed) return;
      let targetMessage: Message | undefined;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          targetMessage = m;
          return {
            ...m,
            originalText: m.originalText ?? m.text,
            patchedText: trimmed,
            patchedAt: Date.now(),
            patchedByUser: true,
            text: trimmed,
          };
        }),
      );
      if (!saveTranscriptEnabled || !targetMessage) return;
      if (patchPersistTimersRef.current[messageId]) {
        clearTimeout(patchPersistTimersRef.current[messageId]);
      }
      patchPersistTimersRef.current[messageId] = setTimeout(() => {
        persistPatchedTranscript(targetMessage as Message, trimmed);
        delete patchPersistTimersRef.current[messageId];
      }, 800);
    },
    [persistPatchedTranscript, saveTranscriptEnabled],
  );

  const onUserTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      handleTranscript("User", text, isFinal);
    },
    [handleTranscript],
  );

  const clearSystemInterimCommitTimer = useCallback(() => {
    if (systemInterimCommitTimerRef.current) {
      clearTimeout(systemInterimCommitTimerRef.current);
      systemInterimCommitTimerRef.current = null;
    }
  }, []);

  const scheduleSystemInterimCommit = useCallback(
    (text: string) => {
      const trimmed = normalizeSttTranscript(text || "").trim();
      if (!trimmed) return;
      latestSystemInterimRef.current = trimmed;
      clearSystemInterimCommitTimer();
      systemInterimCommitTimerRef.current = setTimeout(() => {
        systemInterimCommitTimerRef.current = null;
        const latest = latestSystemInterimRef.current.trim();
        if (!latest) return;
        latestSystemInterimRef.current = "";
        handleTranscript("Interviewer", latest, true);
      }, SYSTEM_INTERIM_COMMIT_MS);
    },
    [clearSystemInterimCommitTimer, handleTranscript],
  );

  const onInterviewerTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      if (isFinal) {
        clearSystemInterimCommitTimer();
        latestSystemInterimRef.current = "";
        handleTranscript("Interviewer", text, true);
        return;
      }
      scheduleSystemInterimCommit(text);
    },
    [clearSystemInterimCommitTimer, handleTranscript, scheduleSystemInterimCommit],
  );

  const micTranscription = useDeepgram({
    apiKey: "", // minted server-side via resolveDeepgramKey; never bundled
    model: "nova-3",
    language: getLanguageCode(selectedLanguage),
    keyterms: deepgramKeyterms,
    onTranscript: onUserTranscript,
  });

  const currentMicDevice = micTranscription.currentDeviceLabel;

  // Display audio transcription: SCKit (Rust) ─► localhost WS ─► Deepgram WS
  // Captures the primary display's system audio directly via ScreenCaptureKit,
  // so YouTube/tab audio is transcribed — not the microphone.
  // SCKit works independently of getDisplayMedia — no need to wait for stream.
  const tabTranscription = useNativeTabTranscription({
    apiKey: "", // minted server-side via resolveDeepgramKey; never bundled
    model: "nova-3",
    language: getLanguageCode(selectedLanguage),
    onTranscript: onInterviewerTranscript,
    enabled: !isConnectDialogOpen && !isTauri(),
  });

  // ── Browser tab audio transcription (getDisplayMedia path) ────────────────
  // When the user shares a tab/window with "Also share tab audio" / "Include
  // audio" enabled, the MediaStream contains audio tracks.  We pipe those
  // directly into a second Deepgram instance so the Interviewer side of the
  // transcript is populated even without the macOS SCKit backend.
  const streamHasAudio = !!stream && stream.getAudioTracks().length > 0;

  const tabAudioTranscription = useDeepgram({
    apiKey: "", // minted server-side via resolveDeepgramKey; never bundled
    model: "nova-3",
    language: getLanguageCode(selectedLanguage),
    keyterms: deepgramKeyterms,
    onTranscript: onInterviewerTranscript,
    inputStream: streamHasAudio ? stream : null,
  });

  stopWebMicRef.current = () => {
    micTranscription.stopTranscription();
  };
  stopWebSystemRef.current = () => {
    tabTranscription.stopTranscription();
    tabAudioTranscription.stopTranscription();
  };

  // Auto-start / stop browser tab audio transcription based on stream audio
  useEffect(() => {
    if (isTauri()) return;
    if (streamHasAudio) {
      tabAudioTranscription.startTranscription();
    } else {
      tabAudioTranscription.stopTranscription();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamHasAudio]);

  // Surface cpal errors as toasts
  useEffect(() => {
    if (isTauri()) return;
    if (tabTranscription.error) toast.error(tabTranscription.error);
  }, [tabTranscription.error]);

  // Surface browser tab audio errors as toasts
  useEffect(() => {
    if (tabAudioTranscription.error) toast.error(tabAudioTranscription.error);
  }, [tabAudioTranscription.error]);

  // Tauri STT states
  const [tauriMicActive, setTauriMicActive] = useState(false);
  const [tauriMicConnecting, setTauriMicConnecting] = useState(false);
  const [tauriMicInterim, setTauriMicInterim] = useState("");

  const [tauriTabActive, setTauriTabActive] = useState(false);
  const [tauriTabConnecting, setTauriTabConnecting] = useState(false);
  const [tauriTabInterim, setTauriTabInterim] = useState("");
  const [tauriError, setTauriError] = useState<string | null>(null);

  // ── Unified transcription states (Tauri vs Web) ──────────────────────────
  const isMicTranscribing = isTauri() ? tauriMicActive : micTranscription.isTranscribing;
  const isMicConnectingState = isTauri() ? tauriMicConnecting : micTranscription.isConnecting;
  const activeMicInterimTranscript = isTauri() ? tauriMicInterim : micTranscription.interimTranscript;

  const mergedTabIsTranscribing = isTauri()
    ? tauriTabActive
    : (tabTranscription.isTranscribing || tabAudioTranscription.isTranscribing);
  const mergedTabIsConnecting = isTauri()
    ? tauriTabConnecting
    : (tabTranscription.isConnecting || tabAudioTranscription.isConnecting);
  const mergedTabInterimTranscript = isTauri()
    ? tauriTabInterim
    : (tabTranscription.interimTranscript || tabAudioTranscription.interimTranscript);
  const mergedTabError = isTauri()
    ? tauriError
    : (tabTranscription.error || tabAudioTranscription.error);

  const onUserTranscriptRef = useRef(onUserTranscript);
  const onInterviewerTranscriptRef = useRef(onInterviewerTranscript);

  useEffect(() => {
    onUserTranscriptRef.current = onUserTranscript;
  }, [onUserTranscript]);

  useEffect(() => {
    onInterviewerTranscriptRef.current = onInterviewerTranscript;
  }, [onInterviewerTranscript]);

  // Tauri STT listeners
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenMicTx: (() => void) | undefined;
    let unlistenMicSt: (() => void) | undefined;
    let unlistenSysTx: (() => void) | undefined;
    let unlistenSysSt: (() => void) | undefined;

    // Mic transcript listener
    listen<{ text: string; is_final: boolean }>("stt:mic", (event) => {
      const { text, is_final } = event.payload;
      const normalizedText = normalizeSttTranscript(text || "");
      if (is_final) {
        setTauriMicInterim("");
        onUserTranscriptRef.current(normalizedText, true);
      } else {
        setTauriMicInterim(normalizedText);
      }
    }).then((fn) => { unlistenMicTx = fn; }).catch(() => {});

    // Mic status listener
    listen<{ status: string; error?: string }>("stt:status:mic", (event) => {
      const { status, error } = event.payload;
      if (status === "transcribing") {
        setTauriMicActive(true);
        setTauriMicConnecting(false);
      } else if (status === "connecting") {
        setTauriMicConnecting(true);
      } else {
        setTauriMicActive(false);
        setTauriMicConnecting(false);
      }
      if (status === "error" && error) {
        setTauriError(error);
        toast.error(`Mic: ${error}`);
      } else if (status === "transcribing") {
        setTauriError(null);
      }
    }).then((fn) => { unlistenMicSt = fn; }).catch(() => {});

    // System audio transcript listener
    listen<{ text: string; is_final: boolean }>("stt:system-audio", (event) => {
      const { text, is_final } = event.payload;
      const normalizedText = normalizeSttTranscript(text || "");
      if (is_final) {
        setTauriTabInterim("");
        onInterviewerTranscriptRef.current(normalizedText, true);
      } else {
        setTauriTabInterim(normalizedText);
        onInterviewerTranscriptRef.current(normalizedText, false);
      }
    }).then((fn) => { unlistenSysTx = fn; }).catch(() => {});

    // System audio status listener
    listen<{ status: string; error?: string }>("stt:status:system", (event) => {
      const { status, error } = event.payload;
      if (status === "transcribing") {
        setTauriTabActive(true);
        setTauriTabConnecting(false);
      } else if (status === "connecting") {
        setTauriTabConnecting(true);
      } else {
        setTauriTabActive(false);
        setTauriTabConnecting(false);
      }
      if (status === "error" && error) {
        setTauriError(error);
        toast.error(`System Audio: ${error}`);
      } else if (status === "transcribing") {
        setTauriError(null);
      }
    }).then((fn) => { unlistenSysSt = fn; }).catch(() => {});

    return () => {
      unlistenMicTx?.();
      unlistenMicSt?.();
      unlistenSysTx?.();
      unlistenSysSt?.();
    };
  }, []);

  const toggleTauriOrBrowserMic = useCallback(async () => {
    if (isTauri()) {
      if (tauriMicActive || tauriMicConnecting) {
        await audioControllerRef.current.stopAudioSession("mic", "mic_toggle_off");
        setTauriMicActive(false);
        setTauriMicConnecting(false);
        setTauriMicInterim("");
      } else {
        audioControllerRef.current.startAudioSession("mic", "mic_toggle_on");
        setTauriMicConnecting(true);
        try {
          await invoke("start_mic_transcription", {
            language: getLanguageCode(selectedLanguage),
            model: "nova-3",
            keyterms: deepgramKeyterms,
            apiKey: await resolveDeepgramKey(),
          });
        } catch (e) {
          toast.error(`Mic: ${String(e)}`);
          setTauriMicConnecting(false);
        }
      }
    } else {
      if (micTranscription.isTranscribing) {
        await audioControllerRef.current.stopAudioSession("mic", "mic_toggle_off");
      } else {
        audioControllerRef.current.startAudioSession("mic", "mic_toggle_on");
        micTranscription.startTranscription();
      }
    }
  }, [deepgramKeyterms, selectedLanguage, tauriMicActive, tauriMicConnecting, micTranscription]);

  const {
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
  } = useAIChat();
  const lastInteractedAiMessageIdRef = useRef<string | null>(null);
  const onAiMessageInteract = useCallback((messageId: string) => {
    if (!messageId) return;
    lastInteractedAiMessageIdRef.current = messageId;
  }, []);

  // Wire handleAiAnswer into the stable ref so handleTranscript can call it.
  handleAiAnswerRef.current = handleAiAnswer;

  // Mutable refs kept fresh every render so handleStableTranscript can read
  // the latest messages/aiChat without stale closure issues.
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const aiChatRef = useRef<Message[]>(aiChat);
  aiChatRef.current = aiChat;

  // Stable ref for handleStableTranscript so the stabilizer callback always
  // invokes the latest version without recreating the stabilizer instance.
  const handleStableTranscriptRef = useRef<((t: string) => void) | null>(null);

  const handleStableTranscript = useCallback((stableTranscript: string) => {
    if (!id || !handleAiAnswer) return;

    // Check continuation — if within 8s of previous, check if it's a follow-up
    // ("Why?", "How did you solve it?", "Why Spark?"). When detected, the
    // current chunk is merged onto the previous auto-answer context so the
    // follow-up is answered WITH its antecedent question's context, instead
    // of being classified/segmented in isolation.
    //
    // Previously this merge was computed and only logged — `stableTranscript`
    // (unmerged) was what actually flowed into classification/segmentation/
    // generation below, so genuine follow-ups never inherited prior context.
    let effectiveTranscript = stableTranscript;
    if (previousAutoContextRef.current) {
      const timeDelta = Date.now() - previousAutoContextRef.current.timestamp;
      if (
        isContinuationOfPreviousQuestion(
          stableTranscript,
          previousAutoContextRef.current.transcript,
          timeDelta,
        )
      ) {
        effectiveTranscript = `${previousAutoContextRef.current.transcript} ${stableTranscript}`
          .replace(/\s+/g, " ")
          .trim();
        // eslint-disable-next-line no-console
        console.log(
          "[AutoAnswer] Continuation detected, merged:",
          effectiveTranscript.slice(0, 80),
        );
      }
    }

    // Get classification with previous context for continuation detection
    const classification = classifyTranscript(
      effectiveTranscript,
      previousAutoContextRef.current?.transcript,
    );

    // Prevent auto-generation from overlapping manual generation.
    // Manual button/shortcut flows set `isExecutingRef` while triggering AI.
    // The stabilizer can fire within the freeze window (<= 1.2s),
    // which previously caused duplicate cards for the same input.
    if (isExecutingRef.current) {
      console.log("[AutoAnswer] Suppressed due to manual AI execution in progress");
      pendingTranscriptRef.current = [];
      return;
    }

    // Use shouldTriggerGeneration to decide
    const triggerResult = shouldTriggerGeneration({
      transcript: effectiveTranscript,
      isStable: true,
      classification,
      lastGenerationTimestamp: previousAutoContextRef.current?.timestamp ?? 0,
      recentQuestions: recentAutoQuestionsRef.current,
    });


    if (!triggerResult.trigger) {
      // eslint-disable-next-line no-console
      console.log("[AutoAnswer] Skipped:", triggerResult.reason);
      return;
    }

    // Build adaptive context from latest transcript/AI state (same as manual
    // path) so currentQuestion is properly extracted rather than being the raw
    // stable blob. Uses refs so the callback does not go stale.
    const adaptiveCtx = buildAdaptiveAiContext({
      transcriptMessages: messagesRef.current
        .filter(
          (m) =>
            (m.sender === "Interviewer" || m.sender === "User") && !!m.text?.trim(),
        )
        .map((m) => ({
          sender: m.sender as "User" | "Interviewer",
          text: m.text.trim(),
          timestamp: m.timestamp,
        })),
      aiMessages: aiChatRef.current
        .filter((m) => m.sender === "AI")
        .map((m) => ({
          sender: "AI" as const,
          text: m.text,
          question: m.question,
        })),
      liveInterimQuestion: effectiveTranscript,
    });

    const segmentedQuestions = segmentQuestions(effectiveTranscript);
    const segmentsToGenerate =
      segmentedQuestions.length >= 2
        ? segmentedQuestions
        : classification.shouldGroup
          ? [effectiveTranscript]
          : classification.segments;

    // Route based on segmentation/classification
    if (segmentsToGenerate.length === 1) {
      // Grouped scenario: ONE call with full transcript
      handleAiAnswer(
        id,
        {
          transcript: effectiveTranscript,
          currentQuestion: adaptiveCtx.currentQuestion || effectiveTranscript,
          recentTranscriptWindow: adaptiveCtx.recentTranscriptWindow,
          speakerSeparatedTranscript: adaptiveCtx.speakerSeparatedTranscript,
          previousAiAnswers: adaptiveCtx.previousAiAnswers,
          sourcePlatform: isTauri() ? "tauri" : "web",
          answerMode: "auto",
          triggerSource: "auto",
        },
        selectedModel,
      );
      recentAutoQuestionsRef.current = [
        ...recentAutoQuestionsRef.current.filter((entry) => Date.now() - entry.t < 10_000),
        { q: effectiveTranscript, t: Date.now() },
      ].slice(-20);
    } else {
      // Independent questions: call for each segment with stagger.
      // Each segment is its own isolated question so it becomes currentQuestion.
      segmentsToGenerate.forEach((segment, index) => {
        setTimeout(() => {
          handleAiAnswer(
            id,
            {
              transcript: segment,
              currentQuestion: segment,
              recentTranscriptWindow: adaptiveCtx.recentTranscriptWindow,
              speakerSeparatedTranscript: adaptiveCtx.speakerSeparatedTranscript,
              previousAiAnswers: adaptiveCtx.previousAiAnswers,
              sourcePlatform: isTauri() ? "tauri" : "web",
              answerMode: "auto",
              triggerSource: "auto",
            },
            selectedModel,
          );
          recentAutoQuestionsRef.current = [
            ...recentAutoQuestionsRef.current.filter((entry) => Date.now() - entry.t < 10_000),
            { q: segment, t: Date.now() },
          ].slice(-20);
        }, index * 500);
      });
    }

    // Clear the pending buffer so the next batch starts fresh
    pendingTranscriptRef.current = [];

    // Update previous context for continuation detection
    previousAutoContextRef.current = {
      transcript: effectiveTranscript,
      timestamp: Date.now(),
    };
  }, [id, selectedModel, handleAiAnswer]);

  handleStableTranscriptRef.current = handleStableTranscript;

  // Initialize stabilizer with an 1800ms freeze window. 1200ms was too short
  // for dictated multi-clause questions: STT delivers clauses in bursts with
  // sub-1.2s gaps, so the window elapsed mid-question and fired on a fragment
  // (producing duplicate/partial answers). 1800ms waits for a real pause while
  // staying responsive.
  useEffect(() => {
    if (!stabilizerRef.current) {
      stabilizerRef.current = createTranscriptStabilizer(
        (stableSnapshot) => {
          handleStableTranscriptRef.current?.(stableSnapshot);
        },
        { freezeWindowMs: 1800 },
      );
    }
    return () => {
      stabilizerRef.current?.destroy();
      stabilizerRef.current = null;
    };
  }, []);

  // Restore persisted transcript + AI answers on mount (survives refresh / back-nav).
  // Skipped entirely for ephemeral sessions — nothing should be restored.
  const historyLoadedRef = useRef(false);

  // Status-aware redirect: if a user lands on /sessions/:id for a session that
  // has already ended (COMPLETED, ABANDONED, FORCE_ENDED, AUTO_ENDED,
  // CREDIT_EXHAUSTED, COMPLETING), bounce them to the sessions list with the
  // transcript dialog auto-opened. The fresh-creation flow sets
  // location.state.showConnect=true, so we never redirect in that case.
  const statusCheckRef = useRef(false);
  useEffect(() => {
    if (!id || statusCheckRef.current) return;
    if (location.state?.showConnect) return;
    statusCheckRef.current = true;

    const LIVE_STATUSES = new Set(["ACTIVE", "PAUSED", "DISCONNECTED", "PRE_CHECK"]);
    getAuthHeaders()
      .then((authHeaders) => fetch(`${import.meta.env.VITE_BACKEND_URL}/api/session/${id}`, { headers: authHeaders }))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const sessionData = data.data ?? data;
        const status = sessionData?.status;
        if (status && !LIVE_STATUSES.has(String(status).toUpperCase())) {
          navigate(`/sessions?view=${id}`, { replace: true });
        }
      })
      .catch(() => {
        // Best-effort — if the status probe fails, fall through to normal flow.
      });
  }, [id, location.state?.showConnect, navigate]);

  useEffect(() => {
    if (!id || historyLoadedRef.current) return;
    // Ephemeral mode: the backend returns empty messages/transcript and the user
    // never expects data to survive a reload, so skip the restore fetch entirely.
    if (!saveTranscriptEnabled) return;
    historyLoadedRef.current = true;

    getAuthHeaders()
      .then((authHeaders) => fetch(`${import.meta.env.VITE_BACKEND_URL}/api/session/${id}`, { headers: authHeaders }))
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const sessionData = data.data ?? data;
        const storedMessages: any[] = Array.isArray(sessionData.messages) ? sessionData.messages : [];
        if (storedMessages.length === 0) return;

        const transcriptMsgs: Message[] = [];
        const aiMsgs: Message[] = [];

        storedMessages.forEach((m: any, i: number) => {
          const time = m.time || new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          if (m.role === "AI_ASSISTANT") {
            // AI answer — show the answer text; store original question for regeneration
            const text = m.answer || m.question || "";
            if (text) {
              aiMsgs.push({
                id: `hist-ai-${i}`,
                sender: "AI",
                text,
                time,
                // Restore the original question so Regenerate works on history entries too.
                question: m.question || "",
                snapshotId: m.snapshotId,
              });
            }
          } else {
            // USER or INTERVIEWER transcript line
            const sender = m.role === "USER" ? "User" : "Interviewer";
            const text = m.patchedText || m.question || "";
            if (text) {
              transcriptMsgs.push({
                id: m.messageId || `hist-${i}`,
                sender,
                text,
                time,
                timestamp: m.timestamp ? new Date(m.timestamp).getTime() : undefined,
                originalText: m.originalText || undefined,
                patchedText: m.patchedText || undefined,
                patchedAt: m.patchedAt ? new Date(m.patchedAt).getTime() : undefined,
                patchedByUser: m.patchedByUser === true,
              });
            }
          }
        });

        if (transcriptMsgs.length > 0) setMessages(transcriptMsgs);
        if (aiMsgs.length > 0) setAiChat(aiMsgs);
      })
      .catch((err) => console.error("[Session] Failed to restore history:", err));
  }, [id, setAiChat]);

  const isExecutingRef = useRef(false);

  const onAnalyzeScreen = useCallback(
    async (payload?: any) => {
      if (isExecutingRef.current || !id) return;
      isExecutingRef.current = true;
      let tempStream: MediaStream | null = null;
      let tempVideo: HTMLVideoElement | null = null;
      let nativeCaptureOverlayHidden = false;
      try {
        if (import.meta.env.DEV) {
          console.warn("[audio-lifecycle] analyzeScreenCaptureStarted");
        }
        let screenshot: Blob | null = null;

        if (payload?.screenshotData) {
          const base64Data = payload.screenshotData.split(",")[1];
          const contentType = payload.screenshotData
            .split(",")[0]
            .split(":")[1]
            .split(";")[0];
          const byteCharacters = atob(base64Data);
          const byteArrays = [];

          for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              byteNumbers[i] = slice.charCodeAt(i);
            }
            byteArrays.push(new Uint8Array(byteNumbers));
          }

          screenshot = new Blob(byteArrays, { type: contentType });
          if (import.meta.env.DEV && screenshot) {
            console.warn("[audio-lifecycle] screenshotCaptured", {
              captureMethod: "overlayPayload",
              screenshotSize: screenshot.size,
            });
          }
        } else if (isTauri()) {
          if (import.meta.env.DEV) {
            console.warn("[audio-lifecycle] captureMethod", { method: "native" });
          }
          try {
            nativeCaptureOverlayHidden = true;
            await invoke("toggle_content_protection", { protected: true });
            await new Promise((resolve) => setTimeout(resolve, 150));
            const screenshotData = await invoke<string>("capture_screen");
            const base64Data = screenshotData.split(",")[1];
            const contentType = screenshotData
              .split(",")[0]
              .split(":")[1]
              .split(";")[0];
            const byteCharacters = atob(base64Data);
            const byteArrays = [];
            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
              const slice = byteCharacters.slice(offset, offset + 512);
              const byteNumbers = new Array(slice.length);
              for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
              byteArrays.push(new Uint8Array(byteNumbers));
            }
            screenshot = new Blob(byteArrays, { type: contentType });
            if (import.meta.env.DEV && screenshot) {
              console.warn("[audio-lifecycle] screenshotCaptured", {
                captureMethod: "native",
                screenshotSize: screenshot.size,
                nativeCaptureOverlayHidden: true,
              });
            }
          } finally {
            if (nativeCaptureOverlayHidden) {
              await invoke("toggle_content_protection", { protected: false }).catch(() => {});
              nativeCaptureOverlayHidden = false;
            }
          }
        } else if (stream) {
          if (import.meta.env.DEV) {
            console.warn("[audio-lifecycle] captureMethod", { method: "existingStream" });
          }
          screenshot = await captureScreenshot();
          if (import.meta.env.DEV && screenshot) {
            console.warn("[audio-lifecycle] screenshotCaptured", {
              captureMethod: "existingStream",
              screenshotSize: screenshot.size,
            });
          }
        } else {
          if (import.meta.env.DEV) {
            console.warn("[audio-lifecycle] captureMethod", { method: "getDisplayMediaFallback" });
          }
          tempStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          tempVideo = document.createElement("video");
          tempVideo.srcObject = tempStream;
          await tempVideo.play();
          const canvas = document.createElement("canvas");
          canvas.width = tempVideo.videoWidth || 1920;
          canvas.height = tempVideo.videoHeight || 1080;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            screenshot = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, "image/png"),
            );
          }
          if (import.meta.env.DEV && screenshot) {
            console.warn("[audio-lifecycle] screenshotCaptured", {
              captureMethod: "getDisplayMediaFallback",
              screenshotSize: screenshot.size,
            });
          }
        }

        if (screenshot) {
          const adaptiveContext = buildAdaptiveAiContext({
            transcriptMessages: messages
              .filter(
                (m) =>
                  (m.sender === "Interviewer" || m.sender === "User") &&
                  !!m.text?.trim(),
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
            fallbackQuestion: "",
            liveInterimQuestion: mergedTabInterimTranscript || activeMicInterimTranscript || "",
          });
          await handleAnalyzeScreen(id, screenshot, selectedModel, {
            transcript:
              adaptiveContext.recentTranscriptWindow.length > 0
                ? adaptiveContext.recentTranscriptWindow.join("\n")
                : adaptiveContext.currentQuestion || "screen_analysis",
            ...(adaptiveContext.currentQuestion
              ? { currentQuestion: adaptiveContext.currentQuestion }
              : {}),
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
            ...(adaptiveContext.currentQuestion
              ? {
                  activeQuestionDetection: {
                    activeQuestion: adaptiveContext.currentQuestion,
                    cleanedQuestion: adaptiveContext.currentQuestion,
                    isFollowUp: false,
                    topicChanged: false,
                    confidenceScore: 1,
                    ignoredNoise: false,
                  },
                }
              : {}),
            sourcePlatform: isTauri() ? "tauri" : "web",
            answerMode: "auto",
          });
        } else {
          console.warn("No screenshot could be captured.");
        }
      } catch (err) {
        const msg = String(err);
        const isPermission =
          /denied|permission|not allowed|screen recording|notallowederror/i.test(msg);
        if (import.meta.env.DEV && isPermission) {
          console.warn("[audio-lifecycle] screenPermissionDenied", { error: msg });
        }
        // Spec §14: surface a clear error and let the session continue without
        // screen analysis. Previously this toast was gated behind isTauri(), so
        // WEB users whose getDisplayMedia was denied/cancelled saw nothing.
        if (isTauri()) {
          toast.error(
            isPermission
              ? "Screen Recording permission denied. Open Settings and retry — you may need to restart the app."
              : "Screen analysis failed. You can retry, or continue without it.",
          );
        } else {
          toast.error(
            isPermission
              ? "Screen share was denied or cancelled — screen analysis is unavailable for this session. The session continues normally."
              : "Screen analysis failed. You can retry, or continue the session without it.",
          );
        }
        console.error("Error analyzing screen:", err);
      } finally {
        if (tempStream) {
          tempStream.getTracks().forEach((track) => track.stop());
          if (import.meta.env.DEV) {
            console.warn("[audio-lifecycle] screenStreamTracksStopped");
          }
        }
        if (tempVideo) {
          tempVideo.pause();
          tempVideo.srcObject = null;
          tempVideo.remove();
        }
        if (nativeCaptureOverlayHidden) {
          await invoke("toggle_content_protection", { protected: false }).catch(() => {});
        }
        if (import.meta.env.DEV) {
          console.warn("[audio-lifecycle] analyzeScreenCaptureReleased");
        }
        setTimeout(() => {
          isExecutingRef.current = false;
        }, 1000);
      }
    },
    [
      stream,
      id,
      captureScreenshot,
      handleAnalyzeScreen,
      selectedModel,
      messages,
      aiChat,
      mergedTabInterimTranscript,
      activeMicInterimTranscript,
    ],
  );

  const onAiAnswer = useCallback(() => {
    if (isExecutingRef.current || !id) return;

    // Create an immutable transcript snapshot at the moment AI Answer is triggered.
    // This prevents race conditions where new transcript chunks arrive during
    // context extraction and contaminate the AI request context.
    const snapshotTimestamp = Date.now();
    const messagesSnapshot = [...messages];
    const micInterimSnapshot = normalizeSttTranscript(activeMicInterimTranscript || "");
    const tabInterimSnapshot = normalizeSttTranscript(mergedTabInterimTranscript || "");

    console.log("[AI Answer] Creating transcript snapshot at timestamp:", snapshotTimestamp);
    console.log("[AI Answer] Snapshot contains", messagesSnapshot.length, "messages");

    // Resolve the SPECIFIC question to answer from the immutable snapshot.
    // Priority: live interim Interviewer text → last final Interviewer message.
    // Sending only the specific question (not the whole transcript blob) ensures
    // the AI answers THIS question instead of fixating on whatever was last in a
    // 50-message concatenated dump.  The backend fetches full session history from
    // DB for context, so nothing is lost.
    const interimText = micInterimSnapshot || tabInterimSnapshot;

    const interviewerInterim =
      !micInterimSnapshot && tabInterimSnapshot
        ? tabInterimSnapshot
        : null;

    let question = "";
    let questionSource = "";
    const CONTEXT_WINDOW_MS = 60000; // 60 second window for recent context

    if (isTauri()) {
      const lastInterviewer = [...messagesSnapshot]
        .reverse()
        .find((m) => m.sender === "Interviewer" && m.text?.trim())?.text;
      const lastAny = [...messagesSnapshot]
        .reverse()
        .find((m) => m.text?.trim())?.text;
      // Prefer the live (not-yet-final) interviewer speech; fall back to the last
      // finalised Interviewer message in the transcript; fall back to the last
      // finalised message of any sender; fall back to any live interim text.
      question =
        interviewerInterim ||
        lastInterviewer ||
        lastAny ||
        interimText ||
        "";
      questionSource = interviewerInterim
        ? "interviewer_interim"
        : lastInterviewer
          ? "last_interviewer"
          : "fallback";
    } else {
      // For web/browser context, both the user voice input and processed transcript/context
      // should be included together so the AI can correctly understand and answer the intended question.
      
      // Get user voice input from mic or recent messages (with strict timestamp window)
      const now = snapshotTimestamp;
      
      let userVoiceInput = micInterimSnapshot.trim() ||
        messagesSnapshot
          .filter((m) => m.sender === "User" && m.timestamp && now - m.timestamp < CONTEXT_WINDOW_MS)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]?.text ||
        "";
      userVoiceInput = normalizeSttTranscript(userVoiceInput);
      
      questionSource = userVoiceInput ? "user_interim" : "";

      // If the user voice input is just filler/noise, look for a more meaningful recent User message
      if (userVoiceInput && isFillerPhrase(userVoiceInput)) {
        console.log("[AI Answer] Detected filler phrase in user voice input:", userVoiceInput);
        // Look for a more meaningful User message within the context window
        const meaningfulUserMsg = messagesSnapshot
          .filter((m) => 
            m.sender === "User" && 
            m.timestamp && 
            now - m.timestamp < CONTEXT_WINDOW_MS &&
            !isFillerPhrase(m.text) &&
            m.text.trim().length > 5 // Require at least 5 characters
          )
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
        
        if (meaningfulUserMsg) {
          console.log("[AI Answer] Using meaningful user message instead:", meaningfulUserMsg.text);
          userVoiceInput = meaningfulUserMsg.text;
          questionSource = "meaningful_user";
        } else {
          // If no meaningful user message found, clear the filler input
          console.log("[AI Answer] No meaningful user message found in context window, clearing filler input");
          userVoiceInput = "";
          questionSource = "";
        }
      }

      // Get interviewer context with strict timestamp window
      const interviewerContext =
        interviewerInterim ||
        messagesSnapshot
          .filter((m) => m.sender === "Interviewer" && m.timestamp && now - m.timestamp < CONTEXT_WINDOW_MS)
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0]?.text ||
        "";
      const normalizedInterviewerContext = normalizeSttTranscript(interviewerContext);
      
      if (!questionSource && normalizedInterviewerContext) {
        questionSource = "interviewer_context";
      }

      if (userVoiceInput && normalizedInterviewerContext) {
        // Apply intent detection to clean up the user input
        const intentResult = detectIntent(userVoiceInput);
        const cleanedUserInput = intentResult.cleanedQuestion || userVoiceInput;
        question = cleanedUserInput;
      } else {
        question = userVoiceInput || normalizedInterviewerContext || interimText || "";
        if (!questionSource && question) {
          questionSource = "fallback_interim";
        }
      }
    }
    question = normalizeSttTranscript(question);

    const contextBuildStartedAt = Date.now();
    const recentMessages = messagesSnapshot
      .filter(
        (m) =>
          (m.sender === "Interviewer" || m.sender === "User") &&
          !!m.text?.trim(),
      )
      .map((m) => ({
        sender: m.sender as "User" | "Interviewer",
        text: m.text.trim(),
        timestamp: m.timestamp,
      }));
    if (!question) {
      question = recentMessages
        .slice(-20)
        .map((m) => m.text)
        .join(" ")
        .trim();
      questionSource = "raw_transcript_fallback";
      console.log("[AI Answer] No extracted question; sending raw transcript to backend composer");
    }

    console.log("[AI Answer] Question extracted from source:", questionSource);
    console.log("[AI Answer] Question content:", question.slice(0, 100));
    console.log("[AI Answer] Context window:", CONTEXT_WINDOW_MS, "ms");
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
      liveInterimQuestion: interviewerInterim || "",
      cutoffTimestamp: snapshotTimestamp - CONTEXT_WINDOW_MS,
    });
    const recentTranscriptWindow = adaptiveContext.recentTranscriptWindow;
    const speakerSeparatedTranscript = adaptiveContext.speakerSeparatedTranscript;
    const bestCurrentQuestion = adaptiveContext.currentQuestion || question;
    const transcriptText =
      recentTranscriptWindow.length > 0
        ? recentTranscriptWindow.join("\n")
        : bestCurrentQuestion;
    const selectedAiMessage = lastInteractedAiMessageIdRef.current
      ? aiChat.find(
          (m) =>
            m.id === lastInteractedAiMessageIdRef.current &&
            m.sender === "AI" &&
            !!m.text?.trim(),
        )
      : null;
    const selectedAnswerQuestion =
      selectedAiMessage?.question?.trim() ||
      selectedAiMessage?.questionMeta?.displayQuestion?.trim() ||
      "";
    const selectedAnswerText = selectedAiMessage?.text?.trim() || "";
    const selectedAnswerCodeBlocks =
      selectedAiMessage?.originalGenerationContext?.generatedCodeBlocks || [];
    const selectedAnswerTopic = selectedAiMessage?.questionMeta?.topic || "";
    const answerClickMode = selectedAiMessage
      ? "answer_followup"
      : "answer_latest_unanswered";
    const effectiveCurrentQuestion = bestCurrentQuestion;
    const activeDetection = detectActiveQuestion({
      liveInterimText: interviewerInterim || "",
      allMessages: messagesSnapshot
        .filter(
          (m) =>
            (m.sender === "User" || m.sender === "Interviewer") &&
            !!m.text?.trim(),
        )
        .map((m) => ({
          sender: m.sender as "User" | "Interviewer",
          text: m.text.trim(),
          timestamp: m.timestamp,
        })),
      cutoffTimestamp: snapshotTimestamp - CONTEXT_WINDOW_MS,
      selectedAnswerQuestion,
    });
    const effectiveDetection = {
      ...activeDetection,
      activeQuestion: bestCurrentQuestion,
      cleanedQuestion: effectiveCurrentQuestion,
      isFollowUp: activeDetection.isFollowUp,
    };
    const detectionHint =
      effectiveDetection.activeQuestion ||
      effectiveDetection.cleanedQuestion ||
      transcriptText.slice(-500);

    const payload: AIAnswerRequestPayload = {
      transcript: transcriptText,
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
      answerClickMode,
      ...(selectedAiMessage
        ? {
            selectedAnswerId: selectedAiMessage.id,
            ...(selectedAnswerQuestion
              ? { selectedAnswerQuestion }
              : {}),
            ...(selectedAnswerText
              ? { selectedAnswerText }
              : {}),
            ...(selectedAnswerCodeBlocks.length > 0
              ? { selectedAnswerCodeBlocks }
              : {}),
            ...(selectedAnswerTopic
              ? { selectedAnswerTopic }
              : {}),
          }
        : {}),
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
      triggerSource: "manual_click",
      sourcePlatform: isTauri() ? "tauri" : "web",
    };
    console.log("[AI Answer][Timing][FE][Web]", {
      sessionId: id,
      buildContextMs: Date.now() - contextBuildStartedAt,
      windowSizeUsed: adaptiveContext.windowSizeUsed,
      expandedReason: adaptiveContext.expandedReason,
      selectedContextSuppressed: true,
      suppressedReason: "normal_ai_answer_latest_transcript",
      activeQuestionDetectionIsFollowUp: effectiveDetection.isFollowUp,
    });

    isExecutingRef.current = true;
    try {
      console.log("[Trigger] AI Answer initiated for question:", question.slice(0, 80));
      handleAiAnswer(id, payload, selectedModel);
    } finally {
      setTimeout(() => {
        isExecutingRef.current = false;
      }, 1000);
    }
  }, [
    id,
    messages,
    aiChat,
    handleAiAnswer,
    activeMicInterimTranscript,
    mergedTabInterimTranscript,
    selectedModel,
  ]);

  const onRegenerate = useCallback(
    (messageId: string) => {
      if (!id) return;
      // The question is stored on the AI message object (set when handleAiAnswer
      // created it).  handleRegenerate looks it up internally — no need to
      // rebuild a transcript blob here.
      handleRegenerate(id, messageId, selectedModel);
    },
    [id, handleRegenerate, selectedModel],
  );

  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  const isOpeningOverlayRef = useRef(false);
  const lastMinimizeTriggerRef = useRef(0);
  const overlaySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOverlayPayloadRef = useRef("");

  const handleOpenOverlay = async () => {
    if (!isTauri() || isOpeningOverlayRef.current) return;
    isOpeningOverlayRef.current = true;

    try {
      if (import.meta.env.DEV) {
        console.log("[audio-lifecycle] overlayTransitionAudioPreserved", {
          reason: "open_overlay_hide_main",
          sessionActive: true,
        });
      }
      await invoke("show_mini_top_center");
      await getCurrentWindow().hide();
    } catch (error) {
      console.error("Failed to open overlay:", error);
      toast.error("Failed to open overlay window");
    } finally {
      isOpeningOverlayRef.current = false;
    }
  };

  // Detect Minimization to open Overlay
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let isMounted = true;

    const setup = async () => {
      if (!isTauri()) return;
      const window = getCurrentWindow();
      const fn = await window.onResized(async () => {
        const minimized = await window.isMinimized();
        if (minimized) {
          const now = Date.now();
          // Debounce minimize triggers (1 second)
          if (now - lastMinimizeTriggerRef.current < 1000) return;
          lastMinimizeTriggerRef.current = now;

          console.log("Main window minimized, opening overlay...");
          handleOpenOverlay();
        }
      });

      if (!isMounted) {
        fn();
      } else {
        unlisten = fn;
      }
    };

    setup();
    return () => {
      isMounted = false;
      if (unlisten) unlisten();
    };
  }, []);

  // Sync data with overlay
  useEffect(() => {
    const syncOverlay = async () => {
      if (!isTauri()) return;
      const combinedTranscript = buildOverlayTranscript(messages);
      const status =
        isMicConnectingState || mergedTabIsConnecting
          ? "Connecting"
          : isMicTranscribing || mergedTabIsTranscribing
            ? "Recording"
            : "Connected";
      const payload = {
        transcript: combinedTranscript,
        interimTranscript:
          activeMicInterimTranscript || mergedTabInterimTranscript,
        status,
        isMicActive: isMicTranscribing,
        isMicConnecting: isMicConnectingState,
        timerText: formattedTime,
        sessionId: id || null,
        selectedModel: selectedModel,
      };
      const payloadKey = JSON.stringify(payload);
      if (payloadKey === lastOverlayPayloadRef.current) return;
      lastOverlayPayloadRef.current = payloadKey;
      try {
        await emit("overlay-update", payload);
      } catch (error) {
        console.warn("Failed to sync overlay update:", error);
      }
    };
    if (overlaySyncTimerRef.current) {
      clearTimeout(overlaySyncTimerRef.current);
    }
    overlaySyncTimerRef.current = setTimeout(syncOverlay, 120);
    return () => {
      if (overlaySyncTimerRef.current) {
        clearTimeout(overlaySyncTimerRef.current);
        overlaySyncTimerRef.current = null;
      }
    };
  }, [
    messages,
    isMicTranscribing,
    activeMicInterimTranscript,
    mergedTabIsTranscribing,
    mergedTabInterimTranscript,
    formattedTime,
    id,
    selectedModel,
  ]);

  // Forward AI chat responses to overlay
  useEffect(() => {
    if (!isTauri() || aiChat.length === 0) return;
    const latest = aiChat[aiChat.length - 1];
    const forwardToOverlay = async () => {
      await emit("overlay-ai-response", {
        text: latest.text,
        isStreaming: isAnswering || isAnalyzing,
        messageId: latest.id,
        sender: latest.sender,
      });
    };
    forwardToOverlay();
  }, [aiChat, isAnswering, isAnalyzing]);

  const onClear = useCallback(() => {
    if (isTauri()) {
      setTauriMicInterim("");
      setTauriTabInterim("");
    }
    micTranscription.clearTranscript();
    tabTranscription.clearTranscript();
    tabAudioTranscription.clearTranscript();
    setMessages([]);
    pendingTranscriptRef.current = [];
    stabilizerRef.current?.cancel();
    previousAutoContextRef.current = null;
  }, [micTranscription, tabTranscription, tabAudioTranscription]);

  // Stable refs for overlay event handlers to prevent listener leakage
  const onAiAnswerRef = useRef(onAiAnswer);
  const onAnalyzeScreenRef = useRef(onAnalyzeScreen);
  const handleCustomQueryRef = useRef(handleCustomQuery);
  const onToggleMicRef = useRef(toggleTauriOrBrowserMic);
  const onClearRef = useRef(onClear);
  const endSessionNowRef = useRef(endSessionNow);
  const isAiGenerationBusyRef = useRef(false);

  onAiAnswerRef.current = onAiAnswer;
  onAnalyzeScreenRef.current = onAnalyzeScreen;
  handleCustomQueryRef.current = handleCustomQuery;
  endSessionNowRef.current = endSessionNow;
  onToggleMicRef.current = toggleTauriOrBrowserMic;
  onClearRef.current = onClear;
  isAiGenerationBusyRef.current = isAnswering || isAnalyzing;

  // Listen for overlay events (AI answer, analyze screen, exit)
  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      if (!isTauri()) return;
      const [u1, u2, u3, u4, uModel, u5, u6, u7, u8, u9] = await Promise.all([
        listen("overlay-ai-answer", () => {
          if (!active) return;
          if (isAiGenerationBusyRef.current) {
            console.log("[AI Answer][Dedup] overlay request ignored while generation is active");
            return;
          }
          onAiAnswerRef.current();
        }),
        listen("overlay-analyze-screen", (event) => {
          if (!active) return;
          if (isAiGenerationBusyRef.current) {
            console.log("[Analyze Screen][Dedup] overlay request ignored while generation is active");
            return;
          }
          onAnalyzeScreenRef.current(event.payload);
        }),
        listen("overlay-exit", async () => {
          if (active) {
            const { WebviewWindow } =
              await import("@tauri-apps/api/webviewWindow");
            const mainWindow = await WebviewWindow.getByLabel("main");
            if (mainWindow) {
              await mainWindow.show();
              await mainWindow.unminimize();
              await mainWindow.setFocus();
            }
            setIsEndSessionDialogOpen(true);
          }
        }),
        listen("overlay-ai-query", (event) => {
          const { query } = event.payload as { query: string };
          if (active && id)
            handleCustomQueryRef.current(id, query, selectedModelRef.current);
        }),
        listen("overlay-model-change", (event) => {
          const { model } = event.payload as { model: string };
          if (active) setSelectedModel(model);
        }),
        listen("overlay-toggle-mic", () => {
          if (active) onToggleMicRef.current();
        }),
        listen("overlay-clear-transcript", () => {
          if (active) onClearRef.current();
        }),
        listen("overlay-restore", async () => {
          if (active) {
            console.log("Received overlay-restore event");
            const { WebviewWindow } =
              await import("@tauri-apps/api/webviewWindow");
            const mainWindow = await WebviewWindow.getByLabel("main");
            if (mainWindow) {
              await mainWindow.show();
              await mainWindow.unminimize();
              await mainWindow.setFocus();
            } else {
              const window = getCurrentWindow();
              await window.show();
              await window.unminimize();
              await window.setFocus();
            }
          }
        }),
        listen("overlay-hide-main", async () => {
          if (active) {
            if (import.meta.env.DEV) {
              console.log("[audio-lifecycle] overlayTransitionAudioPreserved", {
                reason: "overlay_hide_main",
                sessionActive: true,
              });
            }
            await getCurrentWindow().hide();
          }
        }),
        listen("overlay-end-session-direct", async () => {
          if (active) {
            // Session was ended from the floating window — thunk already handled
            // window transitions. Only clean up audio/state here, don't touch windows.
            endSessionNowRef.current({ skipWindowManagement: true });
          }
        }),
      ]);

      if (!active) {
        u1();
        u2();
        u3();
        u4();
        u5();
        u6();
        u7();
        u8();
        u9();
        uModel();
        return;
      }

      unlisteners.push(u1, u2, u3, u4, u5, u6, u7, u8, u9, uModel);
    };

    setup();
    return () => {
      active = false;
      unlisteners.forEach((u) => u());
    };
  }, []); // Only register once on mount

  // Keyboard Shortcuts
  useKeyboardShortcut("g", onAiAnswer, {
    disabled:
      (messages.length === 0 &&
        !activeMicInterimTranscript &&
        !mergedTabInterimTranscript) ||
      isAnswering ||
      isAnalyzing,
  });

  useKeyboardShortcut("k", onAnalyzeScreen, {
    disabled: isAnalyzing || isAnswering,
  });

  const transcriptProps = {
    messages,
    micInterimTranscript: activeMicInterimTranscript,
    isMicTranscribing: isMicTranscribing,
    tabInterimTranscript: mergedTabInterimTranscript,
    isTabTranscribing: mergedTabIsTranscribing,
    isConnecting: isMicConnectingState || mergedTabIsConnecting,
    error: (isTauri() ? tauriError : micTranscription.error) || mergedTabError,
    onToggleMic: toggleTauriOrBrowserMic,
    onClear,
    onMinimize: toggleFullscreen,
    onChangeTab: startShare,
    onOpenOverlay: () => {
      if (isTauri()) {
        void handleOpenOverlay();
        return;
      }
      if (id) {
        navigate(`/sessions?view=${id}`);
      }
    },
    currentMicDevice,
    onPatchMessage,
    highlightKeywords: deepgramKeyterms,
  };

  const onSendCustomQuery = useCallback(() => {
    if (!id || !inputMessage.trim()) return;
    const query = inputMessage.trim();
    const adaptiveContext = buildAdaptiveAiContext({
      transcriptMessages: messages
        .filter(
          (message) =>
            (message.sender === "Interviewer" || message.sender === "User") &&
            !!message.text?.trim(),
        )
        .map((message) => ({
          sender: message.sender as "User" | "Interviewer",
          text: message.text.trim(),
          timestamp: message.timestamp,
        })),
      aiMessages: aiChat
        .filter((message) => message.sender === "AI")
        .map((message) => ({
          sender: "AI" as const,
          text: message.text,
          question: message.question,
        })),
      fallbackQuestion: query,
      liveInterimQuestion:
        mergedTabInterimTranscript || activeMicInterimTranscript || "",
    });
    handleCustomQuery(id, query, selectedModel, {
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
      sourcePlatform: isTauri() ? "tauri" : "web",
      answerMode: "auto",
    });
  }, [
    id,
    inputMessage,
    messages,
    aiChat,
    mergedTabInterimTranscript,
    activeMicInterimTranscript,
    handleCustomQuery,
    selectedModel,
  ]);

  const chatPanelProps = {
    messages: aiChat,
    inputMessage,
    onInputChange: setInputMessage,
    isAnalyzing,
    isAnswering,
    canAnswer:
      messages.length > 0 ||
      !!activeMicInterimTranscript ||
      !!mergedTabInterimTranscript,
    canAnalyze: isTauri() || !!stream,
    onAiAnswer,
    onAnalyzeScreen,
    onSend: onSendCustomQuery,
    onExit: () => setIsEndSessionDialogOpen(true),
    onRegenerate,
    onMessageInteract: onAiMessageInteract,
    isFreeSession,
    timerText: formattedTime,
    isWarning: creditWarning !== null,
    selectedModel,
    onModelChange: setSelectedModel,
  };

  return (
    <div className="h-screen w-screen bg-[#f8f9fb] text-slate-900 flex flex-col overflow-hidden font-sans select-none fixed inset-0">
      {/* Ephemeral session indicator — visible whenever transcript saving is OFF */}
      {!saveTranscriptEnabled && (
        <div className="fixed top-0 inset-x-0 z-40 flex items-center justify-center gap-2 bg-slate-900 text-white text-xs font-medium py-1 px-4 shadow">
          <span>🔒</span>
          <span>
            Ephemeral session — transcript saving is OFF. Nothing will be persisted after this session ends.
          </span>
        </div>
      )}

      {/* Credit warning banner — shown for paid sessions approaching exhaustion */}
      {creditWarning !== null && (
        <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-semibold py-1.5 px-4 shadow-lg">
          <span>⚠️</span>
          <span>
            Only {creditWarning} minute{creditWarning === 1 ? "" : "s"} of
            credit remaining — session will end soon.
          </span>
          <button
            className="ml-4 bg-white/20 hover:bg-white/30 text-white text-[10px] uppercase tracking-wider font-bold py-1 px-3 rounded-full border border-white/30 transition-colors shadow-sm"
            onClick={() => setBuyCreditsOpen(true)}
          >
            Top up
          </button>
          <button
            className="ml-2 opacity-70 hover:opacity-100 text-xs underline"
            onClick={() => setCreditWarning(null)}
          >
            dismiss
          </button>
        </div>
      )}

      <BuyCreditsDialog
        open={buyCreditsOpen}
        onOpenChange={setBuyCreditsOpen}
        onSuccess={refreshBalance}
      />

      {isFullscreen ? (
        /* ================= FULLSCREEN OVERLAY MODE ================= */
        <>
          <ScreenCapture
            stream={stream}
            videoRef={videoRef}
            onChangeTab={startShare}
            isFullscreen={true}
            onToggleFullscreen={toggleFullscreen}
          />
          <OverlayContainer
            isFullscreen={isFullscreen}
            leftComponent={<Transcript {...transcriptProps} isFullscreen />}
            rightComponent={<AIChatPanel {...chatPanelProps} isFullscreen />}
          />
        </>
      ) : (
        /* ================= NORMAL RESIZABLE PANEL MODE ================= */
        <main className="flex-1 overflow-hidden h-full relative z-10">
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel
              defaultSize={40}
              minSize={25}
              className="flex flex-col"
            >
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={50} minSize={20}>
                  <ScreenCapture
                    stream={stream}
                    videoRef={videoRef}
                    onChangeTab={startShare}
                    isFullscreen={false}
                    onToggleFullscreen={toggleFullscreen}
                  />
                </ResizablePanel>

                <ResizableHandle
                  className="bg-slate-200/50 hover:bg-slate-300 transition-colors"
                  withHandle
                />

                <ResizablePanel
                  defaultSize={50}
                  minSize={20}
                  className="flex flex-col"
                >
                  <Transcript {...transcriptProps} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>

            <ResizableHandle
              className="bg-slate-200/50 hover:bg-slate-300 transition-colors w-1.5"
              withHandle
            />

            <ResizablePanel
              defaultSize={60}
              minSize={30}
              className="flex flex-col"
            >
              <AIChatPanel {...chatPanelProps} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      )}

      <EndSessionDialog
        isOpen={isEndSessionDialogOpen}
        onClose={() => setIsEndSessionDialogOpen(false)}
        sessionId={id || ""}
        transcript={messages.map((m) => `[${m.sender}]: ${m.text}`).join("\n")}
      />

      <ConnectDialog
        open={isConnectDialogOpen}
        onSuccess={handleConnectSuccess}
        onCancel={handleConnectCancel}
        onStartShare={startShare}
        sessionId={connectData?.sessionId || id || ""}
        companyName={connectData?.companyName || ""}
        jobTitle={connectData?.jobTitle || ""}
        extraContext={connectData?.extraContext || ""}
        language={selectedLanguage}
        simpleLanguage={sessionSimpleLanguage}
        aiModel={selectedModel}
      />

      {/* <InactivityDialog
        isOpen={showInactivityDialog}
        remainingTime={remainingTime}
        onStayActive={onStayActive}
      /> */}
    </div>
  );
}
