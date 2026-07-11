/**
 * Pure classifier for the interviewer/system-audio capture health, extracted
 * from `useFloatingSession` so the reconnect decision is unit-testable.
 *
 * The whole point of this module is to distinguish *genuine silence* from
 * *transport failure*. Before the Rust `stt:health:system` heartbeat existed,
 * the monitor treated "no recent PCM" as a failure and force-reacquired — so a
 * quiet interviewer (or WASAPI/ScreenCaptureKit not emitting frames during true
 * silence) produced an endless Released -> Reconnecting flap.
 *
 * Now Rust emits a 1 s heartbeat while the send loop is alive. A *fresh*
 * heartbeat is positive proof that capture + Deepgram are up, independent of
 * whether any audio is currently flowing. So:
 *
 *   - We reconnect ONLY on confirmed failure: an explicit error/stopped health
 *     state, a heartbeat that stopped arriving (send loop / capture thread
 *     died), a fresh heartbeat that reports capture or Deepgram down, or a
 *     Deepgram stall where we are demonstrably sending PCM but only get empty
 *     finals back.
 *   - While the heartbeat is fresh (or during the initial pre-heartbeat
 *     window), silence is classified "silent" — the badge stays Live/idle and
 *     capture is NEVER torn down just because no PCM arrived.
 */
export type SystemHealthClass = "live" | "silent" | "reconnect";

export interface SystemHealthInput {
  /** `lastHeartbeatAt > 0` — a `stt:health:system` beat has been seen. */
  hadHeartbeat: boolean;
  /** `now - lastHeartbeatAt`; only meaningful when `hadHeartbeat`. */
  msSinceHeartbeat: number;
  /** From the most recent heartbeat. */
  captureRunning: boolean;
  /** From the most recent heartbeat. */
  deepgramRunning: boolean;
  /** Last heartbeat `state`: idle|connected|capturing|error|starved|stopped. */
  healthState: string;
  /** A PCM frame was forwarded to Deepgram within the staleness window. */
  pcmRecent: boolean;
  /** The monotonic PCM frame counter grew since the previous tick. */
  pcmIncreasing: boolean;
  /** A non-empty system transcript arrived within the meaningful window. */
  meaningfulRecent: boolean;
  /** Deepgram returned an empty-final storm WHILE PCM was actively flowing. */
  deepgramStallWithActivePcm: boolean;
}

export interface SystemHealthThresholds {
  /**
   * How long the 1 s Rust heartbeat may be absent before we treat the transport
   * as dead. Tolerant of event-loop jitter / brief stalls but catches a truly
   * dead send loop within a few seconds.
   */
  heartbeatStaleMs: number;
}

export interface SystemHealthDecision {
  class: SystemHealthClass;
  /** Machine-readable reason, surfaced in privacy-safe diagnostic logs. */
  reason: string;
}

export function classifySystemHealth(
  input: SystemHealthInput,
  thresholds: SystemHealthThresholds,
): SystemHealthDecision {
  const { healthState } = input;

  // 1. Explicit failure state reported by Rust.
  if (healthState === "error" || healthState === "starved" || healthState === "stopped") {
    return { class: "reconnect", reason: `health_state_${healthState}` };
  }

  const heartbeatFresh =
    input.hadHeartbeat && input.msSinceHeartbeat <= thresholds.heartbeatStaleMs;

  // 2. Heartbeat was arriving and then stopped: send loop / capture thread died.
  if (input.hadHeartbeat && !heartbeatFresh) {
    return { class: "reconnect", reason: "heartbeat_lost" };
  }

  // 3/4. Fresh heartbeat that reports a component down — trust the beat.
  if (heartbeatFresh && !input.captureRunning) {
    return { class: "reconnect", reason: "capture_stopped" };
  }
  if (heartbeatFresh && !input.deepgramRunning) {
    return { class: "reconnect", reason: "deepgram_down" };
  }

  // 5. Deepgram stall: we ARE sending audio (PCM flowing) but only empty finals
  //    come back. Distinct from silence, which has no PCM.
  if (heartbeatFresh && input.deepgramStallWithActivePcm) {
    return { class: "reconnect", reason: "deepgram_stall" };
  }

  // Transport is provably alive (fresh heartbeat + capture + Deepgram up) or we
  // are still in the initial pre-heartbeat window. Silence is NOT failure.
  if (input.meaningfulRecent || input.pcmRecent || input.pcmIncreasing) {
    return { class: "live", reason: "audio_active" };
  }
  return {
    class: "silent",
    reason: heartbeatFresh ? "transport_alive_silent" : "awaiting_first_heartbeat",
  };
}
