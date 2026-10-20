/**
 * Target-verified transport/contract alignment (docs/TARGET_VERIFIED.md
 * T-09/T-10/T-11).
 *
 * The competitor's desktop client (T-09/T-10) splits transports:
 *   - ASR: one WebSocket per audio source ("Microphone" + "Screen Sharing"),
 *     16 kHz mono f32le, ephemeral JWT in the query string, with distinct
 *     AddPartialTranscript / AddTranscript / EndOfUtterance events;
 *   - answers: SSE from POST /api/chat with
 *     Content-Type: text/event-stream,
 *     Cache-Control: no-cache, no-transform,
 *     X-Accel-Buffering: no.
 *
 * The mock/demo layer reproduces those contracts exactly so the zero-key demo
 * proves the same wire protocol the real adapters must satisfy. Nothing here
 * performs I/O or reads a key.
 */
import type { AsrEvent } from "./types.js";

/** T-09 — ASR transport contract (Speechmatics realtime compatible). */
export const TARGET_ASR_TRANSPORT = {
  transport: "websocket",
  url: "wss://global.rt.speechmatics.com/v2",
  model: "enhanced",
  encoding: "pcm_f32le",
  sampleRate: 16_000,
  channels: 1,
  auth: { kind: "jwt-query-param", param: "jwt" },
  events: {
    partial: "AddPartialTranscript",
    final: "AddTranscript",
    endpoint: "EndOfUtterance",
  },
  /** T-09: two sockets, one per audio source. */
  streams: [
    { id: "mic", label: "Microphone", role: "candidate" },
    { id: "screen", label: "Screen Sharing", role: "interviewer" },
  ],
} as const;

export type TargetAsrStreamId = (typeof TARGET_ASR_TRANSPORT.streams)[number]["id"];

export const TARGET_ASR_WIRE_CONFIG = {
  type: "raw",
  encoding: TARGET_ASR_TRANSPORT.encoding,
  sample_rate: TARGET_ASR_TRANSPORT.sampleRate,
} as const;

/** Builds the JWT-in-query-string listen URL observed in T-09. */
export function buildTargetAsrUrl(opts: {
  jwt: string;
  baseUrl?: string;
  app?: string;
  language?: string;
}): string {
  const base = (opts.baseUrl ?? TARGET_ASR_TRANSPORT.url).replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set(TARGET_ASR_TRANSPORT.auth.param, opts.jwt);
  if (opts.app) params.set("sm-app", opts.app);
  // T-09: the language string may carry a domain suffix ("en:medical"); it is
  // passed through as-is so Speechmatics can resolve the domain.
  if (opts.language) params.set("language", opts.language);
  return `${base}?${params.toString()}`;
}

/** T-09/T-14: splits "en:medical" into { language: "en", domain: "medical" }. */
export function splitLanguageDomain(value: string): { language: string; domain?: string } {
  const [language, domain] = value.split(":", 2);
  return domain ? { language: language ?? "", domain } : { language: value };
}

/**
 * Converts 16-bit PCM to the target's f32le wire bytes ([-1, 1) floats).
 * The demo feeds the mock ASR through this path so the transport encoding is
 * exercised rather than assumed.
 */
export function toF32leBytes(samples: Int16Array): Uint8Array {
  const floats = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]! / 32_768;
    floats[i] = v < -1 ? -1 : v > 1 ? 1 : v;
  }
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
}

export interface TargetAsrMessage {
  message: (typeof TARGET_ASR_TRANSPORT.events)[keyof typeof TARGET_ASR_TRANSPORT.events];
  metadata: {
    stream: TargetAsrStreamId;
    transcript: string;
    /** Media time (ms) of the event. */
    time: number;
    isFinal: boolean;
  };
  payload: { text: string };
}

/** Maps the internal ASR event onto the target's event vocabulary. */
export function toTargetAsrMessage(
  event: AsrEvent,
  stream: TargetAsrStreamId,
): TargetAsrMessage {
  const message = event.isFinal
    ? TARGET_ASR_TRANSPORT.events.final
    : TARGET_ASR_TRANSPORT.events.partial;
  return {
    message,
    metadata: {
      stream,
      transcript: event.text,
      time: event.mediaMs,
      isFinal: event.isFinal,
    },
    payload: { text: event.text },
  };
}

