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
  /**
   * Record meaningful speech activity WITHOUT changing the stable snapshot.
   *
   * The generation snapshot is only fed from committed transcript rows, which
   * lag raw STT by the fallback-commit debounce (and by Deepgram's own final
   * latency). Raw interim events therefore used to leave the inactivity
   * countdown running even though the interviewer was demonstrably still
   * speaking — a new interim arriving 100ms before the window elapsed could
   * not stop the fire. Call this from the raw STT path so the countdown is
   * driven by actual speech activity rather than by transcript-commit timing.
   *
   * Deliberately does NOT touch `lastRaw` (unstable interim text must never
   * become generation input) and never STARTS a countdown — it only re-arms
   * one already running, so activity before the first feed() cannot produce a
   * phantom generation.
   */
  noteActivity(): void;
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
   * Ceiling (ms) of INACTIVITY (time since the most recent feed() OR
   * noteActivity()) after which the stabilizer fires even if `isComplete` is
   * still false — a last-resort safety valve for a genuinely stalled,
   * unpunctuated-but-finished utterance (e.g. an STT hiccup) so it doesn't
   * wait forever. Defaults to 6000. Only meaningful when `isComplete` is
   * provided.
   *
   * Measured from the last speech ACTIVITY, NOT from when the utterance
   * started. A long, actively-spoken multi-clause question (30-60s+) keeps
   * resetting this via its own STT activity, so total speaking duration never
   * counts against the ceiling — only a real gap with zero new STT activity
   * does.
   * (Measuring from utterance-start instead would force-fire on an
   * incomplete snapshot the instant a long-but-still-ongoing question
   * happened to cross this duration, even with the interviewer still mid-turn
   * — the exact defect this ceiling must not reintroduce.)
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
  // When the stable snapshot CONTENT last changed (feed() only). Exposed via
  // getLastMutationTimestamp() for continuation detection.
  let lastMutationTimestamp: number = 0;
  // When meaningful speech activity was last observed (feed() OR
  // noteActivity()). Distinct from the above on purpose: raw interim activity
  // must keep the utterance alive without pretending the snapshot changed.
  // This — not content mutation — is what maxWaitMs measures.
  let lastActivityTimestamp: number = 0;
  // The exact complete-but-weak snapshot awaiting a confirmation window. Fires
  // only if the next freeze sees this identical snapshot (interviewer stayed
  // quiet); cleared whenever new speech mutates the transcript.
  let pendingConfirmSnapshot: string | null = null;
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
    // Inactivity since the last speech ACTIVITY — NOT utterance age, and not
    // time since the last committed transcript row. See maxWaitMs doc comment
    // above: this must never count active/paused-but-continuing speech against
    // the ceiling, only a genuine gap with zero new STT activity (a
    // stalled/unpunctuated utterance).
    const sinceLastActivity =
      lastActivityTimestamp > 0 ? Date.now() - lastActivityTimestamp : 0;

    // maxWait ceiling always wins — never defer a genuinely STALLED (but
    // unpunctuated) utterance forever.
    if (sinceLastActivity >= maxWaitMs) {
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
      lastActivityTimestamp = lastMutationTimestamp;

      clearTimer();
      timerId = setTimeout(freeze, freezeWindowMs);
    },

    noteActivity(): void {
      if (destroyed) return;
      lastActivityTimestamp = Date.now();

      // Nothing is counting down yet (no stable transcript has ever been fed,
      // or it already fired/was cancelled) — starting a timer here would fire
      // on a stale or empty snapshot.
      if (timerId === null) return;

      // The interviewer is audibly still going, so a snapshot awaiting a quiet
      // confirmation window has not in fact been quiet.
      pendingConfirmSnapshot = null;

      clearTimer();
      timerId = setTimeout(freeze, freezeWindowMs);
    },

    cancel(): void {
      clearTimer();
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
      lastActivityTimestamp = 0;
      pendingConfirmSnapshot = null;
    },
  };
}
