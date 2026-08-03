import { describe, expect, it } from "vitest";
import { AiRateLimitError, enforceAiRateLimit } from "../src/lib/aiRateLimit.js";

describe("enforceAiRateLimit", () => {
  it("blocks a user/scope after the configured fixed-window budget", () => {
    const key = `user-a:resume:${Math.random()}`;
    enforceAiRateLimit(key, 1_000, 2, 60_000);
    enforceAiRateLimit(key, 1_001, 2, 60_000);
    expect(() => enforceAiRateLimit(key, 1_002, 2, 60_000)).toThrow(AiRateLimitError);
  });

  it("resets after the window and isolates scopes", () => {
    const key = `user-a:screen:${Math.random()}`;
    enforceAiRateLimit(key, 1_000, 1, 100);
    expect(() => enforceAiRateLimit(key, 1_050, 1, 100)).toThrow();
    expect(() => enforceAiRateLimit(key, 1_100, 1, 100)).not.toThrow();
    expect(() => enforceAiRateLimit(`${key}:other`, 1_050, 1, 100)).not.toThrow();
  });
});
