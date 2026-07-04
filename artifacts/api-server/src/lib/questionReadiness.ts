/**
 * questionReadiness — server-side guard that decides whether a transcript is a
 * COMPLETE, answerable question, or just an in-flight STT fragment.
 *
 * Why this lives on the server: both the web auto-answer pipeline
 * (ActiveSession stabilizer) and the desktop pipeline (useFloatingSession
 * click/shortcut) POST to the same /ai-answer endpoint. A guard here protects
 * BOTH paths and BOTH modes (auto + manual) at once — the single chokepoint.
 *
 * This is deliberately conservative: it only rejects text that is clearly a
 * fragment, so a genuine (if terse) question is never blocked. When a manual
 * click explicitly forces generation, callers can bypass via `force`.
 *
 * The failure this fixes: in production, fragments like
 *   "Can you introduce yourself and walk me through your"
 * reached the model and produced a broken "I don't see the actual interview
 * question in your message" answer. That should never be generated.
 */

/** Words that, when a fragment ENDS on them, signal the sentence is unfinished. */
const TRAILING_INCOMPLETE_WORDS = new Set([
  // conjunctions / prepositions / articles that never end a real question
  "and", "or", "but", "so", "with", "the", "a", "an", "to", "of", "for", "in",
  "on", "at", "by", "from", "as", "your", "my", "our", "their", "his", "her",
  "its", "this", "that", "these", "those", "walk", "me", "through", "about",
  "into", "over", "under", "using", "via", "per", "including",
]);

/** Interrogative / imperative lead-ins that mark a real interview prompt. */
const QUESTION_SIGNALS = [
  "what", "why", "how", "when", "where", "who", "which", "whom", "whose",
  "can", "could", "would", "will", "do", "does", "did", "is", "are", "was",
  "were", "have", "has", "should", "explain", "describe", "write", "design",
  "implement", "tell", "walk", "give", "provide", "compare", "define",
  "consider", "suppose", "imagine", "solve", "optimize", "debug", "refactor",
  "create", "build", "list", "name", "discuss", "outline", "demonstrate",
];

export interface QuestionReadiness {
  ready: boolean;
  reason: string;
}

/**
 * Decide whether `text` is a complete, answerable question.
 *
 * @param text  the resolved question/transcript
 * @param opts.force  when true (explicit manual click), only empties are rejected
 */
export function assessQuestionReadiness(
  text: string,
  opts?: { force?: boolean },
): QuestionReadiness {
  const trimmed = (text ?? "").trim();

  if (!trimmed) return { ready: false, reason: "empty" };

  // A forced/manual generation only needs to be non-empty — the user
  // deliberately asked for an answer, so we respect that.
  if (opts?.force) return { ready: true, reason: "forced" };

  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // A reasonably long utterance that already contains a complete question
  // (has a '?' somewhere, not just at the very end) is answerable even if STT
  // appended a trailing fragment. e.g. "Can you introduce yourself? And walk"
  // — the '?' proves a real question is present. Answer it; don't reject on the
  // dangling tail.
  if (trimmed.includes("?") && wordCount >= 4) {
    return { ready: true, reason: "contains_complete_question" };
  }

  // Too short to be a real question (single words, "self introduction" stubs).
  if (wordCount < 4) {
    if (!trimmed.endsWith("?")) {
      return { ready: false, reason: `too_short (${wordCount} words)` };
    }
  }

  const lastWord = words[words.length - 1]!
    .toLowerCase()
    .replace(/[^a-z']/g, "");

  // Ends on a dangling conjunction/preposition/article with no terminal
  // punctuation → likely an STT fragment mid-sentence. But ONLY treat this as
  // unready when the utterance is also short (< 10 words). A long utterance is
  // probably a real, already-stated question that STT is still extending — we'd
  // rather answer it than drop it. This keeps the guard narrow: it catches
  // genuine lead-in fragments ("Write a Dockerfile to containerize a") without
  // rejecting substantial questions.
  if (
    wordCount < 10 &&
    !/[.?!:;]$/.test(trimmed) &&
    TRAILING_INCOMPLETE_WORDS.has(lastWord)
  ) {
    return { ready: false, reason: `dangling_word (${lastWord})` };
  }

  // Must contain SOME interrogative/imperative signal OR terminal '?'. A blob
  // with neither is usually noise or an unfinished lead-in.
  const lower = trimmed.toLowerCase();
  const hasSignal =
    trimmed.includes("?") ||
    QUESTION_SIGNALS.some((sig) => {
      // word-boundary match so "cannot" doesn't match "can" etc.
      const re = new RegExp(`(^|[^a-z])${sig}([^a-z]|$)`, "i");
      return re.test(lower);
    });

  if (!hasSignal) {
    return { ready: false, reason: "no_question_signal" };
  }

  return { ready: true, reason: "ready" };
}
