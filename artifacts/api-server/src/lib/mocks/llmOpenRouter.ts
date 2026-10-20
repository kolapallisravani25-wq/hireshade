/**
 * OpenRouter LlmProvider adapter (G-017).
 *
 * Thin wrapper over the existing, production-hardened `streamChatComplete`
 * client in ../openrouter.ts: same timeout/idle guard, same SSE parsing, same
 * model normalisation. Adding the adapter must not change real behaviour, so it
 * delegates rather than duplicating.
 */
import { isAiConfigured, streamChatComplete } from "../openrouter.js";
import type { LlmProvider, LlmStreamRequest } from "./types.js";

export function createOpenRouterLlmProvider(): LlmProvider {
  return {
    id: "openrouter",
    kind: "openrouter",
    isConfigured: () => isAiConfigured(),
    async stream(req: LlmStreamRequest, onDelta: (delta: string) => void): Promise<string> {
      return streamChatComplete(
        {
          model: req.model,
          messages: req.messages,
          temperature: req.temperature,
          maxTokens: req.maxTokens,
        },
        onDelta,
      );
    },
  };
}
