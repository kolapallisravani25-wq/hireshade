/**
 * O3 — speakability fixtures + fallback answer formatter (G-045).
 *
 * 20 deterministic answers exercise: hook <= 12 words, first screenful <= 40
 * words, no literal markdown tokens in rendered text, bullets rendered as list
 * items. The formatter is only a fallback for when O1's answerFormat module is
 * absent; it is labelled as such in the evidence JSON.
 */

export const SPEAKABILITY_THRESHOLDS = {
  hookMaxWords: 12,
  firstScreenfulMaxWords: 40,
  bulletsMin: 2,
  bulletsMax: 4,
};

const HOOKS = [
  "I built a Redis rate limiter for a high-traffic API.",
  "Short answer: I would use a sliding window counter.",
  "In my last role I owned the payments retry pipeline.",
  "The trade-off is simplicity versus burst tolerance.",
  "I would start with requirements, then choose the design.",
  "My approach is measure first, then optimize the bottleneck.",
  "We handled this with an idempotency key and a queue.",
  "I would isolate the hot path behind a cache.",
  "The failure mode matters more than the happy path.",
  "I shipped this by rolling out behind a feature flag.",
  "Honestly, I would test the constraint before designing.",
  "We reduced p99 latency by batching the writes.",
  "My rule is keep the state machine explicit and small.",
  "I would make the fallback degrade, never fail open.",
  "Start with a bounded queue and backpressure signals.",
  "I have debugged this exact incident on call before.",
  "The key detail is idempotency across retries.",
  "I would model the data before touching the API.",
  "We split reads and writes to scale independently.",
  "My answer is concrete: measure, isolate, then cache.",
];

const BULLET_SETS = [
  [
    "**Trade-off:** fixed windows allow bursts at the boundary, so I use a sliding counter.",
    "**Failure mode:** an in-process token bucket keeps the API serving if Redis drops.",
  ],
  [
    "**Design:** one key per user and route, with an atomic increment and short TTL.",
    "**Observability:** emit throttling counters and p99 latency on every decision.",
    "**Rollout:** enable it per route behind a flag and watch the error budget.",
  ],
  [
    "**First step:** reproduce the bottleneck with a load test and a profile.",
    "**Second step:** batch writes and move the hot read path behind a cache.",
    "**Guardrail:** alert on queue depth before users see timeouts.",
  ],
  [
    "**Data model:** append-only ledger with a unique idempotency key.",
    "**Recovery:** replay the queue with exponential backoff and a dead-letter topic.",
  ],
];

/** Strips markdown syntax to plain speakable text. */
export function stripMarkdown(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text) {
  const trimmed = String(text).trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

/** Detects literal markdown tokens that must never reach rendered text. */
export function findMarkdownTokens(text) {
  const source = String(text);
  const tokens = [];
  if (/\*\*[^*]+\*\*/.test(source)) tokens.push("**bold**");
  if (/^#{1,6}\s/m.test(source)) tokens.push("# heading");
  if (/`[^`]+`/.test(source)) tokens.push("\`code\`");
  if (/^\s*[-*+]\s/m.test(source)) tokens.push("- bullet marker");
  if (/\[[^\]]*\]\([^)]*\)/.test(source)) tokens.push("[link](url)");
  if (/__[^_]+__/.test(source)) tokens.push("__bold__");
  return tokens;
}

/**
 * Fallback formatter: markdown -> { hook, bullets, plainText }.
 * Deliberately simple; only used when O1's module is absent.
 */
export function fallbackFormatAnswer(markdown) {
  const source = String(markdown);
  const lines = source.split("\n");
  const paragraphs = [];
  const bullets = [];
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      bullets.push(stripMarkdown(bulletMatch[1]));
    } else {
      const cleaned = stripMarkdown(line);
      if (cleaned) paragraphs.push(cleaned);
    }
  }
  const hook = paragraphs[0] ?? "";
  const plainText = stripMarkdown(source);
  return {
    hook,
    hookWords: countWords(hook),
    bullets,
    plainText,
    firstScreenfulWords: countWords(paragraphs[0] ?? ""),
  };
}

/** 20 deterministic speakability fixtures (hook + 2-4 markdown bullets). */
export function generateAnswers(count = 20) {
  const answers = [];
  for (let index = 0; index < count; index++) {
    const hook = HOOKS[index % HOOKS.length];
    const bulletSet = BULLET_SETS[index % BULLET_SETS.length];
    const markdown = ["## Answer " + (index + 1), hook, "", ...bulletSet.map((bullet) => "- " + bullet)].join("\n");
    const formatted = fallbackFormatAnswer(markdown);
    answers.push({ id: "speak-" + String(index + 1).padStart(2, "0"), markdown, formatted });
  }
  return answers;
}
