/**
 * Mock ASR adapter (G-001).
 *
 * Replays a timed transcript as partial + final events. It is genuinely
 * audio-driven: the caller pushes 16-bit mono PCM, and events fire when the
 * media position crosses their scheduled time. That lets the demo pipeline
 * exercise real endpointing (final lands one silence window after speech ends)
 * instead of jumping straight to the final string.
 */
import type {
  AsrEvent,
  AsrKeywordBoost,
  AsrNBestAlternative,
  AsrProvider,
  AsrStream,
  AsrStreamOptions,
  AsrWord,
  TranscriptPartial,
  TranscriptUtterance,
} from "./types.js";
import {
  degradeTranscript,
  type DegradedTranscript,
} from "../pronunciation/degradation.js";
import type { AccentProfileId } from "../pronunciation/accentProfiles.js";

/**
 * Pronunciation-degradation option for the mock ASR (G-039).
 *
 * When enabled, every final is replaced by a deterministic degraded transcript
 * produced for the given accent profile: realistic word confidences, garbled
 * domain terms and an n-best list. Default off, so existing demo behaviour and
 * tests are unchanged.
 */
export interface MockAsrPronunciationOptions {
  profile: AccentProfileId;
  /** Probability a known domain term is garbled (default 0.72). */
  garbleChance?: number;
  /** Include n-best hypotheses (default true). */
  includeAlternatives?: boolean;
  /** Extra seed material appended to the transcript/profile seed. */
  seed?: string | number;
}

export interface MockAsrProviderOptions {
  id?: string;
  /** Default delay of the first partial after speech starts (250 ms). */
  firstPartialDelayMs?: number;
  /** Extra silence after speech before the final is emitted (700 ms). */
  endpointSilenceMs?: number;
  /** Wall clock (ms); injectable for deterministic tests. */
  clock?: () => number;
  /** Emit realistic low-confidence/garbled finals from the corpus (G-039). */
  pronunciation?: MockAsrPronunciationOptions;
}

interface ScheduledEvent {
  key: string;
  type: "partial" | "final";
  segmentId: string;
  text: string;
  mediaMs: number;
  words?: AsrWord[];
  alternatives?: AsrNBestAlternative[];
}

function defaultPartials(utterance: TranscriptUtterance, delayMs: number): TranscriptPartial[] {
  const words = utterance.text.trim().split(/\s+/);
  const half = Math.max(1, Math.ceil(words.length / 2));
  return [{ atMs: delayMs, text: words.slice(0, half).join(" ") }];
}

function normalizeKeywordBoosts(
  keywords: (string | AsrKeywordBoost)[] | undefined,
): AsrKeywordBoost[] {
  if (!keywords?.length) return [];
  const out: AsrKeywordBoost[] = [];
  for (const item of keywords) {
    if (typeof item === "string") {
      const term = item.trim();
      if (term) out.push({ term, boost: 2 });
    } else if (item?.term?.trim()) {
      out.push({ term: item.term.trim(), boost: item.boost ?? 2 });
    }
  }
  return out;
}

/**
 * Applies keyword boosting the way a decoder would: recognised words whose
 * canonical form is boosted get a small confidence increase (capped below the
 * high band so the pronunciation layer still has work to do). Returns a new
 * event payload; the base transcript is unchanged.
 */
function applyMockKeywordBoost(
  degraded: DegradedTranscript,
  keywords: AsrKeywordBoost[],
): { text: string; words: AsrWord[]; alternatives: AsrNBestAlternative[] } {
  if (!keywords.length) {
    return { text: degraded.text, words: degraded.words, alternatives: degraded.alternatives };
  }
  const boostByTerm = new Map(
    keywords.map((keyword) => [keyword.term.toLowerCase(), keyword.boost ?? 2]),
  );
  let boosted = 0;
  const words = degraded.words.map((word) => {
    const core = word.word.toLowerCase().replace(/[^a-z0-9]/g, "");
    let extra = 0;
    for (const [term, boost] of boostByTerm) {
      const normalized = term.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalized && core.includes(normalized)) extra = Math.max(extra, 0.04 * boost);
    }
    if (!extra) return word;
    boosted += 1;
    return { ...word, confidence: Math.min(0.79, Math.round((word.confidence + extra) * 100) / 100) };
  });
  return {
    text: words.map((word) => word.word).join(" "),
    words,
    alternatives: degraded.alternatives,
  };
}

