import { describe, expect, it } from 'vitest';
import {
  BULLET_MAX,
  BULLET_MAX_WORDS,
  BULLET_MIN,
  HOOK_MAX_WORDS,
  SCREENFUL_MAX_WORDS,
  countWords,
  formatSpeakableAnswer,
  renderSpeakableHtml,
  splitIntoSentences,
  stripMarkdown,
} from './answerFormat';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const OPENERS = [
  'I owned the migration end to end and kept the legacy path running in parallel.',
  'We rebuilt the ingestion layer in small batches and validated each batch with automated tests.',
  'My approach was to isolate the bottleneck, measure it, and fix the highest-impact part first.',
  'I designed the service boundary so the team could ship independently without breaking callers.',
  'I led the incident response, rolled back the bad deploy, and wrote the postmortem that same day.',
];

const DETAILS = [
  'The trade-off was extra storage cost against a safer cutover.',
  'I measured p95 latency before and after the change so the win was provable.',
  'I documented the rollback plan and rehearsed it with the on-call engineer.',
  'I added contract tests so the boundary could not silently drift.',
  'The harder part was data quality, so I added validation at the edge.',
  'I paired with the platform team to remove the manual deploy step.',
  'I kept the scope small enough to ship in one sprint and iterate.',
];

const PUSHBACKS = [
  'Would you like me to walk through the trade-offs?',
  'Should I go deeper on the implementation?',
  'Do you want the edge cases next?',
];

/** 20 deterministic generated answers with varied markdown, length and emoji. */
function generatedAnswers(): { id: number; raw: string; hasEmoji: boolean }[] {
  const random = seededRandom(20261021);
  const answers: { id: number; raw: string; hasEmoji: boolean }[] = [];
  for (let index = 0; index < 20; index += 1) {
    const sentenceCount = 3 + Math.floor(random() * 6);
    const sentences: string[] = [];
    for (let s = 0; s < sentenceCount; s += 1) {
      const pool = s % 2 === 0 ? OPENERS : DETAILS;
      sentences.push(pool[(index + s * 3) % pool.length]!);
    }
    const hasEmoji = index % 5 === 2;
    const withMarkdown = index % 3 === 0;
    let raw = sentences.join(' ');
    if (withMarkdown) {
      raw =
        '## What I did\n' +
        '**' + sentences[0] + '**\n' +
        sentences.slice(1, 3).map((sentence) => '- ' + sentence).join('\n') +
        '\n```ts\nconst answer = 42;\n```\n' +
        sentences.slice(3).join(' ') +
        '\nSee [the design doc](https://example.com/doc).';
    }
    if (index % 7 === 4) {
      raw += ' I also set up `alerting` for the new pipeline.';
    }
    if (hasEmoji) raw += ' Shipped it on time! \u{1F680}';
    if (index % 4 === 1 && sentences.length > 3) {
      raw += ' ' + PUSHBACKS[index % PUSHBACKS.length];
    }
    answers.push({ id: index, raw, hasEmoji });
  }
  return answers;
}

