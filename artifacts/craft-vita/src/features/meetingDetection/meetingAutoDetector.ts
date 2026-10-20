/**
 * Guarded meeting auto-detection poller (G-026).
 *
 * The target polls the foreground window from Electron main
 * (`startMeetingDetector`) and drives the "start overlay automatically" prompt
 * (T-13/T-16). Our Electron main process is owned by another workstream, so this
 * module lives on the renderer/service side and talks to ANY injected signal
 * bridge. It is fail-closed: a missing bridge, a rejected IPC call, malformed
 * data or a throwing prompt callback is swallowed (logged once) — detection can
 * never break the session UI.
 *
 * Wiring point (documented, not done here):
 *   `desktop-electron/main.js` should expose an IPC handler (e.g.
 *   `meeting:list-signals`) returning `{ macBundleId, windowsProcessName,
 *   windowTitle, url }[]` for the foreground window, and the renderer passes a
 *   bridge created with `createInvokeMeetingBridge(invoke)`. Until that handler
 *   exists the bridge rejects and this poller no-ops.
 */
import {
  buildMeetingPrompt,
  detectMeeting,
  type MeetingDetection,
  type MeetingSignal,
} from "@/lib/meetingDetection";

export interface MeetingSignalsBridge {
  /** Returns foreground window snapshots; may reject when IPC is unavailable. */
  listSignals(): Promise<readonly MeetingSignal[] | null | undefined>;
}

export interface MeetingAutoDetectOptions {
  bridge?: MeetingSignalsBridge | null;
  onDetected: (detection: MeetingDetection, prompt: string) => void;
  /** Poll cadence; defaults to 5 s. Set <= 0 with pollOnce() for manual control. */
  intervalMs?: number;
  /** Do not re-prompt the same platform within this window. Defaults to 30 min. */
  cooldownMs?: number;
  now?: () => number;
  setIntervalFn?: (callback: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  logger?: (message: string) => void;
}

export interface MeetingAutoDetectHandle {
  /** Runs one detection pass. Never rejects. */
  pollOnce(): Promise<MeetingDetection | null>;
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

export function startMeetingAutoDetect(
  options: MeetingAutoDetectOptions,
): MeetingAutoDetectHandle {
  const {
    bridge,
    onDetected,
    intervalMs = DEFAULT_INTERVAL_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now = () => Date.now(),
    setIntervalFn = (callback, ms) => setInterval(callback, ms),
    clearIntervalFn = (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    logger,
  } = options;

  const lastPromptAt = new Map<string, number>();
  let consecutiveFailures = 0;
  let stopped = false;
  let timer: unknown = null;

  const log = (message: string) => {
    try {
      logger?.(message);
    } catch {
      // A broken logger must not break detection.
    }
  };

  const pollOnce = async (): Promise<MeetingDetection | null> => {
    if (stopped || !bridge) return null;
    let snapshots: readonly MeetingSignal[] | null | undefined;
    try {
      snapshots = await bridge.listSignals();
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures === 1) {
        log(`[meeting-detection] signal bridge unavailable (no-op): ${String(error)}`);
      }
      return null;
    }
    if (!Array.isArray(snapshots) || snapshots.length === 0) return null;

    let best: MeetingDetection | null = null;
    for (const snapshot of snapshots) {
      if (!snapshot || typeof snapshot !== "object") continue;
      const detection = detectMeeting(snapshot);
      if (!detection) continue;
      if (!best || detection.confidence > best.confidence) best = detection;
    }
    if (!best) return null;

    const currentTime = now();
    const previous = lastPromptAt.get(best.slug);
    if (previous !== undefined && currentTime - previous < cooldownMs) {
      return best;
    }
    lastPromptAt.set(best.slug, currentTime);
    try {
      onDetected(best, buildMeetingPrompt(best));
    } catch (error) {
      // Prompt UI failures (toast host unmounted, etc.) are non-fatal.
      log(`[meeting-detection] prompt callback failed (ignored): ${String(error)}`);
    }
    return best;
  };

  if (bridge && intervalMs > 0) {
    timer = setIntervalFn(() => {
      void pollOnce();
    }, intervalMs);
  }

  return {
    pollOnce,
    stop: () => {
      stopped = true;
      if (timer !== null) {
        try {
          clearIntervalFn(timer);
        } catch {
          // Ignore teardown failures.
        }
        timer = null;
      }
    },
  };
}

/**
 * Renderer-side Electron bridge factory. `invoke` is the Tauri/Electron IPC
 * `invoke` function; it can be missing in a plain browser, in which case the
 * returned bridge rejects and the poller no-ops (fail-closed).
 */
export function createInvokeMeetingBridge(
  invoke: ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined,
): MeetingSignalsBridge {
  return {
    async listSignals(): Promise<readonly MeetingSignal[]> {
      if (typeof invoke !== "function") {
        throw new Error("meeting detection IPC is unavailable in this environment");
      }
      const raw = await invoke("list_meeting_signals");
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (entry): entry is MeetingSignal => !!entry && typeof entry === "object",
      );
    },
  };
}
