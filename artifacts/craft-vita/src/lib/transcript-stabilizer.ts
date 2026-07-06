/**
 * Transcript Stabilizer — debounced freeze window that prevents AI triggering
 * while STT transcript is still mutating.
 *
 * Framework-agnostic pure TypeScript. No external dependencies.
 *
 * COMPLETENESS GATE (Defect A fix): a plain inactivity debounce fires on ANY
 * pause, including a pause in the MIDDLE of a question. That produced two
 * production failures — firing on an incomplete fragment (model punts "I don't
 * see a question"), and firing on a partial window before the full question
 * arrived (model says the question was "cut off"). To fix both, the stabilizer
 * accepts an optional `isComplete` predicate: when the freeze window elapses on
 * an INCOMPLETE snapshot it RE-ARMS and keeps waiting (the interviewer is still
 * mid-sentence), only firing once the snapshot looks like a finished utterance.
 * A `maxWaitMs` ceiling guarantees a genuinely-finished-but-unpunctuated
 * utterance still fires after a bounded wait rather than stalling forever.
 *
 * The live transcript UI is unaffected — it renders interim/final fragments
 * directly from the STT hook, so speech still feels live; only the generation
 * TRIGGER waits for a stabilized, complete utterance.
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
  /**
   * Optional completeness predicate. When provided and it returns false for a
   * frozen snapshot, the stabilizer re-arms (keeps waiting) instead of firing,
   * so generation only triggers on a complete end-of-utterance. When omitted,
   * behaviour is the classic pure-debounce (fire on any freeze).
   */
  isComplete?: (snapshot: string) => boolean;
  /**
   * Ceiling (ms) from the first feed of the current utterance after which the
   * stabilizer fires even if `isComplete` is still false — prevents an
   * unpunctuated-but-finished utterance from stalling forever. Defaults to 6000.
   * Only meaningful when `isComplete` is provided.
   *
   * NOTE: this must be GENEROUS for long multi-clause questions. It is measured
   * from the first feed of the utterance, so if it is set too low a long
   * question that is still being spoken will be force-fired mid-sentence — the
   * exact "fires too early on a mid-question pause" defect. Keep it well above
   * the time a real long question takes to speak.
   */
  maxWaitMs?: number;
  /**
   * Optional weak-terminator predicate. When a frozen snapshot is `isComplete`
   * but `needsConfirmation` returns true (e.g. it ends on a `.`/`!` that is
   * often a mid-question LEAD-IN rather than the real question), the stabilizer
   * requires the snapshot to survive UNCHANGED across one additional freeze
   * window before firing. If the interviewer keeps talking, the snapshot
   * changes and the trigger is correctly deferred. Only meaningful when
   * `isComplete` is provided.
   */
  needsConfirmation?: (snapshot: string) => boolean;
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
  const isComplete = options?.isComplete;
  const maxWaitMs = options?.maxWaitMs ?? 6000;
  const needsConfirmation = options?.needsConfirmation;

  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastRaw: string = "";
  let lastSnapshot: string | null = null;
  let lastMutationTimestamp: number = 0;
  // The exact complete-but-weak snapshot awaiting a confirmation window. Fires
  // only if the next freeze sees this identical snapshot (interviewer stayed
  // quiet); cleared whenever new speech mutates the transcript.
  let pendingConfirmSnapshot: string | null = null;
  // Timestamp of the first feed() that started the CURRENT (not-yet-fired)
  // utterance. Reset to 0 after each fire so the next utterance gets a fresh
  // maxWait budget.
  let utteranceStartTs: number = 0;
  let destroyed = false;

  function clearTimer(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function fire(): void {
    // Create an immutable frozen snapshot of the current transcript.
    const snapshot = Object.freeze(lastRaw) as string;
    lastSnapshot = snapshot;
    utteranceStartTs = 0;
    pendingConfirmSnapshot = null;
    onStable(snapshot);
  }

  function freeze(): void {
    timerId = null;
    if (destroyed) return;

    // No completeness gate configured → classic debounce behaviour.
    if (!isComplete) {
      fire();
      return;
    }

    const snapshot = lastRaw;
    const waited = utteranceStartTs > 0 ? Date.now() - utteranceStartTs : 0;

    // maxWait ceiling always wins — never defer a genuinely finished (but
    // unpunctuated) utterance forever.
    if (waited >= maxWaitMs) {
      fire();
      return;
    }

    if (isComplete(snapshot)) {
      // Weak (statement-terminated) windows are frequently a mid-question
      // lead-in ("You mentioned X." <pause> "Why did you pick it?"). Require the
      // snapshot to survive one extra quiet freeze window before firing so the
      // interviewer has a chance to continue into the real question.
      if (needsConfirmation && needsConfirmation(snapshot)) {
        if (pendingConfirmSnapshot === snapshot) {
          fire();
          return;
        }
        pendingConfirmSnapshot = snapshot;
        timerId = setTimeout(freeze, freezeWindowMs);
        return;
      }
      fire();
      return;
    }

    // Snapshot no longer complete (interviewer resumed) — drop any pending
    // confirmation and keep waiting.
    pendingConfirmSnapshot = null;

    // Still mid-utterance and within budget — re-arm and keep waiting for the
    // interviewer to finish the sentence (or for the maxWait ceiling).
    timerId = setTimeout(freeze, freezeWindowMs);
  }

  return {
    feed(rawTranscript: string): void {
      if (destroyed) return;

      // New speech invalidates any pending statement-confirmation.
      if (rawTranscript !== lastRaw) pendingConfirmSnapshot = null;
      lastRaw = rawTranscript;
      lastMutationTimestamp = Date.now();
      if (utteranceStartTs === 0) utteranceStartTs = lastMutationTimestamp;

      clearTimer();
      timerId = setTimeout(freeze, freezeWindowMs);
    },

    cancel(): void {
      clearTimer();
      utteranceStartTs = 0;
      pendingConfirmSnapshot = null;
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
      utteranceStartTs = 0;
      pendingConfirmSnapshot = null;
    },
  };
}
