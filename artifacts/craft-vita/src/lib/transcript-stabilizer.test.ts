import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTranscriptStabilizer } from "./transcript-stabilizer";
import {
  isUtteranceComplete,
  isWeakTerminator,
  classifyUtterance,
} from "./utterance-completeness";
import { AUTO_GEN_INACTIVITY_MS } from "../features/session/hooks/autoGenTrailingTranscript";

// -------------------------------------------------------------------------
// Defect A — the question-detection / answer-trigger must only fire on a
// STABILIZED, COMPLETE utterance, never on a raw interim fragment. The
// fragment sequences below mirror the real transcript evidence
// (session 93270d42): the interviewer paused MID-question, so the pipeline
// used to fire on the incomplete first half.
// -------------------------------------------------------------------------

describe("isUtteranceComplete", () => {
  it("treats mid-sentence fragments as INCOMPLETE (false-fire guard)", () => {
    // Interviewer paused after "...Azure Data" — the real false-fire that made
    // the model punt "I don't see a new follow-up question".
    expect(
      isUtteranceComplete(
        "Follow-up one. Okay. You mentioned that you used Azure Data",
      ),
    ).toBe(false);
    // Trailing conjunction / preposition / article = still speaking.
    expect(isUtteranceComplete("So given all that, how would")).toBe(false);
    expect(isUtteranceComplete("Why did you choose Azure Data Factory over")).toBe(
      false,
    );
    expect(isUtteranceComplete("Let's start with the")).toBe(false);
    expect(isUtteranceComplete("")).toBe(false);
    expect(isUtteranceComplete("   ")).toBe(false);
  });

  it("treats a punctuation-terminated question as COMPLETE (false-cutoff guard)", () => {
    // The full question DID arrive across fragments — it must be recognised as
    // complete, not declared "cut off mid-sentence".
    expect(
      isUtteranceComplete(
        "Why did you choose Azure Data Factory over Databricks for ingestion?",
      ),
    ).toBe(true);
    expect(
      isUtteranceComplete("So given all that, how would you handle that?"),
    ).toBe(true);
    expect(isUtteranceComplete("Let's start with your most recent project.")).toBe(
      true,
    );
    expect(isUtteranceComplete('Explain it end to end!')).toBe(true);
    // Terminator just inside a closing quote still counts.
    expect(isUtteranceComplete('What do you mean by "idempotent"?')).toBe(true);
  });

  it("treats short back-channels terminated by smart_format as INCOMPLETE", () => {
    // These settle with a period but are NOT answerable questions — firing on
    // them produced spurious auto-answers between the interviewer's real
    // sentences.
    expect(isUtteranceComplete("Okay.")).toBe(false);
    expect(isUtteranceComplete("Right.")).toBe(false);
    expect(isUtteranceComplete("Got it.")).toBe(false);
    expect(isUtteranceComplete("Mm hmm.")).toBe(false);
    // A genuine 3+ word question is still complete.
    expect(isUtteranceComplete("Tell me more.")).toBe(true);
  });

  it("classifies weak (statement) vs strong (question) terminators", () => {
    expect(classifyUtterance("You mentioned you used Azure Data Factory.")).toBe(
      "statement",
    );
    expect(isWeakTerminator("You mentioned you used Azure Data Factory.")).toBe(
      true,
    );
    expect(classifyUtterance("Why did you choose it over Databricks?")).toBe(
      "question",
    );
    expect(isWeakTerminator("Why did you choose it over Databricks?")).toBe(false);
    expect(classifyUtterance("You mentioned that you used Azure Data")).toBe(
      "incomplete",
    );
  });
});

