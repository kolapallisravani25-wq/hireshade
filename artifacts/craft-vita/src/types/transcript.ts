/**
 * Canonical transcript event shape used across all capture backends.
 *
 * Every capture provider (browser getUserMedia, browser getDisplayMedia,
 * macOS ScreenCaptureKit, Windows WASAPI loopback, macOS/Windows cpal mic)
 * normalizes its raw provider output into TranscriptEvent before reaching
 * React state, transcript persistence, or AI flows.
 */
export type TranscriptSource =
  | "mic"
  | "system"
  | "screen-audio"
  | "browser-tab";

export type TranscriptSpeaker = "user" | "remote" | "system" | "unknown";

export type CapturePlatform =
  | "browser"
  | "desktop-windows"
  | "desktop-macos"
  | "desktop-linux";

export interface TranscriptEvent {
  /** Stable ID for dedup; provider-generated, not strictly required. */
  id?: string;
  text: string;
  isFinal: boolean;
  /** ms since epoch */
  timestamp: number;
  source: TranscriptSource;
  speaker: TranscriptSpeaker;
  platform: CapturePlatform;
  confidence?: number;
  raw?: unknown;
}

/** Status emitted by every capture provider for UI surfacing. */
export type CaptureStatus =
  | "idle"
  | "connecting"
  | "transcribing"
  | "error";

export interface CaptureStatusEvent {
  status: CaptureStatus;
  source: TranscriptSource;
  /** Human-readable error if status === "error". */
  error?: string;
  /** Stable error code for routing UI (e.g. open Settings). */
  code?:
    | "permission-denied"
    | "permission-timeout"
    | "device-unavailable"
    | "network"
    | "unknown";
}
