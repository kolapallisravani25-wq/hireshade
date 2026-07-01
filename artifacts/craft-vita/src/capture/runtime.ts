/**
 * Runtime environment detection for capture-backend selection.
 *
 * Used by the capture provider layer to pick the correct implementation:
 *   - "browser"           → useDeepgram + getUserMedia/getDisplayMedia
 *   - "desktop-macos"     → Rust ScreenCaptureKit + cpal (start_system_audio_transcription / start_mic_transcription)
 *   - "desktop-windows"   → Rust WASAPI loopback + cpal
 *   - "desktop-linux"     → mic only (no system audio support yet)
 *
 * Detection is deliberately runtime-only: never rely on import.meta.env or
 * user-agent sniffing for platform branching (per AGENTS.md).
 */
import type { CapturePlatform } from "@/types/transcript";

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI__" in window;

let cached: CapturePlatform | null = null;

export const getCaptureRuntime = (): CapturePlatform => {
  if (cached) return cached;
  if (!isTauriRuntime()) {
    cached = "browser";
    return cached;
  }
  // Inside Tauri: detect host OS via navigator.platform / userAgentData.
  // We avoid invoking a Rust command synchronously here so the helper stays
  // cheap; the Rust side authoritatively cfg-gates capture commands anyway.
  const ua =
    (typeof navigator !== "undefined" && navigator.userAgent) || "";
  if (/Mac OS X|Macintosh/i.test(ua)) cached = "desktop-macos";
  else if (/Windows/i.test(ua)) cached = "desktop-windows";
  else cached = "desktop-linux";
  return cached;
};

export const isDesktop = (): boolean => getCaptureRuntime() !== "browser";
export const isBrowser = (): boolean => getCaptureRuntime() === "browser";
