/**
 * Deepgram AsrProvider adapter (G-015 seam, G-017 symmetry).
 *
 * The repo's only Deepgram code lived inside a React hook, so the provider
 * interface had no real backend counterpart. This adapter keeps the exact
 * production transport (WebSocket listen endpoint, interim_results,
 * endpointing) behind the same AsrProvider contract the mock implements.
 *
 * The URL builder and message mapper are pure and unit-tested offline; the
 * socket path is only used when DEEPGRAM_API_KEY is set.
 */
import type {
  AsrEvent,
  AsrKeywordBoost,
  AsrNBestAlternative,
  AsrProvider,
  AsrStream,
  AsrStreamOptions,
  AsrWord,
} from "./types.js";

export interface DeepgramListenOptions {
  model?: string;
  language?: string;
  sampleRate?: number;
  channels?: number;
  /** Silence (ms) after speech before Deepgram finalises an utterance. */
  endpointingMs?: number;
  utteranceEndMs?: number;
  interimResults?: boolean;
  smartFormat?: boolean;
  /**
   * Domain vocabulary passed as Deepgram `keywords=term:boost` (G-039).
   * Optional: when omitted the listen URL is byte-identical to the pre-G-039
   * adapter, which keeps the change backward compatible.
   */
  keywords?: (string | AsrKeywordBoost)[];
  /** Ask Deepgram for up to N alternatives (nova supports 2-10). */
  nBestAlternatives?: number;
}

export const DEFAULT_DEEPGRAM_MODEL = "nova-3";
export const DEFAULT_ENDPOINTING_MS = 700;

/** Normalises string/object boost terms into `{term, boost}` pairs. */
export function normalizeDeepgramKeywords(
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

/** Builds the listen URL used by both the browser hook and the server adapter. */
export function buildDeepgramListenUrl(
  opts: DeepgramListenOptions = {},
  base = "wss://api.deepgram.com/v1/listen",
): string {
  const params = new URLSearchParams({
    model: opts.model ?? DEFAULT_DEEPGRAM_MODEL,
    language: opts.language ?? "en-US",
    encoding: "linear16",
    sample_rate: String(opts.sampleRate ?? 16000),
    channels: String(opts.channels ?? 1),
    interim_results: String(opts.interimResults ?? true),
    smart_format: String(opts.smartFormat ?? true),
    endpointing: String(opts.endpointingMs ?? DEFAULT_ENDPOINTING_MS),
    utterance_end_ms: String(opts.utteranceEndMs ?? 1000),
  });
  // G-039: optional decoder boosting. Deepgram expects repeated
  // `keywords=term:boost` params, so append (not set).
  for (const keyword of normalizeDeepgramKeywords(opts.keywords)) {
    params.append("keywords", `${keyword.term}:${keyword.boost ?? 2}`);
  }
  if (opts.nBestAlternatives && opts.nBestAlternatives > 1) {
    params.set("alternatives", String(Math.min(10, Math.floor(opts.nBestAlternatives))));
  }
  return `${base}?${params.toString()}`;
}

export interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface DeepgramChannelAlternative {
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
}

export interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: DeepgramChannelAlternative[] };
}

function mapDeepgramWords(words: DeepgramWord[] | undefined): AsrWord[] | undefined {
  if (!words?.length) return undefined;
  const mapped: AsrWord[] = [];
  for (const word of words) {
    const text = (word.punctuated_word ?? word.word ?? "").trim();
    if (!text) continue;
    mapped.push({
      word: text,
      confidence: Math.max(0, Math.min(1, word.confidence ?? 0.9)),
      ...(typeof word.start === "number" ? { startMs: Math.round(word.start * 1000) } : {}),
      ...(typeof word.end === "number" ? { endMs: Math.round(word.end * 1000) } : {}),
    });
  }
  return mapped.length ? mapped : undefined;
}

function mapDeepgramAlternatives(
  alternatives: DeepgramChannelAlternative[] | undefined,
): AsrNBestAlternative[] | undefined {
  if (!alternatives || alternatives.length <= 1) return undefined;
  const mapped: AsrNBestAlternative[] = [];
  for (const alternative of alternatives) {
    const text = alternative.transcript?.trim() ?? "";
    if (!text) continue;
    const words = mapDeepgramWords(alternative.words);
    mapped.push({
      text,
      confidence: Math.max(0, Math.min(1, alternative.confidence ?? 0.9)),
      ...(words ? { words } : {}),
    });
  }
  return mapped.length > 1 ? mapped : undefined;
}