describe("createTranscriptStabilizer — completeness gate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("fires once when a complete utterance settles", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 1000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 6000,
    });

    s.feed("Why did you choose Azure Data Factory over Databricks?");
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);

    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "Why did you choose Azure Data Factory over Databricks?",
    );
    s.destroy();
  });

  it("does NOT fire on an incomplete mid-sentence fragment, then fires once completed", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 1000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 10000,
    });

    // Fragment 1: interviewer pauses mid-question.
    s.feed("You mentioned that you used Azure Data");
    vi.advanceTimersByTime(1000); // freeze elapses -> INCOMPLETE -> re-arm
    expect(onStable).not.toHaveBeenCalled();

    // A longer-than-freeze pause while still mid-utterance must NOT fire.
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();

    // Fragment 2 completes the question.
    s.feed(
      "You mentioned that you used Azure Data Factory. Why did you choose it over Databricks?",
    );
    vi.advanceTimersByTime(1000);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "You mentioned that you used Azure Data Factory. Why did you choose it over Databricks?",
    );
    s.destroy();
  });

  it("force-fires an unpunctuated-but-finished utterance after maxWaitMs", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 1000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 3000,
    });

    // Interviewer trails off without smart_format ever adding a terminator.
    s.feed("Walk me through your most recent Azure project end to end");
    // Poll across several freeze windows — stays deferred until maxWait.
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); // now >= maxWaitMs from first feed
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("does NOT force-fire a long multi-clause question mid-sentence (generous maxWait)", () => {
    // Regression: maxWaitMs is measured from the FIRST feed, so a low ceiling
    // force-fires a long question that is still being spoken. With a generous
    // ceiling the incomplete window keeps re-arming across the pauses.
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 2000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 22000,
      needsConfirmation: isWeakTerminator,
    });

    // Long question spoken clause-by-clause with sub-freeze pauses, each still
    // ending mid-clause (incomplete). Total elapsed ~10s — under a low 6s cap
    // this would have force-fired; it must NOT here.
    s.feed("So thinking about the pipeline you built, you mentioned");
    vi.advanceTimersByTime(1500);
    s.feed("So thinking about the pipeline you built, you mentioned Azure Data Factory and");
    vi.advanceTimersByTime(1500);
    s.feed(
      "So thinking about the pipeline you built, you mentioned Azure Data Factory and orchestration, so I'm curious how",
    );
    vi.advanceTimersByTime(1500);
    s.feed(
      "So thinking about the pipeline you built, you mentioned Azure Data Factory and orchestration, so I'm curious how you would",
    );
    vi.advanceTimersByTime(1500);
    expect(onStable).not.toHaveBeenCalled();

    // The question finally completes with a `?`.
    s.feed(
      "So thinking about the pipeline you built, you mentioned Azure Data Factory and orchestration, so I'm curious how you would handle a schema change?",
    );
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "So thinking about the pipeline you built, you mentioned Azure Data Factory and orchestration, so I'm curious how you would handle a schema change?",
    );
    s.destroy();
  });

  it("defers a statement lead-in until the real question arrives (confirmation gate)", () => {
    // "You mentioned X." <pause> "Why did you pick it?" — the lead-in ends on a
    // period and is `isComplete`, but must NOT fire; the interviewer continues.
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 2000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 22000,
      needsConfirmation: isWeakTerminator,
    });

    s.feed("You mentioned that you used Azure Data Factory.");
    vi.advanceTimersByTime(2000); // freeze -> weak/complete -> await confirmation
    expect(onStable).not.toHaveBeenCalled();

    // Interviewer resumes into the actual question before confirmation elapses.
    s.feed("You mentioned that you used Azure Data Factory. Why did you choose it over Databricks?");
    vi.advanceTimersByTime(2000); // strong terminator -> fire once
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "You mentioned that you used Azure Data Factory. Why did you choose it over Databricks?",
    );
    s.destroy();
  });

  it("fires a genuine statement-form prompt after the confirmation window", () => {
    // A standalone statement-form prompt ("Walk me through your project.") that
    // the interviewer does NOT continue must still fire — after one extra quiet
    // freeze window of confirmation.
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 2000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 22000,
      needsConfirmation: isWeakTerminator,
    });

    s.feed("Walk me through your most recent project.");
    vi.advanceTimersByTime(2000); // first freeze -> awaits confirmation
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000); // confirmation window elapses unchanged -> fire
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("classic pure-debounce behaviour is preserved when no completeness gate is set", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, { freezeWindowMs: 800 });
    s.feed("anything at all, even a fragment");
    vi.advanceTimersByTime(800);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("maxWaitMs is measured from the LAST feed, not utterance age (Mini-Phase 3, Correction 1)", () => {
    // Regression for the real bug: with the OLD utteranceStartTs-based ceiling,
    // an actively-spoken utterance whose TOTAL elapsed time crossed maxWaitMs
    // would force-fire on its next freeze even though new feeds kept arriving
    // (the interviewer was still mid-turn). Measuring from the most recent
    // feed instead means periodic re-feeds keep resetting the ceiling
    // indefinitely — it only fires after a genuine gap with NO new feed.
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 2000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 22000,
    });

    // Feed an ever-growing, still-incomplete fragment every 1800ms (under the
    // freeze window, so freeze() never even runs) for well over 22 seconds
    // of TOTAL utterance age.
    let text = "So thinking about the overall system design here, you would need to consider";
    for (let i = 0; i < 15; i++) {
      s.feed(text);
      vi.advanceTimersByTime(1800);
      text += " and also this additional consideration point number " + i;
    }
    // ~27 seconds of total utterance age have elapsed, entirely via active
    // feeds — the ceiling must NOT have fired despite exceeding 22000ms of
    // total age, because it was never 22000ms since the LAST feed.
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("true stall (zero feeds) still force-fires via maxWaitMs (Mini-Phase 3 — last-resort safety valve intact)", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, {
      freezeWindowMs: 1000,
      isComplete: isUtteranceComplete,
      maxWaitMs: 5000,
    });
    s.feed("Walk me through your most recent Azure project end to end");
    // No further feeds at all — a genuine stall (e.g. STT hiccup).
    vi.advanceTimersByTime(5000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });
});

