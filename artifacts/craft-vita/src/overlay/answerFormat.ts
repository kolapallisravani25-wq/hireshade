/**
 * Speakable answer formatter (O1 / EXT G-044).
 *
 * Turns a full LLM answer into a glanceable, speakable card:
 *   line 1  - hook, <= 12 words
 *   then    - 2-4 short bullets, one idea each, first person
 *   optional- one-line pushback follow-up question
 *   first screenful <= 40 words
 *   literal markdown symbols stripped; bullets rendered as real list items;
 *   no emoji is ever added (deliberate source emoji are preserved).
 *
 * Pure and deterministic: unit-tested on 20 generated answers.
 */

export const HOOK_MAX_WORDS = 12;
export const BULLET_MIN = 2;
export const BULLET_MAX = 4;
export const BULLET_MAX_WORDS = 14;
export const SCREENFUL_MAX_WORDS = 40;

export interface SpeakableAnswer {
  readonly hook: string;
  readonly bullets: readonly string[];
  readonly pushback: string | null;
  readonly plainText: string;
  readonly wordCount: number;
  readonly screenfulWords: number;
  readonly hadMarkdown: boolean;
  readonly keptEmoji: boolean;
}

const PUSHBACK_TEMPLATES = [
  'Would you like me to walk through the trade-offs?',
  'Should I go deeper on the implementation?',
  'Do you want the edge cases next?',
] as const;

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const TRAILING_STOPWORDS = new Set([
  'and', 'but', 'or', 'so', 'because', 'with', 'to', 'the', 'a', 'an', 'of',
  'in', 'on', 'for', 'that', 'which', 'who', 'as', 'at', 'by', 'from', 'is',
  'was', 'were', 'it', 'this', 'these', 'those', 'kept', 'using',
]);

function trimTrailingStopwords(words: string[]): string[] {
  const out = [...words];
  while (out.length > 3) {
    const last = out[out.length - 1]!.replace(/[.,;:!?]+$/, '').toLowerCase();
    if (!TRAILING_STOPWORDS.has(last)) break;
    out.pop();
  }
  return out;
}

/**
 * Clamps an idea to a word budget without cutting mid-clause: when a sentence
 * has to be shortened, prefer the last comma/conjunction inside the budget and
 * drop dangling stopwords ("...per key and kept" -> "...per key").
 */
function clampIdea(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ').replace(/[\s,;:]+$/, '');
  const budget = words.slice(0, maxWords);
  for (let index = budget.length - 1; index >= 3; index -= 1) {
    const raw = budget[index]!;
    if (/,;:$/.test(raw)) {
      return budget.slice(0, index + 1).join(' ').replace(/[\s,;:]+$/, '');
    }
    if (/^(and|but|so|because|which|that)$/i.test(raw)) {
      return budget.slice(0, index).join(' ').replace(/[\s,;:]+$/, '');
    }
  }
  return trimTrailingStopwords(budget).join(' ').replace(/[\s,;:]+$/, '');
}

function clampWords(text: string, maxWords: number): string {
  return clampIdea(text, maxWords);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Removes literal markdown syntax, keeping the words (and deliberate emoji). */
export function stripMarkdown(input: string): { text: string; hadMarkdown: boolean } {
  const raw = input ?? '';
  const hadMarkdown =
    /```|`|\*\*|__|~~|^#{1,6}\s|^>\s|^\s*[-+*]\s|\[[^\]]*\]\([^)]*\)/m.test(raw);
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-+*]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/\*\*|__|~~/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text, hadMarkdown };
}

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((sentence) => collapse(sentence))
    .filter((sentence) => sentence.length > 0);
}

function looksLikeQuestion(text: string): boolean {
  return /\?$/.test(text.trim());
}

/**
 * Formats a raw answer into the speakable shape. Deterministic, no LLM call.
 */
