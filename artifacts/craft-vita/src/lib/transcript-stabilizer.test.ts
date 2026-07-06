import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTranscriptStabilizer } from "./transcript-stabilizer";
import { isUtteranceComplete } from "./utterance-completeness";

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

  it("classic pure-debounce behaviour is preserved when no completeness gate is set", () => {
    const onStable = vi.fn();
    const s = createTranscriptStabilizer(onStable, { freezeWindowMs: 800 });
    s.feed("anything at all, even a fragment");
    vi.advanceTimersByTime(800);
    expect(onStable).toHaveBeenCalledTimes(1);
    s.destroy();
  });
});
