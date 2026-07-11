/**
 * Pure derivation of the interviewer/system-audio capture status shown in the
 * floating overlay. Extracted from `useFloatingSession` so the state machine is
 * unit-testable in isolation.
 *
 * Priority order matters: an explicit Deepgram error outranks a reconnect,
 * which outranks a live stream, which outranks the idle "Released" state.
 *
 *   Error        — Deepgram reported a hard error (`tabStatus === "error"`).
 *   Reconnecting — capture is (re)acquiring: the health monitor flagged the
 *                  system channel stale, or either channel is mid-connect.
 *   Live         — mic or system audio is actively transcribing.
 *   Released     — a session exists but nothing is connecting/live (the socket
 *                  went idle). This is the state that used to flap endlessly
 *                  against Reconnecting because the health monitor never
 *                  received a `stt:health:system` beat from Rust.
 *   Disconnected — no active session at all.
 */
export type CaptureStatus =
  | "Error"
  | "Reconnecting"
  | "Live"
  | "Released"
  | "Disconnected";

export type TabStatus = "idle" | "connecting" | "transcribing" | "error";

export interface CaptureStatusInput {
  tabStatus: TabStatus;
  isSystemStale: boolean;
  isMicConnecting: boolean;
  isMicActive: boolean;
  hasSession: boolean;
}

export function deriveCaptureStatus(input: CaptureStatusInput): CaptureStatus {
  const isTabActive = input.tabStatus === "transcribing";
  const isTabConnecting = input.tabStatus === "connecting";
  if (input.tabStatus === "error") return "Error";
  if (input.isSystemStale || input.isMicConnecting || isTabConnecting)
    return "Reconnecting";
  if (input.isMicActive || isTabActive) return "Live";
  return input.hasSession ? "Released" : "Disconnected";
}
