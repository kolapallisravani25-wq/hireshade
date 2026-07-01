/**
 * Capture provider contract.
 *
 * Documents the boundary between platform-specific capture backends and the
 * shared JS transcript pipeline. Each backend owns its own start/stop and
 * permission lifecycle but speaks the same TranscriptEvent / CaptureStatusEvent
 * vocabulary so React + AI flows remain platform-agnostic.
 *
 * Concrete implementations:
 *   - DesktopRustProvider  — wraps `start_system_audio_transcription` and
 *                            `start_mic_transcription` Tauri commands and the
 *                            `stt:system-audio` / `stt:mic` / `stt:status:*`
 *                            events emitted by Rust.
 *   - BrowserProvider      — wraps useDeepgram + getUserMedia/getDisplayMedia.
 *
 * The desktop overlay (FloatingApp) uses DesktopRustProvider directly via
 * @tauri-apps/api invoke/listen — we do not box the implementation behind a
 * factory because the overlay is desktop-only by definition. The browser
 * dashboard (page.tsx) keeps its existing hooks. The point of this contract
 * is to ensure both implementations stay aligned on the wire format.
 */
import type {
  TranscriptEvent,
  CaptureStatusEvent,
} from "@/types/transcript";

export interface CaptureProvider {
  /** One-time setup. May request OS permissions on a no-op probe. */
  init(): Promise<void>;

  /** Start microphone capture (always user-initiated). */
  startMic(): Promise<void>;
  stopMic(): Promise<void>;

  /**
   * Start system / shared audio capture.
   *
   * Desktop: native loopback (always available with permission).
   * Browser: getDisplayMedia with `audio: true` — user picks a source and
   *          may decline to share audio.
   */
  startSystemAudio(): Promise<void>;
  stopSystemAudio(): Promise<void>;

  /** Browser-only screen-share (with optional shared audio). No-op on desktop. */
  startScreenShare?(): Promise<void>;
  stopScreenShare?(): Promise<void>;

  /** Tear down all listeners and stop any in-flight streams. */
  destroy(): Promise<void>;

  /** Subscribe to normalized transcript events. Returns an unsubscribe fn. */
  onTranscript(cb: (e: TranscriptEvent) => void): () => void;

  /** Subscribe to lifecycle / error status events. */
  onStatus(cb: (e: CaptureStatusEvent) => void): () => void;
}
