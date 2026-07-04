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

  // Too short to be a real question (single words, "self introduction" stubs).
  // Follow-ups like "Why?" are handled by the caller passing force/previous
  // context; the bare auto path needs at least a few words.
  if (wordCount < 4) {
    // Allow a short line only if it clearly terminates as a question.
    if (!trimmed.endsWith("?")) {
      return { ready: false, reason: `too_short (${wordCount} words)` };
    }
  }

  const lastWord = words[words.length - 1]!
    .toLowerCase()
    .replace(/[^a-z']/g, "");

  // Ends on a dangling conjunction/preposition/article and has no terminal
  // punctuation → an STT fragment mid-sentence, e.g. "...walk me through your".
  if (
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
