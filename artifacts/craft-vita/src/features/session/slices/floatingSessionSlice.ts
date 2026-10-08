/**
 * floatingSessionSlice — Redux state for the mini floating overlay window.
 *
 * Holds all serializable session-scoped state that previously lived as
 * individual useState() calls inside FloatingApp.tsx.  Ephemeral hardware
 * state (mic, tab audio, streaming) stays local in the component.
 */

import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { stopAllNativeTranscription } from "@/features/session/audio/audioSessionController";
import { resetOverlaySettings } from "@/lib/overlaySettings";
import type { RootState } from "@/store/store";
import { getAuthHeaders } from "@/lib/globalAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SessionInitData {
  sessionId: string;
  isFree: boolean;
  aiModel: string;
  language: string;
  companyName: string;
  startedAt: string | null;
  maxAllowedMinutes: number | null;
  saveTranscript?: boolean;
  /** Wizard Step-6 "AI Generation" preference — seeds the live auto-generate toggle. */
  autoGenerateAI?: boolean;
}

export interface TranscriptMessage {
  id: string;
  sender: "User" | "Interviewer";
  text: string;
  timestamp: number;
  originalText?: string;
  patchedText?: string;
  patchedAt?: number;
  patchedByUser?: boolean;
}

export interface AddMessagePayload {
  sender: "User" | "Interviewer";
  text: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface FloatingSessionState {
  /** Active session data — null when no session is running */
  sessionInfo: SessionInitData | null;
  /** AI model selected for this session */
  selectedModel: string;
  /** Transcript messages (User + Interviewer) */
  messages: TranscriptMessage[];
  /** Remaining credit-minutes warning value, null when no warning */
  creditWarning: number | null;
  /** True while the end-session async thunk is in flight */
  isEnding: boolean;
  // ── UI panel state ──────────────────────────────────────────────────────────
  isWindowCollapsed: boolean;
  isResponsesExpanded: boolean;
  isTranscriptExpanded: boolean;
  currentResponseIndex: number;
  /** When true, an AI answer is auto-generated as new interviewer questions arrive. */
  autoGenerate: boolean;
  /** When true, transcript / responses panels auto-scroll to the latest content. */
  autoScroll: boolean;
}

const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

// Available models - should match ModelSelector.AI_MODELS
const AVAILABLE_MODELS = [
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-4.5",
  "google/gemini-3.1-flash-lite-preview",
  "openai/gpt-5",
];

/**
 * Validates if a model ID is in the available models list
 */
function isValidModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return AVAILABLE_MODELS.includes(modelId);
}

/**
 * Returns a valid model ID, falling back to default if invalid
 */
function getValidModel(modelId: string | null | undefined): string {
  if (isValidModel(modelId)) return modelId!;
  return DEFAULT_MODEL;
}

const initialState: FloatingSessionState = {
  sessionInfo: null,
  selectedModel: DEFAULT_MODEL,
  messages: [],
  creditWarning: null,
  isEnding: false,
  isWindowCollapsed: false,
  isResponsesExpanded: false,
  isTranscriptExpanded: false,
  currentResponseIndex: 0,
  autoGenerate: true,
  autoScroll: true,
};

// ─── Async thunk: end session ─────────────────────────────────────────────────

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface EndSessionArgs {
  /** Override transcript for testing; defaults to reading from Redux state */
  transcriptOverride?: string;
}

