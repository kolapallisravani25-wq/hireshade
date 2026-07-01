/**
 * Transcript Stabilizer — debounced freeze window that prevents AI triggering
 * while STT transcript is still mutating.
 *
 * Framework-agnostic pure TypeScript. No external dependencies.
 */

export interface TranscriptStabilizer {
  /** Feed new transcript text. Resets the freeze timer. */
  feed(rawTranscript: string): void;
  /** Cancel any pending stabilization. */
  cancel(): void;
  /** Whether currently waiting for freeze window to expire. */
  isStabilizing(): boolean;
  /** Get the last frozen snapshot (null if never stabilized). */
  getLastSnapshot(): string | null;
  /** Get timestamp of last feed() call (for continuation detection). */
  getLastMutationTimestamp(): number;
  /** Destroy and clean up timers. */
  destroy(): void;
}

export interface TranscriptStabilizerOptions {
  /** Inactivity window in ms before firing onStable. Defaults to 1200. */
  freezeWindowMs?: number;
}

/**
 * Create a transcript stabilizer instance.
 *
 * @param onStable - callback fired with immutable snapshot once inactivity window passes
 * @param options  - configuration (freezeWindowMs defaults to 1200)
 */
export function createTranscriptStabilizer(
  onStable: (snapshot: string) => void,
  options?: TranscriptStabilizerOptions,
): TranscriptStabilizer {
  const freezeWindowMs = options?.freezeWindowMs ?? 1200;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastRaw: string = "";
  let lastSnapshot: string | null = null;
  let lastMutationTimestamp: number = 0;
  let destroyed = false;

  function clearTimer(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function freeze(): void {
    timerId = null;
    if (destroyed) return;

    // Create an immutable frozen snapshot of the current transcript.
    const snapshot = Object.freeze(lastRaw) as string;
    lastSnapshot = snapshot;
    onStable(snapshot);
  }

  return {
    feed(rawTranscript: string): void {
      if (destroyed) return;

      lastRaw = rawTranscript;
      lastMutationTimestamp = Date.now();

      clearTimer();
      timerId = setTimeout(freeze, freezeWindowMs);
    },

    cancel(): void {
      clearTimer();
    },

    isStabilizing(): boolean {
      return timerId !== null;
    },

    getLastSnapshot(): string | null {
      return lastSnapshot;
    },

    getLastMutationTimestamp(): number {
      return lastMutationTimestamp;
    },

    destroy(): void {
      destroyed = true;
      clearTimer();
      lastRaw = "";
      lastSnapshot = null;
      lastMutationTimestamp = 0;
    },
  };
}
