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
  AsrProvider,
  AsrStream,
  AsrStreamOptions,
  TranscriptUtterance,
} from "./types.js";

export interface MockAsrProviderOptions {
  id?: string;
  /** Default delay of the first partial after speech starts (250 ms). */
  firstPartialDelayMs?: number;
  /** Extra silence after speech before the final is emitted (700 ms). */
  endpointSilenceMs?: number;
  /** Wall clock (ms); injectable for deterministic tests. */
  clock?: () => number;
}

interface ScheduledEvent {
  key: string;
  type: "partial" | "final";
  segmentId: string;
  text: string;
  mediaMs: number;
}

function defaultPartials(utterance: TranscriptUtterance, delayMs: number): { atMs: number; text: string }[] {
  const words = utterance.text.trim().split(/\s+/);
  const half = Math.max(1, Math.ceil(words.length / 2));
  return [{ atMs: delayMs, text: words.slice(0, half).join(" ") }];
}

function buildSchedule(
  script: TranscriptUtterance[],
  firstPartialDelayMs: number,
  endpointSilenceMs: number,
): ScheduledEvent[] {
  const scheduled: ScheduledEvent[] = [];
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
      });
    });
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

export interface MockAsrProvider extends AsrProvider {
  readonly lastStream: { sampleRate: number; scriptLength: number } | null;
}

export function createMockAsrProvider(opts: MockAsrProviderOptions = {}): MockAsrProvider {
  const firstPartialDelayMs = opts.firstPartialDelayMs ?? 250;
  const defaultEndpointSilenceMs = opts.endpointSilenceMs ?? 700;
  const clock = opts.clock ?? (() => performance.now());
  let lastStream: { sampleRate: number; scriptLength: number } | null = null;

  return {
    id: opts.id ?? "mock-asr",
    kind: "mock",
    isConfigured: () => true,
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
      lastStream = { sampleRate, scriptLength: script.length };
      const endpointSilenceMs = options.endpointSilenceMs ?? defaultEndpointSilenceMs;
      const schedule = buildSchedule(script, firstPartialDelayMs, endpointSilenceMs);
      let samplesSeen = 0;
      let cursor = 0;
      const emitted: AsrEvent[] = [];

      const takeUntil = (mediaMs: number): AsrEvent[] => {
        const out: AsrEvent[] = [];
        while (cursor < schedule.length && schedule[cursor]!.mediaMs <= mediaMs) {
          const item = schedule[cursor]!;
          cursor += 1;
          const event: AsrEvent = {
            type: item.type,
            segmentId: item.segmentId,
            text: item.text,
            mediaMs: item.mediaMs,
            atMs: now(),
            isFinal: item.type === "final",
          };
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
            const event: AsrEvent = {
              type: item.type,
              segmentId: item.segmentId,
              text: item.text,
              mediaMs: item.mediaMs,
              atMs: now(),
              isFinal: item.type === "final",
            };
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
