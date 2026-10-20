import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterLlmProvider } from "./llmOpenRouter.js";

const originalKey = process.env["OPENROUTER_API_KEY"];

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env["OPENROUTER_API_KEY"];
  else process.env["OPENROUTER_API_KEY"] = originalKey;
});

describe("createOpenRouterLlmProvider", () => {
  it("is unconfigured without OPENROUTER_API_KEY and fails closed", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    const provider = createOpenRouterLlmProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.kind).toBe("openrouter");
    await expect(provider.stream({ messages: [] }, () => {})).rejects.toThrow(
      /OPENROUTER_API_KEY not set/,
    );
  });

  it("keeps the real streaming path working (SSE parse + bearer auth)", async () => {
    process.env["OPENROUTER_API_KEY"] = "sk-or-test-key";
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean; model?: string };
      expect(body.stream).toBe(true);
      expect(body.model).toBe("anthropic/claude-haiku-4.5");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer sk-or-test-key");
      return sseResponse([
        'data: {"id":"gen-1","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"id":"gen-1","choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenRouterLlmProvider();
    expect(provider.isConfigured()).toBe(true);
    const deltas: string[] = [];
    const text = await provider.stream(
      {
        // legacy hyphen separator must still be normalised by the real client
        model: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", content: "hi" }],
      },
      (d) => deltas.push(d),
    );
    expect(text).toBe("Hello world");
    expect(deltas).toEqual(["Hello", " world"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
