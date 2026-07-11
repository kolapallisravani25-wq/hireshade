import { describe, it, expect, afterEach } from "vitest";
import {
  normalizeModelSlug,
  classifyOpenRouterError,
  isAiConfigured,
} from "../src/lib/openrouter.js";

// Regression guard for the answer-generation "immediate error" bug: the UI
// pickers / session defaults / DB stored hyphenated version slugs
// (`anthropic/claude-haiku-4-5`) but OpenRouter's real identifier uses a dot
// (`anthropic/claude-haiku-4.5`). The hyphen slug returned HTTP 400 from
// OpenRouter, which — because /ai-answer had already streamed its 200 header —
// surfaced as an in-card "**ERROR:** Answer generation failed" with no answer.
describe("normalizeModelSlug", () => {
  it("rewrites hyphenated anthropic version slugs to dotted OpenRouter slugs", () => {
    expect(normalizeModelSlug("anthropic/claude-haiku-4-5")).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(normalizeModelSlug("anthropic/claude-sonnet-4-5")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("leaves already-correct dotted anthropic slugs unchanged", () => {
    expect(normalizeModelSlug("anthropic/claude-haiku-4.5")).toBe(
      "anthropic/claude-haiku-4.5",
    );
    expect(normalizeModelSlug("anthropic/claude-sonnet-4.5")).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("leaves non-anthropic and non-version slugs unchanged", () => {
    expect(normalizeModelSlug("openai/gpt-5")).toBe("openai/gpt-5");
    expect(normalizeModelSlug("anthropic/claude-3.5-sonnet")).toBe(
      "anthropic/claude-3.5-sonnet",
    );
    expect(normalizeModelSlug("google/gemini-3.1-flash-lite-preview")).toBe(
      "google/gemini-3.1-flash-lite-preview",
    );
  });
});

// Deterministic classification of OpenRouter HTTP failures, surfaced in
// privacy-safe diagnostic logs so a live incident can be triaged from the
// category alone (auth vs invalid model vs rate limit) without the body.
describe("classifyOpenRouterError", () => {
  it("classifies the common failure statuses", () => {
    expect(classifyOpenRouterError(400)).toBe("invalid_request");
    expect(classifyOpenRouterError(401)).toBe("auth");
    expect(classifyOpenRouterError(403)).toBe("auth");
    expect(classifyOpenRouterError(404)).toBe("model_not_found");
    expect(classifyOpenRouterError(429)).toBe("rate_limited");
    expect(classifyOpenRouterError(500)).toBe("server_error");
    expect(classifyOpenRouterError(503)).toBe("server_error");
  });

  it("falls back to unknown for unmapped statuses", () => {
    expect(classifyOpenRouterError(200)).toBe("unknown");
    expect(classifyOpenRouterError(418)).toBe("unknown");
  });
});

// The /ai-answer route calls isAiConfigured() BEFORE flushing its streaming
// 200 so a missing key yields a clean status instead of a broken answer card.
describe("isAiConfigured", () => {
  const original = process.env["OPENROUTER_API_KEY"];
  afterEach(() => {
    if (original === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = original;
  });

  it("is false when the key is unset or empty", () => {
    delete process.env["OPENROUTER_API_KEY"];
    expect(isAiConfigured()).toBe(false);
    process.env["OPENROUTER_API_KEY"] = "";
    expect(isAiConfigured()).toBe(false);
  });

  it("is true when the key is set", () => {
    process.env["OPENROUTER_API_KEY"] = "sk-test";
    expect(isAiConfigured()).toBe(true);
  });
});
