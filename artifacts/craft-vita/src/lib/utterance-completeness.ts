/**
 * utterance-completeness.ts — decides whether an accumulated STT transcript
 * window is a COMPLETE end-of-utterance (safe to trigger AI answer generation)
 * versus an in-flight fragment the interviewer is still speaking.
 *
 * Framework-agnostic pure TypeScript. No external dependencies.
 *
 * WHY THIS EXISTS (production defects it fixes):
 *  The auto-answer trigger used to fire whenever the transcript went quiet for
 *  the stabilizer freeze window — including a *mid-sentence* pause. That caused
 *  two distinct failures seen in real transcripts:
 *
 *   1. FALSE-FIRE: the interviewer paused mid-question ("...you mentioned that
 *      you used Azure Data" <pause> "Why did you choose Azure Data Factory
 *      over Databricks?"). The freeze window elapsed on the incomplete first
 *      half, generation fired, and the model punted: "I don't see a new
 *      follow-up question in your message."
 *
 *   2. FALSE-CUTOFF: generation fired on a partial window before the full
 *      question "...how would you handle that?" had finished arriving, so the
 *      model complained the question was "cut off mid-sentence" and asked the
 *      user to repeat it — even though the complete question did arrive.
 *
 * SIGNAL: In this domain a real, finished interviewer question terminates on
 * sentence punctuation — Deepgram `smart_format` reliably appends `?`/`.`/`!`
 * at a genuine end-of-utterance. We therefore treat an utterance as complete
 * only when the ACCUMULATED window ENDS on terminal punctuation (interior
 * punctuation is ignored, so "Follow-up one. Okay. You mentioned..." is still
 * mid-utterance because it ENDS on "...Data" with no terminator).
 *
 * A trailing conjunction/preposition/article ("...and", "...to", "...the") is
 * an explicit incomplete signal even in the rare case punctuation is present.
 *
 * The stabilizer pairs this with a `maxWaitMs` fallback so a genuinely
 * unpunctuated-but-finished utterance still fires after a bounded wait rather
 * than stalling forever.
 */

/** Conjunctions / prepositions / articles that never end a finished question. */
const TRAILING_INCOMPLETE_RE =
  /\b(?:and|or|but|so|because|with|to|of|for|in|on|at|by|from|as|the|a|an|your|my|our|their|his|her|its|into|about|over|under|using|via|per|that|which)$/i;

/**
 * Minimum word count before a punctuation-terminated window can be treated as a
 * real, answerable interviewer question. Guards against firing on short
 * acknowledgements/back-channels that smart_format terminates with a period —
 * "Okay.", "Right.", "Got it.", "Mm hmm." — which are NOT questions and used to
 * trip the completeness gate the instant they settled.
 */
const MIN_UTTERANCE_WORDS = 3;

/** Strip trailing wrapping punctuation / quotes / whitespace so a genuine
 * terminator that sits just inside a closing quote or bracket still counts,
 * e.g. `handle that?"` or `(expose port 3000).`. */
function stripWrappingTail(trimmed: string): string {
  return trimmed.replace(/[\s"'’”)\]]+$/, "");
}

function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Classification of an accumulated STT window:
 *  - "incomplete": still mid-utterance (no terminator, dangling connector, or
 *    too short to be a real question) → NEVER trigger generation.
 *  - "statement":  ends on a weak terminator (`.`/`!`). In interviews this is
 *    frequently a LEAD-IN ("You mentioned you used Azure Data Factory.")
 *    spoken just before the actual question, so it must be CONFIRMED with an
 *    extra quiet window before it can trigger generation.
 *  - "question":   ends on `?` — a strong end-of-question signal, safe to
 *    trigger as soon as the freeze window settles.
 */
export type UtteranceKind = "incomplete" | "statement" | "question";

export function classifyUtterance(text: string): UtteranceKind {
  const trimmed = (text || "").trim();
  if (!trimmed) return "incomplete";

  const tail = stripWrappingTail(trimmed);
  if (!tail) return "incomplete";

  // Ends on a dangling connector/preposition/article → still mid-clause.
  if (TRAILING_INCOMPLETE_RE.test(tail)) return "incomplete";

  // No sentence/question terminator at the very end → still mid-utterance.
  if (!/[.?!]$/.test(tail)) return "incomplete";

  // Terminated, but too short to be a real answerable question (back-channel).
  if (wordCount(tail) < MIN_UTTERANCE_WORDS) return "incomplete";

  return /\?$/.test(tail) ? "question" : "statement";
}

/**
 * True when `text` reads as a complete, finished utterance suitable for
 * triggering auto-answer generation. Both "question" and "statement" kinds are
 * "complete"; callers that need to defer weak (statement) terminators for
 * confirmation should use {@link classifyUtterance} / {@link isWeakTerminator}.
 */
export function isUtteranceComplete(text: string): boolean {
  return classifyUtterance(text) !== "incomplete";
}

/**
 * True when the window is complete but ends on a WEAK terminator (`.`/`!`) — a
 * likely mid-question lead-in that should be confirmed with an extra quiet
 * window before generation fires, rather than fired on immediately.
 */
export function isWeakTerminator(text: string): boolean {
  return classifyUtterance(text) === "statement";
}
