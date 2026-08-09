import { describe, it, expect } from "vitest";
import {
  classifyUtterance,
  isUtteranceComplete,
  isWeakTerminator,
  shouldForceCommitInterim,
} from "./utterance-completeness";

describe("classifyUtterance / isUtteranceComplete", () => {
  it("treats a dangling connector as incomplete even with punctuation elsewhere", () => {
    expect(classifyUtterance("You mentioned Azure Data Factory and")).toBe("incomplete");
    expect(isUtteranceComplete("You mentioned Azure Data Factory and")).toBe(false);
  });

  it("treats a question-terminated clause as complete", () => {
    expect(classifyUtterance("Why did you choose Azure Data Factory over Databricks?")).toBe(
      "question",
    );
    expect(isUtteranceComplete("Why did you choose Azure Data Factory over Databricks?")).toBe(
      true,
    );
  });

  it("treats a period-terminated lead-in as a weak terminator, not a strong question", () => {
    expect(isWeakTerminator("You mentioned Azure Data Factory.")).toBe(true);
  });
});

describe("shouldForceCommitInterim — 300ms interim->final promotion gate (Mini-Phase 2b)", () => {
  const MAX_WAIT_MS = 6000;

  it("does NOT commit an incomplete mid-question clause immediately after a short pause", () => {
    // Interviewer paused mid-question: "...responsibilities, challenges, resolutions, and"
    const incompleteClause =
      "Can you introduce yourself and walk me through your most recent project? " +
      "Please explain the business problem, architecture, technology stack, " +
      "responsibilities, challenges, resolutions, and";
    expect(shouldForceCommitInterim(incompleteClause, 300, MAX_WAIT_MS)).toBe(false);
  });

  it("keeps waiting on the same incomplete clause as the pause continues, up to the bound", () => {
    const incompleteClause = "...challenges, resolutions, and";
    expect(shouldForceCommitInterim(incompleteClause, 3000, MAX_WAIT_MS)).toBe(false);
    expect(shouldForceCommitInterim(incompleteClause, 5999, MAX_WAIT_MS)).toBe(false);
  });

  it("eventually force-commits an incomplete clause once the max-wait bound is reached, so words are never lost outright", () => {
    const incompleteClause = "...challenges, resolutions, and";
    expect(shouldForceCommitInterim(incompleteClause, 6000, MAX_WAIT_MS)).toBe(true);
    expect(shouldForceCommitInterim(incompleteClause, 9000, MAX_WAIT_MS)).toBe(true);
  });

  it("commits a complete question the moment it arrives, regardless of wait time", () => {
    const fullReconstructedQuestion =
      "Can you introduce yourself and walk me through your most recent project? " +
      "Please explain the business problem, architecture, technology stack, " +
      "responsibilities, challenges, resolutions, and optimizations?";
    expect(shouldForceCommitInterim(fullReconstructedQuestion, 300, MAX_WAIT_MS)).toBe(true);
  });

  it("end-to-end: a long multi-clause question with a natural pause triggers exactly once, on the full text", () => {
    // Simulates the interim-commit timer's decision sequence across a pause.
    const events: { text: string; waitedMs: number }[] = [
      { text: "Can you introduce yourself and walk me through your most recent project? Please explain the business problem, architecture, technology stack, responsibilities, challenges, resolutions, and", waitedMs: 300 },
      { text: "Can you introduce yourself and walk me through your most recent project? Please explain the business problem, architecture, technology stack, responsibilities, challenges, resolutions, and", waitedMs: 1500 }, // still paused
      { text: "Can you introduce yourself and walk me through your most recent project? Please explain the business problem, architecture, technology stack, responsibilities, challenges, resolutions, and optimizations?", waitedMs: 300 }, // interviewer resumed, full question arrived
    ];

    let commits = 0;
    let committedText = "";
    for (const { text, waitedMs } of events) {
      if (shouldForceCommitInterim(text, waitedMs, MAX_WAIT_MS)) {
        commits += 1;
        committedText = text;
      }
    }

    expect(commits).toBe(1); // exactly once — the incomplete clause never fired
    expect(committedText.endsWith("optimizations?")).toBe(true); // fired on the full question
  });
});

