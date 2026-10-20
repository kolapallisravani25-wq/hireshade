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
  AsrProvider,
  AsrStream,
  AsrStreamOptions,
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
}

export const DEFAULT_DEEPGRAM_MODEL = "nova-3";
export const DEFAULT_ENDPOINTING_MS = 700;

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
  return `${base}?${params.toString()}`;
}

export interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
}

/**
 * Maps a Deepgram Results message to an AsrEvent (or null when the message is
 * metadata / empty transcript). `segmentId` is the VAD utterance id.
 */
export function mapDeepgramMessage(
  message: DeepgramResultsMessage,
  segmentId: string,
  mediaMs: number,
  atMs: number,
): AsrEvent | null {
  if (message.type !== "Results") return null;
  const text = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!text) return null;
  const isFinal = Boolean(message.is_final || message.speech_final);
  return {
    type: isFinal ? "final" : "partial",
    segmentId,
    text,
    mediaMs,
    atMs,
    isFinal,
  };
}

export interface DeepgramAsrProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function createDeepgramAsrProvider(
  opts: DeepgramAsrProviderOptions = {},
): AsrProvider {
  const isConfigured = () =>
    Boolean((opts.apiKey ?? process.env["DEEPGRAM_API_KEY"] ?? "").trim());

  return {
    id: "deepgram",
    kind: "deepgram",
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