export function formatSpeakableAnswer(raw: string): SpeakableAnswer {
  const source = raw ?? '';
  const { text, hadMarkdown } = stripMarkdown(source);
  const keptEmoji = EMOJI_RE.test(text);
  const sentences = splitIntoSentences(text);

  if (sentences.length === 0) {
    return {
      hook: '',
      bullets: [],
      pushback: null,
      plainText: '',
      wordCount: 0,
      screenfulWords: 0,
      hadMarkdown,
      keptEmoji,
    };
  }

  const hook = clampWords(sentences[0]!, HOOK_MAX_WORDS);
  const seen = new Set<string>([hook.toLowerCase()]);
  const candidates: string[] = [];
  for (const sentence of sentences.slice(1)) {
    if (looksLikeQuestion(sentence)) continue;
    const bullet = clampWords(sentence, BULLET_MAX_WORDS);
    if (countWords(bullet) < 2) continue;
    const key = bullet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(bullet);
  }

  // If the source is one long sentence, split its clauses into ideas.
  if (candidates.length < BULLET_MIN && sentences.length === 1) {
    for (const clause of sentences[0]!.split(/\s+(?:and|but|because|so)\s+/i).slice(1)) {
      const bullet = clampWords(clause, BULLET_MAX_WORDS);
      if (countWords(bullet) >= 2) candidates.push(bullet);
    }
  }

  const bullets = candidates.slice(0, BULLET_MAX);

  // Enforce the 40-word first screenful. When there is enough material for the
  // optional pushback line, reserve its words first so the line can actually
  // appear, then trim/shorten the bullets to the remaining budget.
  const wordsOf = (value: string) => countWords(value);
  const template = PUSHBACK_TEMPLATES[Math.abs(source.length) % PUSHBACK_TEMPLATES.length]!;
  const wantsPushback = candidates.length >= BULLET_MIN + 1;
  const reserved = wantsPushback ? wordsOf(template) : 0;
  const screenfulBudget = SCREENFUL_MAX_WORDS - reserved;
  let total = wordsOf(hook) + bullets.reduce((sum, bullet) => sum + wordsOf(bullet), 0);
  while (total > screenfulBudget && bullets.length > BULLET_MIN) {
    const removed = bullets.pop()!;
    total -= wordsOf(removed);
  }
  if (total > screenfulBudget && bullets.length > 0) {
    const budget = Math.max(0, screenfulBudget - wordsOf(hook));
    const per = Math.floor(budget / bullets.length);
    for (let index = 0; index < bullets.length; index += 1) {
      bullets[index] = clampWords(bullets[index]!, Math.max(2, per));
    }
    total = wordsOf(hook) + bullets.reduce((sum, bullet) => sum + wordsOf(bullet), 0);
  }

  // Optional pushback: only when it keeps the first screenful within budget.
  let pushback: string | null = null;
  if (wantsPushback && total + wordsOf(template) <= SCREENFUL_MAX_WORDS) {
    pushback = template;
  }

  const plainText = [hook, ...bullets.map((bullet) => '- ' + bullet), ...(pushback ? [pushback] : [])]
    .filter(Boolean)
    .join('\n');
  const screenfulWords =
    wordsOf(hook) +
    bullets.reduce((sum, bullet) => sum + wordsOf(bullet), 0) +
    (pushback ? wordsOf(pushback) : 0);

  return {
    hook,
    bullets,
    pushback,
    plainText,
    wordCount: countWords(text),
    screenfulWords,
    hadMarkdown,
    keptEmoji,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renders the speakable answer with real bullet list items (no literal '- '). */
export function renderSpeakableHtml(answer: SpeakableAnswer): string {
  if (!answer.hook && answer.bullets.length === 0) return '';
  const parts: string[] = [];
  if (answer.hook) {
    parts.push('<p class="speakable-hook">' + escapeHtml(answer.hook) + '</p>');
  }
  if (answer.bullets.length > 0) {
    parts.push(
      '<ul class="speakable-bullets">' +
        answer.bullets
          .map((bullet) => '<li>' + escapeHtml(bullet) + '</li>')
          .join('') +
        '</ul>',
    );
  }
  if (answer.pushback) {
    parts.push('<p class="speakable-pushback">' + escapeHtml(answer.pushback) + '</p>');
  }
  return parts.join('');
}

/** Alias used by consumers that just want the formatted string. */
export function formatAnswerForOverlay(raw: string): SpeakableAnswer {
  return formatSpeakableAnswer(raw);
}
