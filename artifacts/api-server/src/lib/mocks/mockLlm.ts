/**
 * Mock LLM adapter (G-001 / G-017).
 *
 * Emits a deterministic, structured interview answer in word-group chunks with
 * a configurable first-token delay, so the latency harness can measure
 * question -> first token and question -> answer visible without a provider key.
 * Implements the same LlmProvider contract as the OpenRouter adapter.
 */
import type { LlmProvider, LlmStreamRequest } from "./types.js";

/** Deterministic structured answer used by the demo (also asserted in the overlay e2e). */
export const DEMO_LLM_ANSWER = [
  "Here's how I'd answer that in a real interview.",
  "",
  "I'd start by **framing the problem in one sentence**, then walk through the design decisions. In my last role I built a **Redis-backed rate limiter** for an Express API: a fixed window using `INCR` plus a short `EXPIRE`, with the limit keyed by user id and route.",
  "",
  "- **Trade-off:** fixed windows are simple but allow bursts at the boundary, so I added a sliding-window counter for the sensitive endpoints.",
  "- **Failure mode:** if Redis is unavailable I fall back to an in-process token bucket, so the API degrades instead of failing open.",
  "- **Observability:** every decision emits a counter and a p99 latency metric, so we see throttling before users complain.",
  "",
  "That's the answer I'd give - concrete, honest about trade-offs, and grounded in what I actually shipped.",
].join("\n");

export interface MockLlmProviderOptions {
  id?: string;
  /** Delay before the first delta is emitted, in ms (default 620). */
  firstTokenDelayMs?: number;
  /** Delay between subsequent deltas, in ms (default 45). */
  chunkDelayMs?: number;
  /** Words grouped into one delta (default 3). */
  wordsPerChunk?: number;
  /** Fixed answer text; ignored when answerFor is supplied. */
  answer?: string;
  answerFor?: (req: LlmStreamRequest) => string;
  /** Test hook: throw this error instead of streaming (failover tests). */
  failWith?: Error | null;
  /** Test hook: throw after N deltas, simulating a mid-stream provider crash. */
  failAfterDeltas?: number;
  /** Injectable wall clock (ms) for latency assertions. */
  clock?: () => number;
  /** Injectable sleep so tests do not wait on real timers. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/**
 * Splits an answer into chunks of N whitespace-prefixed tokens such that
 * `chunks.join("") === answer` (streaming consumers can concatenate blindly).
 */
export function splitAnswerIntoChunks(answer: string, wordsPerChunk = 3): string[] {
  const tokens = answer.match(/\s*\S+/g) ?? [];
  if (!tokens.length) return [];
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) {
    chunks.push(tokens.slice(i, i + wordsPerChunk).join(""));
  }
  return chunks;
}

export interface MockLlmProvider extends LlmProvider {
  /** Number of times stream() was called (test/router diagnostics). */
  readonly streamCalls: number;
  readonly lastRequest: LlmStreamRequest | null;
}

export function createMockLlmProvider(
  opts: MockLlmProviderOptions = {},
): MockLlmProvider {
  const firstTokenDelayMs = opts.firstTokenDelayMs ?? 620;
  const chunkDelayMs = opts.chunkDelayMs ?? 45;
  const wordsPerChunk = opts.wordsPerChunk ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const clock = opts.clock ?? (() => performance.now());
  let streamCalls = 0;
  let lastRequest: LlmStreamRequest | null = null;

  const provider = {
    id: opts.id ?? "mock-llm",
    kind: "mock" as const,
    isConfigured: () => true,
    get streamCalls() {
      return streamCalls;
    },
    get lastRequest() {
      return lastRequest;
    },
    async stream(
      req: LlmStreamRequest,
      onDelta: (delta: string) => void,
    ): Promise<string> {
      streamCalls += 1;
      lastRequest = req;
      if (opts.failWith) throw opts.failWith;
      if (req.signal?.aborted) throw abortError();

      const answer = opts.answerFor?.(req) ?? opts.answer ?? DEMO_LLM_ANSWER;
      const chunks = splitAnswerIntoChunks(answer, wordsPerChunk);
      let full = "";
      for (let i = 0; i < chunks.length; i++) {
        await sleep(i === 0 ? firstTokenDelayMs : chunkDelayMs, req.signal);
        if (opts.failAfterDeltas !== undefined && i >= opts.failAfterDeltas) {
          throw new Error("mock-llm: simulated mid-stream failure");
        }
        const chunk = chunks[i]!;
        full += chunk;
        onDelta(chunk);
      }
      // Keep clock referenced so injected clocks are meaningful in tests/docs.
      void clock;
      return full;
    },
  };
  return provider;
}
