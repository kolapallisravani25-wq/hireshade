import { invoke } from "@tauri-apps/api/core";

export type AudioSessionMode = "mic" | "system" | "all";
export type AudioSessionState =
  | "idle"
  | "connecting"
  | "transcribing"
  | "reconnecting"
  | "paused"
  | "released"
  | "error";

export interface AudioSessionController {
  getState: () => AudioSessionState;
  setState: (next: AudioSessionState) => void;
  startAudioSession: (mode: AudioSessionMode, reason?: string) => void;
  pauseAudioSession: (mode: AudioSessionMode, reason?: string) => Promise<void>;
  stopAudioSession: (mode: AudioSessionMode, reason?: string) => Promise<void>;
  destroyAudioSession: (reason?: string) => Promise<void>;
}

interface CreateAudioSessionControllerOptions {
  source: "active-session" | "floating-session";
  stopWebMic?: () => void;
  stopWebSystem?: () => void;
}

const DEV = import.meta.env.DEV;
const TERMINAL_ALL_REASONS = new Set([
  "session_end",
  "end_session",
  "app_exit",
  "set_session_active_false",
  "fatal_destroy",
  "destroy",
  "active_session_unmount",
  "component_unmount",
  "floating_unmount",
]);

const log: (event: string, payload: Record<string, unknown>) => void = DEV
  ? (event, payload) => { console.log(`[audio-lifecycle] ${event}`, payload); }
  : () => {};

function isSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  return !!sessionStorage.getItem("hireshade.session-init");
}

function shouldAllowAllMode(reason: string): boolean {
  return TERMINAL_ALL_REASONS.has(reason);
}

export async function stopAllNativeTranscription(): Promise<void> {
  const results = await Promise.allSettled([
    invoke("stop_mic_transcription"),
    invoke("stop_system_audio_transcription"),
  ]);
  const failureCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failureCount > 0) {
    console.warn("[audio-lifecycle] native transcription stop failed", {
      failureCount,
    });
  }
}

async function stopNative(mode: AudioSessionMode, reason: string) {
  const stopMic = () => invoke("stop_mic_transcription").catch(() => {});
  const stopSystem = () => invoke("stop_system_audio_transcription").catch(() => {});
  const sessionActive = isSessionActive();

  if (mode === "mic") {
    await stopMic();
    log("stopMicInvoked", { mode, reason, stopReason: reason, sessionActive });
    log("nativeStopInvoked", { mode: "mic" });
    log("stopReason", { mode, reason, sessionActive });
    log("systemAudioStillRunningAfterMicStop", { sessionActive });
    return;
  }
  if (mode === "system") {
    await stopSystem();
    log("stopSystemInvoked", { mode, reason, stopReason: reason, sessionActive });
    log("nativeStopInvoked", { mode: "system" });
    log("stopReason", { mode, reason, sessionActive });
    return;
  }
  log("stopAllInvoked", { mode, reason, stopReason: reason, sessionActive });
  await stopAllNativeTranscription();
  log("nativeStopInvoked", { mode: "all" });
  log("stopReason", { mode, reason, sessionActive });
}

export function createAudioSessionController(
  options: CreateAudioSessionControllerOptions,
): AudioSessionController {
  let state: AudioSessionState = "idle";
  let destroyed = false;

  const setState = (next: AudioSessionState) => {
    state = next;
  };

  const stopWeb = (mode: AudioSessionMode) => {
    if (mode === "mic") {
      options.stopWebMic?.();
      return;
    }
    if (mode === "system") {
      options.stopWebSystem?.();
      return;
    }
    options.stopWebMic?.();
    options.stopWebSystem?.();
  };

  return {
    getState: () => state,
    setState,
    startAudioSession: (mode: AudioSessionMode, reason = "manual_start") => {
      destroyed = false;
      setState("connecting");
      log("audioSessionStarted", { source: options.source, mode, reason });
    },
    pauseAudioSession: async (mode: AudioSessionMode, reason = "pause") => {
      if (destroyed) return;
      if (mode === "all" && !shouldAllowAllMode(reason)) {
        log("allModeBlocked", { source: options.source, mode, reason, sessionActive: isSessionActive() });
        return;
      }
      setState("paused");
      stopWeb(mode);
      await stopNative(mode, reason);
      log("audioSessionPaused", { source: options.source, mode, reason });
      log("reconnectCancelled", { source: options.source, mode });
    },
    stopAudioSession: async (mode: AudioSessionMode, reason = "stop") => {
      if (destroyed) return;
      if (mode === "all" && !shouldAllowAllMode(reason)) {
        log("allModeBlocked", { source: options.source, mode, reason, sessionActive: isSessionActive() });
        return;
      }
      stopWeb(mode);
      await stopNative(mode, reason);
      setState("released");
      log("audioSessionStopped", { source: options.source, mode, reason });
      log("mediaTracksReleased", { source: options.source, mode });
      log("websocketClosed", { source: options.source, mode });
      log("audioContextClosed", { source: options.source, mode });
      log("reconnectCancelled", { source: options.source, mode });
    },
    destroyAudioSession: async (reason = "destroy") => {
      stopWeb("all");
      await stopNative("all", reason);
      destroyed = true;
      setState("released");
      log("audioSessionDestroyed", { source: options.source, reason });
      log("mediaTracksReleased", { source: options.source, mode: "all" });
      log("websocketClosed", { source: options.source, mode: "all" });
      log("audioContextClosed", { source: options.source, mode: "all" });
      log("reconnectCancelled", { source: options.source, mode: "all" });
    },
  };
}