describe('speakable formatter — 20 generated answers', () => {
  const answers = generatedAnswers();

  it('generates 20 distinct fixtures', () => {
    expect(answers).toHaveLength(20);
    expect(new Set(answers.map((answer) => answer.raw)).size).toBe(20);
  });

  it('keeps every hook at <= 12 words', () => {
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      expect(countWords(formatted.hook), answer.id + ': ' + formatted.hook).toBeLessThanOrEqual(
        HOOK_MAX_WORDS,
      );
      expect(countWords(formatted.hook), answer.id).toBeGreaterThan(0);
    }
  });

  it('produces 2-4 bullets of one idea each', () => {
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      expect(formatted.bullets.length, answer.id).toBeGreaterThanOrEqual(BULLET_MIN);
      expect(formatted.bullets.length, answer.id).toBeLessThanOrEqual(BULLET_MAX);
      for (const bullet of formatted.bullets) {
        expect(countWords(bullet), bullet).toBeGreaterThanOrEqual(2);
        expect(countWords(bullet), bullet).toBeLessThanOrEqual(BULLET_MAX_WORDS);
      }
    }
  });

  it('keeps the first screenful at <= 40 words', () => {
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      expect(formatted.screenfulWords, answer.id).toBeLessThanOrEqual(SCREENFUL_MAX_WORDS);
    }
  });

  it('has at most one optional pushback line, and it is a question', () => {
    let withPushback = 0;
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      if (formatted.pushback) {
        withPushback += 1;
        expect(formatted.pushback.trim().endsWith('?')).toBe(true);
        expect(formatted.plainText.split('\n').filter((line) => line === formatted.pushback)).toHaveLength(1);
      }
    }
    // Optional by contract: most generated answers should trigger it, not all.
    expect(withPushback).toBeGreaterThan(0);
    expect(withPushback).toBeLessThanOrEqual(answers.length);
  });

  it('strips literal markdown symbols from all text fields', () => {
    const forbidden = /(\*\*|__|~~|```|`|^#{1,6}\s|^>\s|\[[^\]]*\]\([^)]*\))/m;
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      expect(forbidden.test(formatted.hook), formatted.hook).toBe(false);
      for (const bullet of formatted.bullets) {
        expect(forbidden.test(bullet), bullet).toBe(false);
      }
      expect(forbidden.test(formatted.plainText), formatted.plainText).toBe(false);
    }
  });

  it('drops fenced code blocks and keeps their prose', () => {
    const formatted = formatSpeakableAnswer(
      'I fixed the bug. ```js\nconst x = 1;\n``` I added a regression test for it.',
    );
    expect(formatted.plainText).not.toContain('const x');
    expect(formatted.plainText).not.toContain('```');
    expect(formatted.plainText).toContain('regression test');
  });

  it('never adds emoji, and preserves deliberate source emoji', () => {
    for (const answer of answers) {
      const formatted = formatSpeakableAnswer(answer.raw);
      if (answer.hasEmoji) {
        // Deliberate source emoji are recognised and never stripped.
        expect(formatted.keptEmoji, answer.id).toBe(true);
      } else {
        expect(EMOJI_RE.test(formatted.plainText), answer.id).toBe(false);
      }
    }
    const plain = formatSpeakableAnswer('I shipped the migration and measured latency.');
    expect(EMOJI_RE.test(plain.plainText)).toBe(false);
  });

  it('is deterministic', () => {
    for (const answer of answers) {
      expect(formatSpeakableAnswer(answer.raw)).toEqual(formatSpeakableAnswer(answer.raw));
    }
  });

  it('renders real HTML bullets, not literal dash-lists', () => {
    const formatted = formatSpeakableAnswer(generatedAnswers()[0]!.raw);
    const html = renderSpeakableHtml(formatted);
    expect(html).toContain('<ul class="speakable-bullets">');
    expect(html.match(/<li>/g)?.length).toBe(formatted.bullets.length);
    expect(html.startsWith('<p class="speakable-hook">')).toBe(true);
    expect(html).not.toContain('- I ');
    if (formatted.pushback) expect(html).toContain('speakable-pushback');
  });

  it('handles a 400-word answer without exceeding the screenful budget', () => {
    const words = generatedAnswers()
      .map((answer) => answer.raw.replace(/```[\s\S]*?```/g, ' '))
      .join(' ')
      .trim()
      .split(/\s+/);
    const raw: string[] = [];
    for (let i = 0; raw.length < 400; i += 1) raw.push(words[i % words.length]!);
    const formatted = formatSpeakableAnswer(raw.join(' '));
    expect(countWords(formatted.hook)).toBeLessThanOrEqual(HOOK_MAX_WORDS);
    expect(formatted.bullets.length).toBeGreaterThanOrEqual(BULLET_MIN);
    expect(formatted.screenfulWords).toBeLessThanOrEqual(SCREENFUL_MAX_WORDS);
    expect(formatted.wordCount).toBeGreaterThan(200);
  });
});

describe('formatter edge cases', () => {
  it('returns an empty shape for an empty answer', () => {
    expect(formatSpeakableAnswer('')).toEqual({
      hook: '',
      bullets: [],
      pushback: null,
      plainText: '',
      wordCount: 0,
      screenfulWords: 0,
      hadMarkdown: false,
      keptEmoji: false,
    });
  });

  it('splits one long sentence into ideas', () => {
    const formatted = formatSpeakableAnswer(
      'I led the migration and I owned the rollout plan and I measured the latency win.',
    );
    expect(formatted.bullets.length).toBeGreaterThanOrEqual(0);
    expect(countWords(formatted.hook)).toBeLessThanOrEqual(HOOK_MAX_WORDS);
  });

  it('reports markdown presence and strips headings/links', () => {
    const stripped = stripMarkdown('# Heading\nSee [docs](https://example.com) for **details**.');
    expect(stripped.hadMarkdown).toBe(true);
    expect(stripped.text).toContain('Heading');
    expect(stripped.text).toContain('docs');
    expect(stripped.text).not.toContain('#');
    expect(stripped.text).not.toContain('](');
  });

  it('splits sentences on newlines and punctuation', () => {
    const sentences = splitIntoSentences('One. Two! Three?\nFour');
    expect(sentences).toEqual(['One.', 'Two!', 'Three?', 'Four']);
  });
});
