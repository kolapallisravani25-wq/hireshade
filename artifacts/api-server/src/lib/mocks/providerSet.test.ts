import { afterEach, describe, expect, it } from "vitest";
import { createProviderSet } from "./providerSet.js";
import { DemoModeError } from "./demoMode.js";

const PROVIDER_KEYS = ["OPENROUTER_API_KEY", "DEEPGRAM_API_KEY", "CLERK_SECRET_KEY"] as const;
const saved = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of PROVIDER_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const noopSleep = async () => {};

describe("createProviderSet", () => {
  it("constructs the all-mock set with zero provider keys in demo mode", async () => {
    for (const key of PROVIDER_KEYS) delete process.env[key];
    const set = createProviderSet({
      env: { DEMO_MODE: "1", NODE_ENV: "development" },
      mockLlm: { sleep: noopSleep, answer: "keyless answer", firstTokenDelayMs: 0 },
    });
    expect(set.mode).toBe("mock");
    expect(set.demoUser).toBe(true);
    expect(set.describe()).toMatchObject({
      mode: "mock",
      keysRequired: false,
      llm: { id: "mock-llm", configured: true },
      asr: { id: "mock-asr", configured: true },
      tts: { id: "mock-tts", configured: true },
    });
    const text = await set.llm.stream({ messages: [] }, () => {});
    expect(text).toBe("keyless answer");
    expect(set.asr.isConfigured()).toBe(true);
  });

  it("uses real adapters (fail closed, no mock fallback) outside demo mode", () => {
    for (const key of PROVIDER_KEYS) delete process.env[key];
    const set = createProviderSet({ env: { NODE_ENV: "development" } });
    expect(set.mode).toBe("real");
    expect(set.demoUser).toBe(false);
    expect(set.llm.kind).toBe("openrouter");
    expect(set.llm.isConfigured()).toBe(false);
    expect(set.asr.kind).toBe("deepgram");
    expect(set.asr.isConfigured()).toBe(false);
    expect(set.describe().keysRequired).toBe(true);
  });

  it("fails closed when demo mode is requested in production", () => {
    expect(() =>
      createProviderSet({ env: { DEMO_MODE: "1", NODE_ENV: "production", OPENROUTER_API_KEY: "x" } }),
    ).toThrow(DemoModeError);
  });
});