/** EndOfUtterance is a distinct target event (T-09); emitted after a final. */
export function targetEndOfUtterance(
  stream: TargetAsrStreamId,
  utteranceId: string,
  mediaMs: number,
): { message: "EndOfUtterance"; metadata: { stream: TargetAsrStreamId; utteranceId: string; time: number } } {
  return {
    message: TARGET_ASR_TRANSPORT.events.endpoint,
    metadata: { stream, utteranceId, time: mediaMs },
  };
}

/* ── T-10: LLM answer transport (SSE) ────────────────────────────────────── */

export const TARGET_SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

export const TARGET_LLM_TRANSPORT = {
  transport: "sse",
  path: "/api/chat",
  method: "POST",
  headers: TARGET_SSE_HEADERS,
} as const;

/**
 * T-10/T-11 — per-model first-token latency table observed in the target
 * client (`aiModelTtftMs`). Mock streaming uses these so the demo measures the
 * same model-specific budget the product quotes.
 */
export const TARGET_MODEL_TTFT_MS: Readonly<Record<string, number>> = {
  "gpt-5": 506,
  "claude-sonnet-4-5": 1_774,
  "claude-haiku-4-5": 1_208,
  "gemini-3-1-flash-lite": 387,
  "gemini-3-6-flash": 758,
  "gemini-3-5-flash-lite": 474,
};

const DEFAULT_TTFT_MS = 620;

/** Normalises provider-prefixed / dotted slugs to the target alias keys. */
export function normalizeModelAlias(model: string): string {
  let value = model.trim().toLowerCase();
  if (value.includes("/")) value = value.split("/").pop() ?? value;
  // OpenRouter uses dots for anthropic versions; the target table uses hyphens.
  return value.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

/** Target TTFT for a model, falling back to a neutral demo delay. */
export function firstTokenDelayForModel(model: string | null | undefined): number {
  if (!model) return DEFAULT_TTFT_MS;
  return TARGET_MODEL_TTFT_MS[normalizeModelAlias(model)] ?? DEFAULT_TTFT_MS;
}

/* ── T-11: session create contract ───────────────────────────────────────── */

/**
 * Fields the desktop client sends when creating a call session (T-11).
 * The server owns prompt assembly; the client sends references + preferences.
 */
export const TARGET_SESSION_CREATE_FIELDS = [
  "resumeId",
  "documentIds",
  "language",
  "aiModel",
  "responseLength",
  "responseFormat",
  "responseTone",
  "useStarMethod",
  "useFillerWords",
  "autoAnswer",
  "saveTranscription",
  "transcriptionContext",
  "systemInstructions",
  "createdFrom",
] as const;

export type TargetSessionCreateField = (typeof TARGET_SESSION_CREATE_FIELDS)[number];

export interface TargetSessionCreate {
  resumeId: string | null;
  documentIds: string[];
  language: string;
  aiModel: string;
  responseLength: "short" | "medium" | "long";
  responseFormat: "prose" | "bullets" | "code";
  responseTone: "confident" | "conversational" | "formal";
  useStarMethod: boolean;
  useFillerWords: boolean;
  autoAnswer: boolean;
  saveTranscription: boolean;
  transcriptionContext: string;
  systemInstructions: string;
  createdFrom: "desktop-app";
}

/** Deterministic demo session-create payload. */
export function createDemoSessionCreate(overrides: Partial<TargetSessionCreate> = {}): TargetSessionCreate {
  return {
    resumeId: null,
    documentIds: [],
    language: "en",
    aiModel: "gpt-5",
    responseLength: "medium",
    responseFormat: "prose",
    responseTone: "confident",
    useStarMethod: false,
    useFillerWords: false,
    autoAnswer: true,
    saveTranscription: true,
    transcriptionContext: "Live technical interview; the interviewer is asking system-design questions.",
    systemInstructions: "",
    createdFrom: "desktop-app",
    ...overrides,
  };
}

export interface SessionCreateValidation {
  ok: boolean;
  missing: string[];
  unknown: string[];
  createdFromValid: boolean;
}

/** Validates a payload against the observed target contract. */
export function validateTargetSessionCreate(
  input: TargetSessionCreate | Record<string, unknown>,
): SessionCreateValidation {
  const record = input as Record<string, unknown>;
  const known = new Set<string>(TARGET_SESSION_CREATE_FIELDS);
  const missing = TARGET_SESSION_CREATE_FIELDS.filter((field) => !(field in record));
  const unknown = Object.keys(record).filter((key) => !known.has(key));
  return {
    ok: missing.length === 0 && record["createdFrom"] === "desktop-app",
    missing,
    unknown,
    createdFromValid: record["createdFrom"] === "desktop-app",
  };
}
