/**
 * Mini-Phase 3 — consumed-boundary walk for the auto-gen stabilizer feed.
 *
 * Extracted from the "feed the stabilizer" effect in useFloatingSession.ts
 * (matching the autoScrollPolicy.ts / autoGenQuestionSource.ts pattern used
 * elsewhere in this codebase) so the exact boundary-exclusion behavior is
 * unit-testable without rendering the hook.
 *
 * Walks backward from the end of the transcript, collecting consecutive
 * Interviewer messages, stopping at the first User message (candidate
 * responded → new turn) OR at the baseline id (everything at/before it was
 * already consumed by a prior accepted auto-gen turn — see
 * autoGenBaselineIdRef in useFloatingSession.ts, which is now advanced right
 * after a turn is accepted for generation). This is what prevents an
 * already-answered question from leaking into the next one even when there
 * is no candidate mic utterance in between the two interviewer turns.
 */

export interface TrailingWalkMessage {
  id: string;
  sender: "User" | "Interviewer";
  text: string;
}

/** Shared floating-overlay inactivity contract. Punctuation never bypasses it. */
export const AUTO_GEN_INACTIVITY_MS = 2000;

/** Find the baseline used when enabling auto-generation over existing history. */
export function findNewestInterviewerMessageId(
  messages: readonly TrailingWalkMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.sender === "Interviewer" && message.text?.trim()) {
      return message.id;
    }
  }
  return null;
}

/**
 * Decide whether a committed transcript candidate contains new activity.
 * Keeping the last rejected id/blob prevents an identical Redux message
 * update from re-arming the inactivity timer, while any new id or text is
 * still eligible to extend the current interviewer turn.
 */
export function shouldFeedAutoGenCandidate(
  lastFedId: string | null,
  lastFedBlob: string,
  newestId: string,
  nextBlob: string,
): boolean {
  return lastFedId !== newestId || lastFedBlob !== nextBlob;
}

export function computeTrailingInterviewerMessages<T extends TrailingWalkMessage>(
  messages: readonly T[],
  baselineId: string | null,
): T[] {
  const trailing: T[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.sender === "User") break;
    if (m.sender !== "Interviewer") continue;
    if (!m.text?.trim()) continue;
    if (baselineId && m.id === baselineId) break;
    trailing.unshift(m);
  }
  return trailing;
}
