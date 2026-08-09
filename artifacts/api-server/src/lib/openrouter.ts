import { logger } from "./logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

/**
 * Overall timeout for a non-streaming completion, and idle (no-bytes) timeout
 * for a streaming completion. Both bound the case where OpenRouter accepts the
 * connection then stalls — without these the Node request hangs indefinitely
 * and, under load, exhausts the connection pool.
 */
const OPENROUTER_TIMEOUT_MS =
  Number(process.env["OPENROUTER_TIMEOUT_MS"] ?? "60000") || 60000;
const OPENROUTER_STREAM_IDLE_MS =
  Number(process.env["OPENROUTER_STREAM_IDLE_MS"] ?? "45000") || 45000;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatImagePart {
  type: "image_url";
  image_url: { url: string };
}

export interface ChatTextPart {
  type: "text";
  text: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | (ChatTextPart | ChatImagePart)[];
}

function getApiKey(): string {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) {
    throw new Error("OPENROUTER_API_KEY not set. AI features are unavailable.");
  }
  return key;
}

/**
 * Whether the AI backend is configured. Lets a request handler short-circuit
 * with a clean status BEFORE it flushes a streaming 200, instead of letting
 * `getApiKey()` throw mid-stream (which the client can only show as a broken
 * answer card). Never returns or logs the key value itself.
 */
export function isAiConfigured(): boolean {
  return !!process.env["OPENROUTER_API_KEY"];
}

/**
 * Classify an OpenRouter HTTP status into a stable, log-safe category so
 * failures are diagnosable from logs without inspecting response bodies (which
 * may echo the prompt). Pure and unit-tested.
 */
export function classifyOpenRouterError(status: number): string {
  if (status === 400) return "invalid_request";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unknown";
}

/**
 * Models excluded platform-wide (spec §8c / desktop §8.7a: "GPT-4o / GPT-4
 * Pointer is explicitly excluded ... they do not appear as options anywhere").
 * The picker no longer offers them, but an old session row may still carry one,
 * so this backend guard maps any excluded model to the default — nothing ever
 * routes to an excluded model regardless of stored state.
 */
function isExcludedModel(model: string): boolean {
  return /(^|\/)gpt-4o/i.test(model) || /(^|\/)gpt-4-?(pointer|turbo-pointer)/i.test(model);
}

/**
 * Correct legacy/mis-typed version separators in an OpenRouter slug.
 *
 * The UI pickers, session defaults, and DB `ai_model` default historically
 * stored `anthropic/claude-haiku-4-5` and `anthropic/claude-sonnet-4-5` — with
 * a HYPHEN between the major/minor version. OpenRouter's real identifiers use a
 * DOT (`anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-4.5`), so every
 * request built from a stored session model hit a 400 "model not found" and,
 * because `/ai-answer` had already flushed its 200 + QUESTION line, surfaced to
 * the user as an in-card "**ERROR:** Answer generation failed" with no answer.
 *
 * Normalising here fixes existing session rows AND any new ones without a
 * data migration: a trailing `-<major>-<minor>` on an anthropic slug becomes
 * `-<major>.<minor>`. Slugs that already use a dot, or non-anthropic slugs
 * (e.g. `openai/gpt-5`), are returned unchanged.
 */
export function normalizeModelSlug(model: string): string {
  return model.replace(/^(anthropic\/[a-z]+(?:-[a-z]+)*)-(\d+)-(\d+)$/i, "$1-$2.$3");
}

function resolveModel(model?: string | null): string {
  const m = model && model.trim() ? normalizeModelSlug(model.trim()) : "";
  if (!m || isExcludedModel(m)) return DEFAULT_MODEL;
  return m;
}

/** Non-streaming chat completion. Returns the assistant's full text reply. */
export async function chatComplete(opts: {
  model?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveModel(opts.model),
      messages: opts.messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 2000,
    }),
    signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, category: classifyOpenRouterError(res.status), text },
      "[openrouter] chatComplete failed",
    );
    throw new Error(`OpenRouter request failed (${res.status})`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Extracts the first JSON value (object or array) embedded in `text`,
 * tolerating markdown code fences and leading/trailing prose.
 */
function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === opener) depth++;
    else if (candidate[i] === closer) {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unterminated JSON in model response");
}

/** Chat completion that asks the model for JSON and parses the result. */
export async function chatCompleteJSON<T>(opts: {
  model?: string | null;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const text = await chatComplete(opts);
  return extractJSON(text) as T;
}

/**
 * Streaming chat completion. Invokes `onDelta` for each text chunk as it
 * arrives and returns the full accumulated text once the stream ends.
 */
export async function streamChatComplete(
  opts: {
    model?: string | null;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  },
  onDelta: (chunk: string) => void,
): Promise<string> {
  // Idle guard: abort only if OpenRouter goes silent for OPENROUTER_STREAM_IDLE_MS.
  // Armed before the fetch (so a stalled connect is also bounded) and reset on
  // every received chunk, so a healthy long stream is never cut off.
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleAborted = false;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleAborted = true;
      controller.abort();
    }, OPENROUTER_STREAM_IDLE_MS);
  };

  // BUG 2 diagnostics (cut-off-answer investigation): capture enough to
  // distinguish "model stopped naturally" from "model hit the token limit"
  // from "the stream itself failed/aborted" — without this, a truncated-
  // looking answer in the UI is indistinguishable from a rendering/scroll
  // problem using logs alone. Only id/finish_reason/length/estimated-token
  // metadata is logged — never prompt or answer text.
  let generationId: string | null = null;
  let finishReason: string | null = null;
  let full = "";
  let sawDone = false;

  try {
    armIdle();
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveModel(opts.model),
        messages: opts.messages,
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 2000,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      logger.error(
        { status: res.status, category: classifyOpenRouterError(res.status), text },
        "[openrouter] streamChatComplete failed",
      );
      throw new Error(`OpenRouter request failed (${res.status})`);
    }

    // Diagnostics scoped to just the streaming read loop — a request that
    // never got a response body (handled above) is already logged with more
    // specific context; this inner try/catch only covers genuine mid-stream
    // failures (network drop, idle-timeout abort) so they aren't logged twice.
    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            sawDone = true;
            continue;
          }
          try {
            const parsed = JSON.parse(data) as {
              id?: string;
              choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
            };
            if (parsed.id && !generationId) generationId = parsed.id;
            if (parsed.choices?.[0]?.finish_reason) {
              finishReason = parsed.choices[0].finish_reason;
            }
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            // Ignore malformed/partial SSE lines.
          }
        }
      }

      logger.info(
        {
          generationId,
          finishReason: finishReason ?? (sawDone ? "unknown_stop" : "missing"),
          outputChars: full.length,
          estimatedTokens: Math.ceil(full.length / 4),
          sawDone,
        },
        "[openrouter] streamChatComplete finished",
      );
      return full;
    } catch (err) {
      logger.error(
        {
          generationId,
          finishReason,
          outputChars: full.length,
          estimatedTokens: Math.ceil(full.length / 4),
          aborted: idleAborted,
          errorName: err instanceof Error ? err.name : typeof err,
        },
        "[openrouter] streamChatComplete stream error/abort",
      );
      throw err;
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