function buildSchedule(
  script: TranscriptUtterance[],
  firstPartialDelayMs: number,
  endpointSilenceMs: number,
  pronunciation: MockAsrPronunciationOptions | undefined,
  keywords: (string | AsrKeywordBoost)[] | undefined,
): ScheduledEvent[] {
  const scheduled: ScheduledEvent[] = [];
  const boosts = normalizeKeywordBoosts(keywords);
  for (const utterance of script) {
    const partials = utterance.partials?.length
      ? utterance.partials
      : defaultPartials(utterance, firstPartialDelayMs);
    partials.forEach((partial, i) => {
      scheduled.push({
        key: `${utterance.id}:p${i}`,
        type: "partial",
        segmentId: utterance.id,
        text: partial.text,
        mediaMs: utterance.startMs + partial.atMs,
        ...(partial.words ? { words: partial.words } : {}),
        ...(partial.alternatives ? { alternatives: partial.alternatives } : {}),
      });
    });

    if (utterance.words) {
      scheduled.push({
        key: `${utterance.id}:final`,
        type: "final",
        segmentId: utterance.id,
        text: utterance.text,
        mediaMs: utterance.endMs + endpointSilenceMs,
        words: utterance.words,
        ...(utterance.alternatives ? { alternatives: utterance.alternatives } : {}),
      });
      continue;
    }

    if (pronunciation) {
      const degraded = degradeTranscript(utterance.text, pronunciation.profile, {
        seed: pronunciation.seed ?? utterance.id,
        garbleChance: pronunciation.garbleChance,
        includeAlternatives: pronunciation.includeAlternatives,
      });
      const boosted = applyMockKeywordBoost(degraded, boosts);
      scheduled.push({
        key: `${utterance.id}:final`,
        type: "final",
        segmentId: utterance.id,
        text: boosted.text,
        mediaMs: utterance.endMs + endpointSilenceMs,
        words: boosted.words,
        alternatives: boosted.alternatives,
      });
      continue;
    }

    scheduled.push({
      key: `${utterance.id}:final`,
      type: "final",
      segmentId: utterance.id,
      text: utterance.text,
      mediaMs: utterance.endMs + endpointSilenceMs,
    });
  }
  return scheduled.sort((a, b) => a.mediaMs - b.mediaMs);
}

export interface MockAsrLastStream {
  sampleRate: number;
  scriptLength: number;
  /** Number of keyword-boost terms supplied to openStream (G-039). */
  keywordCount: number;
  /** Active pronunciation profile, or null when degradation is off. */
  pronunciationProfile: AccentProfileId | null;
}

export interface MockAsrProvider extends AsrProvider {
  readonly lastStream: MockAsrLastStream | null;
}

export function createMockAsrProvider(opts: MockAsrProviderOptions = {}): MockAsrProvider {
  const firstPartialDelayMs = opts.firstPartialDelayMs ?? 250;
  const defaultEndpointSilenceMs = opts.endpointSilenceMs ?? 700;
  const clock = opts.clock ?? (() => performance.now());
  const pronunciation = opts.pronunciation;
  let lastStream: MockAsrLastStream | null = null;

  return {
    id: opts.id ?? "mock-asr",
    kind: "mock",
    isConfigured: () => true,
    capabilities: { nBest: true, wordConfidence: true, keywordBoosting: true },
    get lastStream() {
      return lastStream;
    },
    openStream(options: AsrStreamOptions): AsrStream {
      const now = options.now ?? clock;
      const sampleRate = options.sampleRate;
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error(`mock-asr: invalid sampleRate ${String(sampleRate)}`);
      }
      const script = options.script ?? [];
      lastStream = {
        sampleRate,
        scriptLength: script.length,
        keywordCount: normalizeKeywordBoosts(options.keywords).length,
        pronunciationProfile: pronunciation?.profile ?? null,
      };
      const endpointSilenceMs = options.endpointSilenceMs ?? defaultEndpointSilenceMs;
      const schedule = buildSchedule(
        script,
        firstPartialDelayMs,
        endpointSilenceMs,
        pronunciation,
        options.keywords,
      );
      let samplesSeen = 0;
      let cursor = 0;
      const emitted: AsrEvent[] = [];

      const toEvent = (item: ScheduledEvent): AsrEvent => ({
        type: item.type,
        segmentId: item.segmentId,
        text: item.text,
        mediaMs: item.mediaMs,
        atMs: now(),
        isFinal: item.type === "final",
        ...(item.words ? { words: item.words } : {}),
        ...(item.alternatives ? { alternatives: item.alternatives } : {}),
      });

      const takeUntil = (mediaMs: number): AsrEvent[] => {
        const out: AsrEvent[] = [];
        while (cursor < schedule.length && schedule[cursor]!.mediaMs <= mediaMs) {
          const item = schedule[cursor]!;
          cursor += 1;
          const event = toEvent(item);
          emitted.push(event);
          out.push(event);
          options.onEvent?.(event);
        }
        return out;
      };

      return {
        pushAudio(pcm: Int16Array | Float32Array): AsrEvent[] {
          if (!pcm.length) return [];
          // Mono: one array element per sample in either encoding.
          samplesSeen += pcm.length;
          const mediaMs = (samplesSeen / sampleRate) * 1000;
          return takeUntil(mediaMs);
        },
        endAudio(): AsrEvent[] {
          // End of stream: every remaining scheduled event is flushed; finals are
          // emitted at the current wall clock (no more media will arrive).
          const remaining = schedule.slice(cursor);
          cursor = schedule.length;
          const out: AsrEvent[] = [];
          for (const item of remaining) {
            const event = toEvent(item);
            emitted.push(event);
            out.push(event);
            options.onEvent?.(event);
          }
          return out;
        },
        close(): void {
          cursor = schedule.length;
        },
      };
    },
  };
}