describe("shouldForceCommitInterim — useFloatingSession.ts scheduleFallbackCommit parity fix", () => {
  // Matches FALLBACK_MAX_INCOMPLETE_WAIT_MS in useFloatingSession.ts, which
  // now gates scheduleFallbackCommit through this exact shared function
  // instead of a bare elapsed-timer. SYSTEM_STT_INTERIM_FALLBACK_MS (300ms)
  // is the interval scheduleFallbackCommit re-checks on while waiting.
  const MAX_WAIT_MS = 6000;
  const FALLBACK_INTERVAL_MS = 300;

  it("does NOT force-commit the earliest progressive fragment just because the 300ms fallback timeout elapsed once", () => {
    // Proven runtime trace: Deepgram emitted "Can you explain" as an early
    // interim chunk; scheduleFallbackCommit used to force-commit it as its
    // own transcript row the moment 300ms elapsed with no new interim.
    expect(shouldForceCommitInterim("Can you explain", FALLBACK_INTERVAL_MS, MAX_WAIT_MS)).toBe(
      false,
    );
  });

  it("keeps waiting through the progressive growth observed in the runtime trace while still incomplete", () => {
    const progressiveFragments = [
      "Can you explain",
      "Can you explain the difference",
      "Can you explain the difference between an interface",
      "Can you explain the difference between an interface and an abstract",
      "Can you explain the difference between an interface and an abstract class in object-oriented programming",
    ];
    for (const fragment of progressiveFragments) {
      // Even after several fallback-interval re-checks (still well under the
      // 6000ms ceiling), none of these should trigger a commit — every one
      // trails off with no terminal punctuation.
      expect(shouldForceCommitInterim(fragment, FALLBACK_INTERVAL_MS, MAX_WAIT_MS)).toBe(false);
      expect(shouldForceCommitInterim(fragment, 3000, MAX_WAIT_MS)).toBe(false);
    }
  });

  it("commits a genuinely complete standalone question immediately, without waiting for the max-wait ceiling", () => {
    expect(
      shouldForceCommitInterim("What's your name?", FALLBACK_INTERVAL_MS, MAX_WAIT_MS),
    ).toBe(true);
  });

  it("the shared max-wait ceiling still forces a commit for a sufficiently stale incomplete fragment (no words lost forever)", () => {
    const stillIncomplete =
      "Can you explain the difference between an interface and an abstract class in object-oriented programming and";
    expect(shouldForceCommitInterim(stillIncomplete, MAX_WAIT_MS - 1, MAX_WAIT_MS)).toBe(false);
    expect(shouldForceCommitInterim(stillIncomplete, MAX_WAIT_MS, MAX_WAIT_MS)).toBe(true);
  });

  it("end-to-end: the full observed runtime fragment sequence produces exactly ONE commit, on the complete compound question", () => {
    // Reconstructs the exact progressive sequence from the proven runtime
    // trace (interim chunks growing, mid-question pause, then the trailing
    // clause arriving), each checked at a plausible waitedMs since the
    // fallback timer started re-arming for this utterance.
    const events: { text: string; waitedMs: number }[] = [
      { text: "Can you explain", waitedMs: 300 },
      { text: "Can you explain the difference", waitedMs: 600 },
      { text: "Can you explain the difference between an interface", waitedMs: 900 },
      {
        text: "Can you explain the difference between an interface and an abstract",
        waitedMs: 1200,
      },
      {
        // natural mid-question pause here — Deepgram briefly stops sending
        // new interim text, but the fragment is still grammatically
        // incomplete (trails off, no terminator)
        text:
          "Can you explain the difference between an interface and an abstract class in object-oriented programming",
        waitedMs: 2400,
      },
      {
        // interviewer resumes; full compound question arrives complete
        text:
          "Can you explain the difference between an interface and an abstract class in object-oriented programming, and give a practical example of when you would use each?",
        waitedMs: 300,
      },
    ];

    let commits = 0;
    let committedText = "";
    for (const { text, waitedMs } of events) {
      if (shouldForceCommitInterim(text, waitedMs, MAX_WAIT_MS)) {
        commits += 1;
        committedText = text;
      }
    }

    // Exactly one transcript commit for the whole spoken question — not one
    // per progressive fragment (the proven bug: repeated "inserted" outcomes
    // on partial fragments) and not split at the mid-question pause.
    expect(commits).toBe(1);
    expect(committedText).toBe(
      "Can you explain the difference between an interface and an abstract class in object-oriented programming, and give a practical example of when you would use each?",
    );
  });
});