// -------------------------------------------------------------------------
// Mini-Phase 3 — the ACTUAL useFloatingSession.ts production configuration:
// freezeWindowMs 2000, no needsConfirmation. Punctuation strength ("?" vs
// "."/"!") no longer determines how long the wait is — every complete
// snapshot requires the same single 2000ms inactivity window.
// -------------------------------------------------------------------------
describe("createTranscriptStabilizer — useFloatingSession.ts config: single 2000ms inactivity window, no confirmation stage", () => {
  const FLOATING_CONFIG = {
    freezeWindowMs: AUTO_GEN_INACTIVITY_MS,
    isComplete: isUtteranceComplete,
    maxWaitMs: 22000,
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("1. short complete question fires exactly once after 2000ms inactivity", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("What's your name?");
    vi.advanceTimersByTime(1999);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith("What's your name?");
    s.destroy();
  });

  it("2. a 60-second continuously-changing question produces zero premature fires while feeds continue", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    // Simulate ~60s of speech: a new (still-incomplete) chunk every 1.5s —
    // under the 2000ms window, so freeze() never gets a chance to run.
    let text = "Explain how race conditions can occur in an asynchronous system and";
    for (let i = 0; i < 40; i++) {
      s.feed(text);
      vi.advanceTimersByTime(1500);
      text += " furthermore point " + i + " and";
    }
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it('3. a "?" appearing mid-turn does not trigger immediate generation', () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    // Deepgram smart_format inserts a spurious "?" mid-turn (real observed
    // behavior); the interviewer keeps talking before 2000ms elapses.
    s.feed("How would you detect and prevent them?");
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();
    s.feed(
      "How would you detect and prevent them, and can you give a practical example involving two concurrent API requests updating the same database record?",
    );
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled(); // timer reset by the new feed, only 1000ms since it
    vi.advanceTimersByTime(1000);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "How would you detect and prevent them, and can you give a practical example involving two concurrent API requests updating the same database record?",
    );
    s.destroy();
  });

  it('4. a "." or "!" appearing mid-turn does not trigger immediate generation (same uniform wait as "?")', () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Explain how race conditions can occur in an asynchronous Node.js application.");
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();
    s.feed(
      "Explain how race conditions can occur in an asynchronous Node.js application. How would you detect and prevent them?",
    );
    vi.advanceTimersByTime(1000);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("5. natural pauses shorter than the 2000ms threshold do not trigger generation", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Suppose you have an API endpoint that retrieves user data but");
    vi.advanceTimersByTime(1500); // a 1.5s breath — under the threshold
    expect(onStable).not.toHaveBeenCalled();
    s.feed("Suppose you have an API endpoint that retrieves user data but it becomes slow");
    vi.advanceTimersByTime(1500);
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("6. new STT arriving just before the timeout resets the timer", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about a challenging project you worked on?");
    vi.advanceTimersByTime(1900); // 100ms shy of firing
    expect(onStable).not.toHaveBeenCalled();
    s.feed("Tell me about a challenging project you worked on recently?");
    vi.advanceTimersByTime(1900); // would have fired at the OLD 2000ms mark
    expect(onStable).not.toHaveBeenCalled(); // reset by the new feed
    vi.advanceTimersByTime(100);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "Tell me about a challenging project you worked on recently?",
    );
    s.destroy();
  });

  it("7. final genuine inactivity produces exactly one fire", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("What's your greatest strength?");
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    // No further feeds — must not fire again on its own.
    vi.advanceTimersByTime(10000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("8. duplicate identical feed() calls do not produce duplicate fires", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about yourself?");
    vi.advanceTimersByTime(500);
    s.feed("Tell me about yourself?"); // duplicate delivery, e.g. from a StrictMode-leaked listener
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("9. maxWaitMs does not force an actively-changing long question even past 22s of total age", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    let text = "Describe the trade-offs between consistency and availability and";
    for (let i = 0; i < 16; i++) {
      s.feed(text);
      vi.advanceTimersByTime(1500); // 24s of total age via regular feeds
      text += " plus consideration " + i + " and";
    }
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("10. a true stall (no further feeds) still fires via maxWaitMs as a last resort", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Walk me through the architecture end to end and"); // never completes
    // The ceiling is checked at each 2000ms re-arm poll; advance past the
    // 22000ms ceiling to guarantee the check has run.
    vi.advanceTimersByTime(23000); // zero new feeds this whole time
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });
});

// -------------------------------------------------------------------------
// Activity heartbeat — the stabilizer is FED from committed transcript rows,
// which lag raw STT by scheduleFallbackCommit's debounce plus Deepgram's own
// final latency. Before noteActivity() the 2000ms countdown was therefore
// "2000ms since the last committed row", not "2000ms since the interviewer
// last spoke": a fresh interim arriving 100ms before the window elapsed could
// not stop the fire. These tests pin the corrected semantics.
// -------------------------------------------------------------------------
describe("createTranscriptStabilizer — noteActivity() heartbeat", () => {
  const FLOATING_CONFIG = {
    freezeWindowMs: AUTO_GEN_INACTIVITY_MS,
    isComplete: isUtteranceComplete,
    maxWaitMs: 22000,
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /**
   * Mirrors the production wiring in useFloatingSession.ts:
   *  - every non-empty interviewer STT event (interim OR final) →
   *    handleInterviewerTranscript → noteActivity()
   *  - only a COMMITTED transcript row → the [autoGenerate, messages] effect
   *    → feed()
   * Keeping the two separate here is the whole point: raw STT drives the
   * countdown, committed transcript drives the content.
   */
  function sttDriver(s: ReturnType<typeof createTranscriptStabilizer>) {
    return {
      sttEvent(text: string) {
        if (text.trim()) s.noteActivity();
      },
      commitRow(blob: string) {
        s.feed(blob);
      },
    };
  }

  it("1. activity 100ms before the deadline prevents the fire", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about yourself?");
    vi.advanceTimersByTime(1900);
    s.noteActivity();
    vi.advanceTimersByTime(100);
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("2. after that activity, a fresh full 2000ms of silence produces exactly one fire", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about yourself?");
    vi.advanceTimersByTime(1900);
    s.noteActivity();
    vi.advanceTimersByTime(1999);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("3. noteActivity() does not change the generation content — the fired snapshot is the original fed blob", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stable = "Tell me about yourself?";
    s.feed(stable);
    const mutatedAt = s.getLastMutationTimestamp();
    vi.advanceTimersByTime(1900);
    s.noteActivity();
    s.noteActivity();
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledWith(stable);
    expect(onStable).toHaveBeenCalledTimes(1);
    // Content-mutation time is a distinct concept from activity time and must
    // NOT be moved by a heartbeat (it drives continuation detection).
    expect(s.getLastMutationTimestamp()).toBe(mutatedAt);
    s.destroy();
  });

  it("4. noteActivity() before any feed() starts no phantom countdown and never fires", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.noteActivity();
    expect(s.isStabilizing()).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("4b. noteActivity() after a fire does not restart a countdown on the stale snapshot", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about yourself?");
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.noteActivity();
    vi.advanceTimersByTime(60000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("5. heartbeats every 1s for 60s produce zero fires, with no feed() in between", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    // Complete-looking ("?"-terminated) on purpose: punctuation must not
    // shorten the requirement, only genuine inactivity may fire it.
    s.feed("How would you debug this performance problem?");
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
      s.noteActivity();
    }
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("6. the same 60s of heartbeats does not trip the 22000ms maxWait ceiling", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    // Deliberately INCOMPLETE so the only thing that could fire it is the
    // maxWait ceiling — proving the ceiling measures inactivity, not age.
    s.feed("Walk me through the architecture end to end and");
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
      s.noteActivity();
    }
    expect(onStable).not.toHaveBeenCalled();
    // Once activity genuinely stops, the ceiling still works as a last resort.
    vi.advanceTimersByTime(25000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("7. a raw INTERIM interviewer event 100ms before the deadline invalidates the pending generation", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    stt.commitRow("Suppose you have an API endpoint?");
    vi.advanceTimersByTime(1900);
    stt.sttEvent("that retrieves user data"); // interim only — no commit yet
    vi.advanceTimersByTime(100);
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("8. a raw FINAL interviewer event 100ms before the deadline invalidates it too, and its later commit fires normally", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    stt.commitRow("Suppose you have an API endpoint?");
    vi.advanceTimersByTime(1900);
    // Final arrives: activity is noted synchronously; the committed row only
    // lands after the dispatch → effect round-trip.
    stt.sttEvent("that retrieves user data from a database.");
    vi.advanceTimersByTime(100);
    expect(onStable).not.toHaveBeenCalled();
    stt.commitRow(
      "Suppose you have an API endpoint? that retrieves user data from a database.",
    );
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(
      "Suppose you have an API endpoint? that retrieves user data from a database.",
    );
    s.destroy();
  });

  it("9. continuous interim STT with ZERO committed rows produces no generation while speech continues", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    stt.commitRow("How would you debug this performance problem?");
    // 30s of interims arriving every 400ms (Deepgram cadence). The fallback
    // commit keeps getting re-debounced upstream, so `messages` never changes
    // and feed() is never called again — the exact production gap.
    for (let i = 0; i < 75; i++) {
      vi.advanceTimersByTime(400);
      stt.sttEvent("and after finding the bottleneck how would you optimize");
    }
    expect(onStable).not.toHaveBeenCalled();
    s.destroy();
  });

  it("10. once STT activity genuinely stops, exactly one generation fires ~2000ms later", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    stt.commitRow("How would you debug this performance problem?");
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(400);
      stt.sttEvent("still talking");
    }
    vi.advanceTimersByTime(1999);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStable).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("13/15. a multi-sentence turn full of ?/./! punctuation still requires the same 2000ms of inactivity, and duplicate identical events fire only once", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    const turn =
      "How would you debug this performance problem? And after finding the bottleneck, how would you optimize it without downtime! Really.";
    stt.commitRow(turn);
    // Identical duplicate STT callbacks (upstream double-delivery) — safe to
    // reset activity, must not multiply generations.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      stt.sttEvent("Really.");
      stt.sttEvent("Really.");
    }
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onStable).toHaveBeenCalledTimes(1);
    expect(onStable).toHaveBeenCalledWith(turn);
    s.destroy();
  });

  it("empty/whitespace STT events are not meaningful activity and do not extend the turn", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    const stt = sttDriver(s);
    stt.commitRow("Tell me about yourself?");
    vi.advanceTimersByTime(1900);
    stt.sttEvent("   "); // Deepgram empty-final storm — must be ignored
    vi.advanceTimersByTime(100);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it("noteActivity() after destroy() is a no-op", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, FLOATING_CONFIG);
    s.feed("Tell me about yourself?");
    s.destroy();
    s.noteActivity();
    vi.advanceTimersByTime(60000);
    expect(onStable).not.toHaveBeenCalled();
  });
});
