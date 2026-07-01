import { logger } from "./logger.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env["ANSWER_MODEL"] || "google/gemini-2.5-flash-lite";

const OPENROUTER_TIMEOUT_MS = Number(process.env["OPENROUTER_TIMEOUT_MS"] ?? "60000") || 60000;
const OPENROUTER_STREAM_IDLE_MS = Number(process.env["OPENROUTER_STREAM_IDLE_MS"] ?? "45000") || 45000;

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

function resolveModel(_model?: string | null): string {
  // Launch rule: keep the in-session model controlled server-side.
  // Do not trust client-supplied model slugs for session answer generation.
  return DEFAULT_MODEL;
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
      temperature: opts.temperature ?? 0.6,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, text }, "[openrouter] chatComplete failed");
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
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), OPENROUTER_STREAM_IDLE_MS);
  };

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
      logger.error({ status: res.status, text }, "[openrouter] streamChatComplete failed");
      throw new Error(`OpenRouter request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

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
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string } }[];
          };
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

    return full;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}
