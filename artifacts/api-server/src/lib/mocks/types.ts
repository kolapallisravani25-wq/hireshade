/**
 * Provider abstraction layer (G-001 / G-017).
 *
 * The api-server hard-depended on three hosted vendors (OpenRouter, Deepgram,
 * Clerk) and threw when their keys were missing, so a "mock session" was
 * impossible without real credentials. This module defines the seams:
 *
 *   LlmProvider  — streaming chat completion (OpenRouter or mock)
 *   AsrProvider  — streaming speech-to-text (Deepgram or scripted mock)
 *   TtsProvider  — speech synthesis (mock; no real backend exists in repo)
 *
 * Real adapters keep the existing production behaviour (fail closed when the
 * key is missing). Mock adapters are only ever constructed behind DEMO_MODE and
 * never read a provider key — see demoMode.ts.
 */

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmStreamRequest {
  model?: string | null;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Caller cancellation (request abort / client disconnect). */
  signal?: AbortSignal;
}

export type LlmProviderKind = "mock" | "openrouter";

export interface LlmProvider {
  readonly id: string;
  readonly kind: LlmProviderKind;
  /** False when the provider's real credential/env is absent. Mocks are always configured. */
  isConfigured(): boolean;
  /** Streams deltas; resolves with the full accumulated answer. */
  stream(
    req: LlmStreamRequest,
    onDelta: (delta: string) => void,
  ): Promise<string>;
}

export interface LlmProviderAttempt {
  providerId: string;
  ok: boolean;
  /** True when at least one delta had already reached the caller. */
  emitted: boolean;
  error?: string;
}

export interface LlmRouterResult {
  providerId: string;
  text: string;
  attempts: LlmProviderAttempt[];
  failovers: number;
  /** Wall-clock ms from router.stream() entry to the first delta. */
  firstTokenLatencyMs: number;
}

/* ── ASR ─────────────────────────────────────────────────────────────────── */

export type AsrProviderKind = "mock" | "deepgram";

/**
 * What an ASR backend can actually deliver. Everything is optional so an
 * adapter that predates the pronunciation layer keeps working (the consumer
 * must treat an absent capability as "not supported").
 */
export interface AsrProviderCapabilities {
  /** Emits more than one transcript hypothesis (`alternatives` on the event). */
  nBest?: boolean;
  /** Emits per-word confidence (`words[].confidence`). */
  wordConfidence?: boolean;
  /** Accepts a boosting vocabulary to bias the decoder towards domain terms. */
  keywordBoosting?: boolean;
}

/** One alternative spelling for a single word from the decoder lattice. */
export interface AsrWordAlternative {
  word: string;
  /** 0..1 decoder confidence for this spelling. */
  confidence: number;
}

/** A recognised word with its decoder confidence (G-039). */
export interface AsrWord {
  word: string;
  /** Confidence in [0, 1]. Missing on adapters without word confidence. */
  confidence: number;
  /** Offset from the utterance start, in media ms (when the backend reports it). */
  startMs?: number;
  endMs?: number;
  /** Competing spellings for this word, when the backend exposes them. */
  alternatives?: AsrWordAlternative[];
}

/** One full n-best transcript hypothesis (G-039). */
export interface AsrNBestAlternative {
  text: string;
  /** 0..1 decoder confidence for this whole hypothesis. */
  confidence: number;
  words?: AsrWord[];
}

/**
 * A decoder vocabulary entry. Deepgram's `keywords` query parameter accepts
 * `term:boost` (boost is an integer multiplier, e.g. 2). Adapters that cannot
 * boost ignore this field.
 */
export interface AsrKeywordBoost {
  term: string;
  /** Integer boost multiplier (Deepgram default 1, useful range 1-5). */
  boost?: number;
}

export interface TranscriptPartial {
  /** Offset from the utterance start, in media ms. */
  atMs: number;
  text: string;
  words?: AsrWord[];
  alternatives?: AsrNBestAlternative[];
}

/** One scripted interviewer utterance (fixture data, media-time anchored). */
export interface TranscriptUtterance {
  id: string;
  /** Media time (ms) where speech starts, from the VAD segmenter. */
  startMs: number;
  /** Media time (ms) where speech ends (silence begins). */
  endMs: number;
  text: string;
  /** Interim previews emitted while the interviewer is still speaking. */
  partials?: TranscriptPartial[];
  /** Per-word confidence for the final, when the script/backend provides it. */
  words?: AsrWord[];
  /** N-best alternatives for the final, when the script/backend provides them. */
  alternatives?: AsrNBestAlternative[];
}

export interface AsrEvent {
  type: "partial" | "final";
  segmentId: string;
  text: string;
  /** Media time at which this event logically occurs (ms from audio start). */
  mediaMs: number;
  /** Wall-clock time (ms) when the provider emitted it. */
  atMs: number;
  isFinal: boolean;
  /** Per-word confidence for this event, when the backend reports it (G-039). */
  words?: AsrWord[];
  /** N-best hypotheses for this event, when the backend reports them (G-039). */
  alternatives?: AsrNBestAlternative[];
}

export interface AsrStreamOptions {
  sampleRate: number;
  /** Mock providers replay this script; real providers ignore it. */
  script?: TranscriptUtterance[];
  /** Silence that must pass after speech before a final is emitted (default 700). */
  endpointSilenceMs?: number;
  language?: string;
  /**
   * Domain vocabulary to bias the decoder (G-039). Adapters that support it
   * forward the list; others ignore it. Backward compatible: omitted = no boost.
   */
  keywords?: (string | AsrKeywordBoost)[];
  /** Ask for up to N hypotheses (G-039). Adapters without n-best ignore it. */
  nBestAlternatives?: number;
  /** Ask for word-level confidence when the adapter supports it. */
  wordConfidence?: boolean;
  /** Optional language hints for code-switched audio (primary first). */
  languageHints?: string[];
  /** Wall clock, injectable for deterministic tests. */
  now?: () => number;
  /** Async delivery callback (required for real providers). Mocks also return events. */
  onEvent?: (event: AsrEvent) => void;
}

export interface AsrStream {
  /**
   * Feed mono PCM; returns events emitted synchronously by mocks. int16 is the
   * WAV fixture format, float32 is the target's wire format (T-09: pcm_f32le).
   */
  pushAudio(pcm: Int16Array | Float32Array): AsrEvent[];
  /** End of audio: flush any pending finals. */
  endAudio(): AsrEvent[];
  close(): void;
}

export interface AsrProvider {
  readonly id: string;
  readonly kind: AsrProviderKind;
  /** Optional feature advertisement (G-039). Absent = no extended features. */
  readonly capabilities?: AsrProviderCapabilities;
  isConfigured(): boolean;
  openStream(opts: AsrStreamOptions): AsrStream;
}

/* ── TTS ─────────────────────────────────────────────────────────────────── */

export interface TtsRequest {
  text: string;
  sampleRate?: number;
  voice?: string;
  signal?: AbortSignal;
}

export interface TtsWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TtsResult {
  audio: Uint8Array;
  format: "pcm_s16le";
  sampleRate: number;
  durationMs: number;
  wordTimings: TtsWordTiming[];
  providerId: string;
}

export interface TtsProvider {
  readonly id: string;
  readonly kind: "mock" | "openai";
  isConfigured(): boolean;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}
