/**
 * BUG 2 diagnostics (Mini-Phase 3) — proves streamChatComplete distinguishes
 * the five states required: finish_reason stop/length/missing-other, a
 * mid-stream network error, and an idle-timeout abort. No secrets, prompts,
 * or answer text are asserted — only structural diagnostic fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env["OPENROUTER_API_KEY"] = "test-key-not-real";

import { logger } from "../src/lib/logger.js";
import { streamChatComplete } from "../src/lib/openrouter.js";

function sseChunk(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function mockStreamResponse(lines: string[], ok = true): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, { status: ok ? 200 : 500 });
}

describe("streamChatComplete — BUG 2 diagnostics", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined as any);
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('15. finish_reason "stop" is captured and logged on natural completion', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse([
          sseChunk({ id: "gen-1", choices: [{ delta: { content: "Hello" } }] }),
          sseChunk({ id: "gen-1", choices: [{ delta: {}, finish_reason: "stop" }] }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const onDelta = vi.fn();
    const result = await streamChatComplete(
      { messages: [{ role: "user", content: "hi" }] },
      onDelta,
    );

    expect(result).toBe("Hello");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "gen-1",
        finishReason: "stop",
        outputChars: 5,
        sawDone: true,
      }),
      "[openrouter] streamChatComplete finished",
    );
    vi.unstubAllGlobals();
  });

  it('16. finish_reason "length" is captured and logged — proves genuine model-side truncation, distinguishable from a rendering bug', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse([
          sseChunk({ id: "gen-2", choices: [{ delta: { content: "Truncated" } }] }),
          sseChunk({ id: "gen-2", choices: [{ delta: {}, finish_reason: "length" }] }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const result = await streamChatComplete(
      { messages: [{ role: "user", content: "hi" }] },
      () => {},
    );

    expect(result).toBe("Truncated");
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "gen-2", finishReason: "length" }),
      "[openrouter] streamChatComplete finished",
    );
    vi.unstubAllGlobals();
  });

  it("17. missing/other finish reason is logged distinctly (not confused with a real stop)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse([
          sseChunk({ id: "gen-3", choices: [{ delta: { content: "Some text" } }] }),
          // Stream ends with [DONE] but no explicit finish_reason chunk ever arrived.
          "data: [DONE]\n\n",
        ]),
      ),
    );

    await streamChatComplete({ messages: [{ role: "user", content: "hi" }] }, () => {});

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: "gen-3", finishReason: "unknown_stop", sawDone: true }),
      "[openrouter] streamChatComplete finished",
    );
    vi.unstubAllGlobals();
  });

  it("18. a mid-stream network error is logged distinctly from an abort, then re-thrown (existing caller error-handling preserved)", async () => {
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseChunk({ id: "gen-4", choices: [{ delta: { content: "partial" } }] })));
      },
      pull() {
        throw new Error("simulated network drop");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(failingStream, { status: 200 })),
    );

    await expect(
      streamChatComplete({ messages: [{ role: "user", content: "hi" }] }, () => {}),
    ).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ aborted: false, errorName: expect.any(String) }),
      "[openrouter] streamChatComplete stream error/abort",
    );
    vi.unstubAllGlobals();
  });

  it("19. an idle-timeout abort is logged with aborted: true, distinguishable from a plain network error", async () => {
    vi.useFakeTimers();
    // The mock must actually wire the AbortSignal streamChatComplete passes
    // to fetch() — a synthetic stream that never enqueues/closes AND ignores
    // the signal would just hang forever, not exercise the abort path.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        const neverEndingStream = new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener("abort", () => {
              controller.error(new DOMException("The operation was aborted.", "AbortError"));
            });
          },
        });
        return Promise.resolve(new Response(neverEndingStream, { status: 200 }));
      }),
    );

    // Attach a rejection handler immediately (synchronously, in the same
    // tick) so nothing is ever "unhandled" while fake timers advance below.
    const resultPromise = streamChatComplete(
      { messages: [{ role: "user", content: "hi" }] },
      () => {},
    );
    const outcome = resultPromise.then(
      () => ({ status: "resolved" as const }),
      (err: unknown) => ({ status: "rejected" as const, err }),
    );

    // Advance past OPENROUTER_STREAM_IDLE_MS (default 45000ms) to trigger the idle abort.
    await vi.advanceTimersByTimeAsync(45001);

    const result = await outcome;
    expect(result.status).toBe("rejected");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ aborted: true }),
      "[openrouter] streamChatComplete stream error/abort",
    );
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("never logs prompt or answer text — only structural fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockStreamResponse([
          sseChunk({
            id: "gen-5",
            choices: [{ delta: { content: "SENSITIVE_ANSWER_CONTENT_MARKER" }, finish_reason: "stop" }],
          }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    await streamChatComplete({ messages: [{ role: "user", content: "hi" }] }, () => {});

    const loggedPayload = infoSpy.mock.calls[0]?.[0];
    expect(JSON.stringify(loggedPayload)).not.toContain("SENSITIVE_ANSWER_CONTENT_MARKER");
    vi.unstubAllGlobals();
  });
});
