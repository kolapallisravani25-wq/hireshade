import { useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useAuth } from "@clerk/clerk-react";
import { safeJson } from "@/shared/utils/safeJson";
import { BACKEND_URL } from "@/features/launcher/constants";
import type { SessionInfo } from "@/features/launcher/types";

/**
 * Emit `session-init` to the mini window with handshake retry.
 *
 * Tauri's event bus is NOT buffered: if the mini window's React app hasn't
 * mounted (cold start race) the first emit is silently dropped, leaving the
 * overlay stuck at 00:00 with "Waiting for session…".
 *
 * The fix: re-emit on a short schedule and stop as soon as the mini window
 * acks via `session-init-ack`. Total worst-case wait ≈ 3.7s; typical path
 * completes on the first emit.
 */
async function emitSessionInitWithHandshake(
  payload: Record<string, unknown>,
): Promise<void> {
  let acked = false;
  const unlistenAck = await listen("session-init-ack", () => {
    acked = true;
  });

  // 0ms, 250ms, 600ms, 1200ms, 2000ms — covers any reasonable WebView cold start
  const delays = [0, 250, 600, 1200, 2000];
  try {
    for (const delay of delays) {
      if (acked) break;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (acked) break;
      await emit("session-init", payload);
    }
  } finally {
    unlistenAck();
  }
}

export interface ConflictSession {
  sessionId: string;
  companyName: string;
  aiModel: string;
  language: string;
  isFree: boolean;
  startedAt: string | null;
  maxAllowedMinutes: number | null;
}

interface UseSessionCreationReturn {
  isCreating: boolean;
  handleCreateSession: (sessionInfo: SessionInfo) => Promise<void>;
  /** Non-null when the server returns ACTIVE_SESSION_EXISTS */
  conflict: ConflictSession | null;
  /** Dismiss the conflict dialog without action */
  clearConflict: () => void;
  /** End the conflicting session then retry create with the pending info */
  endConflictAndCreate: () => Promise<void>;
  /** Re-join the conflicting session in the mini window */
  joinConflictSession: () => Promise<void>;
}

/**
 * Handles the full session creation flow:
 * 1. POST /api/session/create-session
 * 2. POST /api/session/:id/activate
 * 3. emit("session-init") to the mini window
 * 4. invoke("show_mini_top_center")
 * 5. hide the launcher window
 */