/**
 * Maps a Deepgram Results message to an AsrEvent (or null when the message is
 * metadata / empty transcript). `segmentId` is the VAD utterance id.
 *
 * G-039: when the Results payload carries word confidences or more than one
 * alternative they are mapped onto the event; otherwise the event shape is
 * exactly the pre-G-039 object (existing consumers are unaffected).
 */
export function mapDeepgramMessage(
  message: DeepgramResultsMessage,
  segmentId: string,
  mediaMs: number,
  atMs: number,
): AsrEvent | null {
  if (message.type !== "Results") return null;
  const alternatives = message.channel?.alternatives;
  const text = alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) return null;
  const isFinal = Boolean(message.is_final || message.speech_final);
  const words = mapDeepgramWords(alternatives?.[0]?.words);
  const nBest = mapDeepgramAlternatives(alternatives);
  return {
    type: isFinal ? "final" : "partial",
    segmentId,
    text,
    mediaMs,
    atMs,
    isFinal,
    ...(words ? { words } : {}),
    ...(nBest ? { alternatives: nBest } : {}),
  };
}

export interface DeepgramAsrProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** Default boosting vocabulary for every stream opened by this provider. */
  keywords?: (string | AsrKeywordBoost)[];
  /** Default number of hypotheses to request (>=2 enables n-best). */
  nBestAlternatives?: number;
}

export function createDeepgramAsrProvider(
  opts: DeepgramAsrProviderOptions = {},
): AsrProvider {
  const isConfigured = () =>
    Boolean((opts.apiKey ?? process.env["DEEPGRAM_API_KEY"] ?? "").trim());

  return {
    id: "deepgram",
    kind: "deepgram",
    capabilities: { nBest: true, wordConfidence: true, keywordBoosting: true },
    isConfigured,
    openStream(options: AsrStreamOptions): AsrStream {
      const key = (opts.apiKey ?? process.env["DEEPGRAM_API_KEY"] ?? "").trim();
      if (!key) {
        throw new Error(
          "DEEPGRAM_API_KEY not set. Streaming ASR is unavailable (enable DEMO_MODE=1 for the keyless demo).",
        );
      }
      const url = buildDeepgramListenUrl(
        {
          model: opts.model ?? DEFAULT_DEEPGRAM_MODEL,
          language: options.language,
          sampleRate: options.sampleRate,
          endpointingMs: options.endpointSilenceMs ?? DEFAULT_ENDPOINTING_MS,
          keywords: options.keywords ?? opts.keywords,
          nBestAlternatives: options.nBestAlternatives ?? opts.nBestAlternatives,
        },
        opts.baseUrl,
      );
      const socket = new WebSocket(url, ["token", key]);
      const startedAt = Date.now();
      socket.addEventListener("message", (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(typeof event.data === "string" ? event.data : "") as DeepgramResultsMessage;
          const asrEvent = mapDeepgramMessage(
            parsed,
            "deepgram-stream",
            Date.now() - startedAt,
            Date.now(),
          );
          if (asrEvent) options.onEvent?.(asrEvent);
        } catch {
          // Ignore malformed frames; Deepgram occasionally sends keepalives.
        }
      });
      return {
        pushAudio(pcm: Int16Array | Float32Array): AsrEvent[] {
          if (socket.readyState === WebSocket.OPEN) {
            // Deepgram listen expects linear16; convert f32 input if supplied.
            let payload: ArrayBuffer;
            if (pcm instanceof Float32Array) {
              const pcm16 = new Int16Array(pcm.length);
              for (let i = 0; i < pcm.length; i++) {
                const v = Math.max(-1, Math.min(1, pcm[i]!));
                pcm16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
              }
              payload = pcm16.buffer;
            } else {
              payload = pcm.buffer.slice(
                pcm.byteOffset,
                pcm.byteOffset + pcm.byteLength,
              ) as ArrayBuffer;
            }
            socket.send(payload);
          }
          return [];
        },
        endAudio(): AsrEvent[] {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "CloseStream" }));
          }
          return [];
        },
        close(): void {
          try {
            socket.close();
          } catch {
            // Already closed.
          }
        },
      };
    },
  };
}
