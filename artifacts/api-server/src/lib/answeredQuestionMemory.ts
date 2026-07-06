/**
 * Answered-question memory — deterministic identity + re-answer guard.
 *
 * Root incident this addresses (spec "Still broken #1 — Wrong-question
 * answering"): a NEW scenario question triggered a re-run of an OLD
 * self-introduction because active-question detection latched onto stale
 * transcript and the auto path re-generated a question that had already been
 * answered moments earlier.
 *
 * This module gives every question a stable normalized identity and answers
 * one question only: "have we already answered something equivalent to this?"
 * It is intentionally pure and side-effect free so it can be unit-tested and
 * reused on both the auto path (backend re-answer guard) and, in spirit, the
 * frontend detector.
 *
 * It is a SAFETY NET, not the primary detector: the primary fix is picking the
 * right active question. But defense-in-depth here means that even if detection
 * hands us a stale/duplicate question on the auto path, we do not burn a credit
 * re-answering it — the caller returns the existing 409 "duplicate" contract,
 * which the client silently drops.
 */

// Conversational lead-ins that carry no question identity. Stripped before
// hashing so "So, can you introduce yourself?" and "Okay can you introduce
// yourself" collapse to the same key.
const LEADING_FILLER_RE =
  /^(?:and|or|then|also|but|so|now|plus|because|okay|ok|alright|great|right|perfect|well|yeah|yes|no|um|uh|hmm|hey|hi|hello|sure|cool|nice|good)\b[\s,]*/i;

// Low-signal tokens excluded from the similarity token set. Kept small on
// purpose — over-stemming makes distinct questions look identical.
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "was", "were", "be", "been", "do", "does", "did", "you", "your", "yours",
  "me", "my", "we", "our", "us", "it", "its", "this", "that", "these", "those",
  "can", "could", "would", "should", "will", "please", "tell", "about", "with",
  "how", "what", "why", "when", "where", "which", "who", "explain", "describe",
]);

export interface AnsweredMatch {
  answered: boolean;
  matchedQuestion?: string;
  similarity: number;
  reason:
    | "exact_normalized_match"
    | "high_similarity"
    | "follow_up_exempt"
    | "empty_question"
    | "no_prior_questions"
    | "below_threshold";
}

/**
 * Deterministic normalized identity for a question. Same question phrased with
 * different filler / casing / punctuation → same key.
 */
export function normalizeQuestionKey(question: string): string {
  let text = String(question ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  // Strip stacked leading fillers ("so, okay, and can you...").
  let prev: string;
  do {
    prev = text;
    text = text.replace(LEADING_FILLER_RE, "");
  } while (text !== prev);
  return text
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant-token set used for fuzzy similarity (order-independent). */
export function significantTokens(question: string): Set<string> {
  const key = normalizeQuestionKey(question);
  const tokens = key.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard similarity of two questions' significant-token sets (0..1). */
export function questionSimilarity(a: string, b: string): number {
  const sa = significantTokens(a);
  const sb = significantTokens(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Has an equivalent of `question` already been answered?
 *
 * @param question         the question we're about to answer
 * @param priorQuestions   questions from previously generated answers (this session)
 * @param opts.isFollowUp  follow-ups legitimately re-reference the prior thread,
 *                         so they are never treated as duplicate re-answers
 * @param opts.threshold   Jaccard similarity above which two questions are "the
 *                         same" (default 0.82 — high enough to avoid false
 *                         positives on distinct questions that share topic words)
 */
export function isAlreadyAnswered(
  question: string,
  priorQuestions: readonly (string | undefined | null)[],
  opts: { isFollowUp?: boolean; threshold?: number } = {},
): AnsweredMatch {
  const threshold = opts.threshold ?? 0.82;
  const key = normalizeQuestionKey(question);
  if (!key) return { answered: false, similarity: 0, reason: "empty_question" };
  if (opts.isFollowUp) {
    return { answered: false, similarity: 0, reason: "follow_up_exempt" };
  }

  const priors = priorQuestions
    .map((q) => (q ?? "").trim())
    .filter((q) => q.length > 0);
  if (priors.length === 0) {
    return { answered: false, similarity: 0, reason: "no_prior_questions" };
  }

  let best = 0;
  let bestQuestion: string | undefined;
  for (const prior of priors) {
    if (normalizeQuestionKey(prior) === key) {
      return {
        answered: true,
        matchedQuestion: prior,
        similarity: 1,
        reason: "exact_normalized_match",
      };
    }
    const sim = questionSimilarity(question, prior);
    if (sim > best) {
      best = sim;
      bestQuestion = prior;
    }
  }

  // Very short questions (1-2 significant tokens, e.g. "why?", "the code")
  // are almost always follow-ups and must not be blocked by fuzzy matching —
  // let the caller's follow-up handling own them.
  if (significantTokens(question).size < 3) {
    return { answered: false, similarity: best, reason: "below_threshold" };
  }

  if (best >= threshold) {
    return {
      answered: true,
      matchedQuestion: bestQuestion,
      similarity: best,
      reason: "high_similarity",
    };
  }
  return { answered: false, similarity: best, reason: "below_threshold" };
}