export function useSessionCreation(): UseSessionCreationReturn {
  const { getToken } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [conflict, setConflict] = useState<ConflictSession | null>(null);
  /** The session info the user was trying to create when the conflict occurred */
  const pendingSessionInfoRef = useRef<SessionInfo | null>(null);

  // ── Core create+activate flow (reusable for first attempt and retry) ──────
  const runCreateFlow = async (sessionInfo: SessionInfo): Promise<boolean> => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      toast.error("User session not initialized. Please try logging in again.");
      return false;
    }

    if (sessionInfo.projectIds.length > 2) {
      toast.error("You can select up to 2 projects only.");
      return false;
    }
    if (sessionInfo.projectIds.length === 2 && !sessionInfo.primaryProjectId) {
      toast.error("Please select a primary project.");
      return false;
    }

    // 1. Create session
    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("free", sessionInfo.isFree.toString());
    formData.append("companyName", sessionInfo.companyName);
    formData.append("jobDescription", sessionInfo.jobDescription);
    formData.append("resumeId", sessionInfo.resumeId);
    formData.append("documentId", sessionInfo.documentId);
    formData.append("language", sessionInfo.language);
    formData.append("simpleLanguage", sessionInfo.simpleLanguage.toString());
    formData.append("extraContext", sessionInfo.extraContext);
    formData.append("aiModel", sessionInfo.aiModel);
    formData.append("autoGenerateAI", sessionInfo.autoGenerateAI.toString());
    formData.append("saveTranscript", sessionInfo.saveTranscript.toString());
    if (sessionInfo.projectIds.length > 0) {
      formData.append("projectIds", JSON.stringify(sessionInfo.projectIds));
    }
    if (sessionInfo.primaryProjectId) {
      formData.append("primaryProjectId", sessionInfo.primaryProjectId);
    }

    const token = await getToken();
    const createRes = await fetch(`${BACKEND_URL}/api/session/create-session`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!createRes.ok) {
      if (createRes.status === 409) {
        const errData = await safeJson<{ error?: string; message?: string }>(createRes);
        const msg = (errData?.error ?? errData?.message ?? "") as string;
        if (msg.startsWith("ACTIVE_SESSION_EXISTS")) {
          const conflictId = msg.split(":")[1]?.trim();
          if (conflictId) {
            // Fetch conflict session details so we can display them + support rejoin
            const conflictData = await fetchConflictDetails(conflictId);
            pendingSessionInfoRef.current = sessionInfo;
            setConflict(conflictData);
            return false;
          }
        }
      }
      const errorData = await safeJson<{ error?: string; message?: string }>(createRes);
      throw new Error(errorData?.error || errorData?.message || "Failed to create session");
    }

    const createData = await safeJson<{ id?: string; sessionId?: string }>(createRes);
    if (!createData) throw new Error("Invalid response from create session");
    const sessionId = createData.id || createData.sessionId;

    // 2. Activate session
    const activateRes = await fetch(`${BACKEND_URL}/api/session/${sessionId}/activate`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!activateRes.ok) {
      if (activateRes.status === 402) {
        toast.error(
          "Insufficient credits. Please purchase credits to start a session.",
        );
        return false;
      }
      if (activateRes.status === 409) {
        const errData = await safeJson<{ error?: string; message?: string }>(activateRes);
        const msg = (errData?.error ?? errData?.message ?? "") as string;
        if (msg.startsWith("ACTIVE_SESSION_EXISTS")) {
          const conflictId = msg.split(":")[1]?.trim();
          if (conflictId) {
            const conflictData = await fetchConflictDetails(conflictId);
            pendingSessionInfoRef.current = sessionInfo;
            setConflict(conflictData);
            return false;
          }
        }
        if (msg.startsWith("SESSION_ALREADY_ENDED")) {
          toast.error("This session has already ended — please create a new one.");
          return false;
        }
      }
      throw new Error("Failed to activate session");
    }

    const activateData =
      (await safeJson<{ startedAt?: string; maxAllowedMinutes?: number }>(activateRes)) ?? {};

    // 3. Show mini overlay FIRST so its React app starts mounting and the
    //    `session-init` listener can attach before we emit. The handshake
    //    below will retry until the listener acks, so even a slow cold start
    //    is tolerated.
    await invoke("show_mini_top_center");

    // 4. Emit session context to mini window (with retry + ack handshake).
    await emitSessionInitWithHandshake({
      sessionId,
      isFree: sessionInfo.isFree,
      aiModel: sessionInfo.aiModel,
      language: sessionInfo.language,
      companyName: sessionInfo.companyName,
      startedAt: activateData.startedAt ?? null,
      maxAllowedMinutes: activateData.maxAllowedMinutes ?? null,
      saveTranscript: sessionInfo.saveTranscript,
    });

    // 5. Hide launcher
    await getCurrentWindow().hide();
    return true;
  };

  // ── Fetch details of the conflicting session ──────────────────────────────
  const fetchConflictDetails = async (sessionId: string): Promise<ConflictSession> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/session/${sessionId}`);
      if (res.ok) {
        const data = await safeJson<{
          id?: string;
          companyName?: string;
          aiModel?: string;
          language?: string;
          free?: boolean;
          startedAt?: string | null;
          maxAllowedMinutes?: number | null;
        }>(res);
        return {
          sessionId,
          companyName: data?.companyName ?? "",
          aiModel: data?.aiModel ?? "anthropic/claude-haiku-4-5",
          language: data?.language ?? "English",
          isFree: data?.free ?? false,
          startedAt: data?.startedAt ?? null,
          maxAllowedMinutes: data?.maxAllowedMinutes ?? null,
        };
      }
    } catch {
      // Fall through to default
    }
    return {
      sessionId,
      companyName: "",
      aiModel: "anthropic/claude-haiku-4-5",
      language: "English",
      isFree: false,
      startedAt: null,
      maxAllowedMinutes: null,
    };
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  const handleCreateSession = async (sessionInfo: SessionInfo) => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      await runCreateFlow(sessionInfo);
    } catch (err) {
      console.error("[useSessionCreation]", err);
      toast.error("Failed to start session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const clearConflict = () => {
    setConflict(null);
    pendingSessionInfoRef.current = null;
  };

  const endConflictAndCreate = async () => {
    if (!conflict || !pendingSessionInfoRef.current) return;
    setIsCreating(true);
    const conflictId = conflict.sessionId;
    const pending = pendingSessionInfoRef.current;
    setConflict(null);
    pendingSessionInfoRef.current = null;
    try {
      // End the conflicting session first. This call MUST be authenticated —
      // without the token it 401s, the conflicting session stays ACTIVE, and
      // the retried create loops back into the same 409 forever.
      const token = await getToken();
      const endRes = await fetch(`${BACKEND_URL}/api/session/${conflictId}/deactivate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ transcript: "", aiUsage: 0 }),
      }).catch((err) => {
        console.error("[useSessionCreation] end conflict deactivate failed", err);
        return null;
      });
      if (!endRes || !endRes.ok) {
        toast.error(
          "Couldn't end the previous session — please try again in a moment.",
        );
        return;
      }
      // Retry the create flow
      await runCreateFlow(pending);
    } catch (err) {
      console.error("[useSessionCreation] endConflictAndCreate", err);
      toast.error("Failed to start session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const joinConflictSession = async () => {
    if (!conflict) return;
    setIsCreating(true);
    const { sessionId, companyName, aiModel, language, isFree } = conflict;
    setConflict(null);
    pendingSessionInfoRef.current = null;
    try {
      // Re-activate the existing session (DISCONNECTED → ACTIVE is idempotent).
      // Must be authenticated — an unauthenticated call 401s silently and the
      // rejoin proceeds against a session the server never re-activated.
      const joinToken = await getToken();
      const activateRes = await fetch(`${BACKEND_URL}/api/session/${sessionId}/activate`, {
        method: "POST",
        headers: joinToken ? { Authorization: `Bearer ${joinToken}` } : {},
      });
      if (!activateRes.ok) {
        toast.error("Couldn't rejoin the session — it may have already ended.");
        return;
      }
      const activateData =
        (await safeJson<{ startedAt?: string; maxAllowedMinutes?: number }>(activateRes)) ?? {};

      await invoke("show_mini_top_center");
      await emitSessionInitWithHandshake({
        sessionId,
        isFree,
        aiModel,
        language,
        companyName,
        startedAt: activateData.startedAt ?? null,
        maxAllowedMinutes: activateData.maxAllowedMinutes ?? null,
      });

      await getCurrentWindow().hide();
    } catch (err) {
      console.error("[useSessionCreation] joinConflictSession", err);
      toast.error("Failed to rejoin session. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return {
    isCreating,
    handleCreateSession,
    conflict,
    clearConflict,
    endConflictAndCreate,
    joinConflictSession,
  };
}
