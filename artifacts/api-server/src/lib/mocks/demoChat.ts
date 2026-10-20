/**
 * Mock /api/chat SSE endpoint (T-10 alignment, G-001).
 *
 * Reproduces the target's answer transport: POST /api/chat returning
 * text/event-stream with Cache-Control: no-cache,no-transform and
 * X-Accel-Buffering: no. Streams the mock LLM answer, zero keys. Gated by
 * DEMO_MODE and fails closed.
 */
import { Router, type IRouter } from "express";
import {
  assertDemoModeSafe,
  isDemoModeSafe,
  isProduction,
} from "./demoMode.js";
import { DEMO_LLM_ANSWER, splitAnswerIntoChunks, type MockLlmProviderOptions } from "./mockLlm.js";
import { TARGET_SSE_HEADERS, firstTokenDelayForModel } from "./targetContracts.js";

export interface DemoSseStreamOptions {
  env?: NodeJS.ProcessEnv;
  /** Inject a streaming implementation for tests (defaults to the mock LLM). */
  streamAnswer?: (opts: {
    model: string;
    onDelta: (delta: string) => void;
    signal: AbortSignal;
  }) => Promise<string>;
  /** Default model when the request body omits one. */
  defaultModel?: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

/** Default keyless streaming implementation (mock answer, model-specific TTFT). */
export function createMockAnswerStream(
  opts: MockLlmProviderOptions = {},
): (args: { model: string; onDelta: (delta: string) => void; signal: AbortSignal }) => Promise<string> {
  return async ({ model, onDelta, signal }) => {
    const answer = opts.answer ?? DEMO_LLM_ANSWER;
    const chunks = splitAnswerIntoChunks(answer, opts.wordsPerChunk ?? 3);
    const firstDelay = opts.firstTokenDelayMs ?? firstTokenDelayForModel(model);
    const chunkDelay = opts.chunkDelayMs ?? 45;
    for (let i = 0; i < chunks.length; i++) {
      await sleep(i === 0 ? firstDelay : chunkDelay, signal);
      if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      onDelta(chunks[i]!);
    }
    return answer;
  };
}

export function createDemoChatRouter(opts: DemoSseStreamOptions = {}): IRouter {
  const env = opts.env ?? process.env;
  const router = Router();
  const streamAnswer = opts.streamAnswer ?? createMockAnswerStream();

  router.post("/api/chat", async (req, res) => {
    if (!isDemoModeSafe(env)) {
      res.status(403).json({
        error: "demo_mode_disabled",
        production: isProduction(env),
      });
      return;
    }
    try {
      assertDemoModeSafe(env);
    } catch (err) {
      res.status(403).json({ error: "demo_mode_disabled", message: String(err) });
      return;
    }
    const body = (req.body ?? {}) as { model?: string; messages?: unknown[] };
    const model = body.model?.trim() || opts.defaultModel || "gpt-5";

    // Target SSE headers (T-10) — set before flushing so proxies see them.
    for (const [name, value] of Object.entries(TARGET_SSE_HEADERS)) {
      res.setHeader(name, value);
    }
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    const controller = new AbortController();
    // `req` close fires when the request stream finishes (immediately for a
    // small JSON body), so client-disconnect detection must listen on `res`.
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    let firstDeltaSent = false;
    const writeEvent = (payload: Record<string, unknown>) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const startedAt = Date.now();
    writeEvent({ type: "start", model, transport: "sse" });

    try {
      await streamAnswer({
        model,
        signal: controller.signal,
        onDelta: (delta) => {
          writeEvent({
            type: "delta",
            text: delta,
            firstToken: !firstDeltaSent,
            elapsedMs: Date.now() - startedAt,
          });
          firstDeltaSent = true;
        },
      });
      writeEvent({ type: "done", elapsedMs: Date.now() - startedAt });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      if (!res.writableEnded) {
        writeEvent({ type: "error", message: err instanceof Error ? err.message : String(err) });
        res.end();
      }
    }
  });

  return router;
}