export const endSessionThunk = createAsyncThunk<void, EndSessionArgs | void>(
  "floatingSession/endSession",
  async (_args, { getState }) => {
    const state = getState() as RootState;
    const { sessionInfo, messages } = state.floatingSession;

    // Always return the user to the launcher widget — never let the mini
    // window close while it is the last visible window of the app, otherwise
    // the user perceives "the app closed".
    const returnToLauncher = async () => {
      try {
        await invoke("show_launcher_widget");
      } catch (err) {
        console.error("show_launcher_widget failed:", err);
      }
      // Hide instead of close — the mini window is declared in tauri.conf.json
      // and reused across sessions. Closing it would destroy the WebView and
      // force a full cold re-mount on the next session.
      try {
        await getCurrentWindow().hide();
      } catch (err) {
        console.error("hide mini window failed:", err);
      }
    };

    if (!sessionInfo) {
      // Redux sessionInfo can be empty even while a session is live — the
      // overlay may be running off the persisted "session-init" handoff after a
      // remount, or getState() can race the slice hydration. Returning here
      // WITHOUT deactivating is what leaves the session ACTIVE on the server
      // (no toast, and the next "create" prompts to end the previous one).
      // Recover the id from the persisted handoff and deactivate anyway.
      try {
        const raw = sessionStorage.getItem("hireshade.session-init");
        const recovered = raw
          ? (JSON.parse(raw) as { sessionId?: string })
          : null;
        if (recovered?.sessionId) {
          const authHeaders = await getAuthHeaders();
          await Promise.all([
            stopAllNativeTranscription(),
            fetch(
              `${BACKEND_URL}/api/session/${recovered.sessionId}/deactivate`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders },
                body: JSON.stringify({}),
              },
            ).catch(() => null),
            invoke("set_session_active", { active: false }).catch(() => {}),
          ]);
          sessionStorage.removeItem("hireshade.session-init");
        }
      } catch {
        // best-effort recovery — never block the return-to-launcher
      }
      await returnToLauncher();
      return;
    }

    const transcript = messages
      .map((m) => `[${m.sender}]: ${m.text}`)
      .join("\n");

    const aiUsage = parseInt(
      localStorage.getItem(`aiUsage_${sessionInfo.sessionId}`) || "0",
    );

    const durationMinutes = sessionInfo.startedAt
      ? Math.ceil((Date.now() - new Date(sessionInfo.startedAt).getTime()) / 60_000)
      : null;

    const authHeaders = await getAuthHeaders();
    // Deactivate FIRST and inspect the result — previously the failure was
    // swallowed (fire-and-forget), which could leave the session ACTIVE on
    // the server. The stale-session reaper now self-heals that within a few
    // minutes, but the user deserves to know immediately.
    const [, deactivateRes] = await Promise.all([
      stopAllNativeTranscription(),
      fetch(`${BACKEND_URL}/api/session/${sessionInfo.sessionId}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ transcript, aiUsage, durationMinutes }),
      }).catch((err) => {
        console.error("Deactivate fetch failed:", err);
        return null;
      }),
      invoke("set_session_active", { active: false }).catch(() => {}),
      emit("overlay-end-session-direct").catch(() => {}),
    ]);

    localStorage.removeItem(`aiUsage_${sessionInfo.sessionId}`);
    try { sessionStorage.removeItem("hireshade.session-init"); } catch {}
    resetOverlaySettings();

    if (!deactivateRes || !deactivateRes.ok) {
      toast.error(
        "Couldn't confirm session end with the server — it will auto-end within a few minutes. You may see a rejoin prompt until then.",
      );
    } else {
      // Use the server's authoritative settlement instead of guessing
      // client-side from the local clock.
      try {
        const settled = (await deactivateRes.json()) as {
          creditsDeducted?: string;
          deductionReason?: string;
          minutes?: number;
        };
        if (
          settled.deductionReason === "FREE_ZONE" ||
          settled.deductionReason === "FREE_SESSION"
        ) {
          toast.success("Session ended — no credits charged");
        } else if (
          settled.creditsDeducted &&
          parseFloat(settled.creditsDeducted) > 0
        ) {
          toast.info(
            `Session ended — ${settled.creditsDeducted} credits deducted (${settled.minutes ?? durationMinutes ?? 0} min)`,
          );
        }
      } catch {
        // Response body unreadable — session still ended; stay quiet.
      }
    }

    // Notify launcher to reset its UI before showing it.
    await emit("session:reset").catch(() => {});

    // Show launcher, then hide mini — order matters so the user always has a
    // visible window during the transition.
    await returnToLauncher();
  },
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const floatingSessionSlice = createSlice({
  name: "floatingSession",
  initialState,
  reducers: {
    /**
     * Hydrate session from a live "session-init" Tauri event payload.
     * Also resets all prior-session state (messages, panels, warnings).
     */
    initSession(state, action: PayloadAction<SessionInitData>) {
      state.sessionInfo = action.payload;
      state.selectedModel = action.payload.aiModel || "anthropic/claude-haiku-4.5";
      state.messages = [];
      state.creditWarning = null;
      state.isEnding = false;
      state.isResponsesExpanded = false;
      state.isTranscriptExpanded = false;
      state.currentResponseIndex = 0;
      // Seed the auto-generate toggle from the wizard preference. Defaults to
      // OFF — auto-generation spends credits, so the user must opt in.
      state.autoGenerate = action.payload.autoGenerateAI ?? false;
      state.autoScroll = true;
    },

    setSelectedModel(state, action: PayloadAction<string>) {
      state.selectedModel = action.payload;
    },

    /**
     * Add a transcript message with deduplication.
     * Called after dedup check in the component/hook.
     */
    addMessage(state, action: PayloadAction<TranscriptMessage>) {
      state.messages.push(action.payload);
    },

    patchMessage(
      state,
      action: PayloadAction<{
        id: string;
        patchedText: string;
        patchedAt?: number;
        patchedByUser?: boolean;
      }>,
    ) {
      const msg = state.messages.find((m) => m.id === action.payload.id);
      if (!msg) return;
      const nextText = action.payload.patchedText.trim();
      if (!nextText) return;
      msg.originalText = msg.originalText ?? msg.text;
      msg.patchedText = nextText;
      msg.text = nextText;
      msg.patchedAt = action.payload.patchedAt ?? Date.now();
      msg.patchedByUser = action.payload.patchedByUser ?? true;
    },

    clearMessages(state) {
      state.messages = [];
    },

    setCreditWarning(state, action: PayloadAction<number | null>) {
      state.creditWarning = action.payload;
    },

    setIsWindowCollapsed(state, action: PayloadAction<boolean>) {
      state.isWindowCollapsed = action.payload;
    },

    setIsResponsesExpanded(state, action: PayloadAction<boolean>) {
      state.isResponsesExpanded = action.payload;
    },

    setIsTranscriptExpanded(state, action: PayloadAction<boolean>) {
      state.isTranscriptExpanded = action.payload;
    },

    setCurrentResponseIndex(state, action: PayloadAction<number>) {
      state.currentResponseIndex = action.payload;
    },

    setAutoGenerate(state, action: PayloadAction<boolean>) {
      state.autoGenerate = action.payload;
    },

    setAutoScroll(state, action: PayloadAction<boolean>) {
      state.autoScroll = action.payload;
    },

    /**
     * Called by the heartbeat / SSE hooks when credits are exhausted or warnings fire.
     */
    triggerCreditWarning(state, action: PayloadAction<number>) {
      state.creditWarning = action.payload;
    },

    /** Hard reset — clears everything (e.g. on window close / unmount cleanup) */
    resetFloatingSession() {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(endSessionThunk.pending, (state) => {
        state.isEnding = true;
      })
      .addCase(endSessionThunk.fulfilled, (state) => {
        // Window is closed by the thunk; reset state as cleanup
        state.isEnding = false;
        state.sessionInfo = null;
      })
      .addCase(endSessionThunk.rejected, (state) => {
        // Even on error, clear the ending flag so UI recovers
        state.isEnding = false;
      });
  },
});

export const {
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
  triggerCreditWarning,
  resetFloatingSession,
} = floatingSessionSlice.actions;

// Export validation functions separately (not part of slice actions)
export { isValidModel, getValidModel };

export default floatingSessionSlice.reducer;
