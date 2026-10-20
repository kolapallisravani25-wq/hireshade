/**
 * Provider-set factory (G-001 / G-017).
 *
 * resolveProviderMode() decides mock vs real exactly once:
 *   - DEMO_MODE=1 outside production  -> all-mock set, never reads a key;
 *   - otherwise                       -> real OpenRouter/Deepgram adapters with
 *                                        their existing fail-closed behaviour.
 */
import { createMockLlmProvider, type MockLlmProviderOptions } from "./mockLlm.js";
import { createMockAsrProvider, type MockAsrProviderOptions } from "./mockAsr.js";
import { createMockTtsProvider, type MockTtsProviderOptions } from "./mockTts.js";
import { createOpenRouterLlmProvider } from "./llmOpenRouter.js";
import { createDeepgramAsrProvider } from "./asrDeepgram.js";
import { resolveProviderMode } from "./demoMode.js";
import type { AsrProvider, LlmProvider, TtsProvider } from "./types.js";

export interface ProviderSet {
  mode: "mock" | "real";
  llm: LlmProvider;
  asr: AsrProvider;
  tts: TtsProvider;
  /** Present only in mock mode; used by demo routes. */
  demoUser: boolean;
  describe(): ProviderSetDescription;
}

export interface ProviderSetDescription {
  mode: "mock" | "real";
  llm: { id: string; kind: string; configured: boolean };
  asr: { id: string; kind: string; configured: boolean };
  tts: { id: string; kind: string; configured: boolean };
  keysRequired: boolean;
}

export interface CreateProviderSetOptions {
  env?: NodeJS.ProcessEnv;
  clock?: () => number;
  mockLlm?: MockLlmProviderOptions;
  mockAsr?: MockAsrProviderOptions;
  mockTts?: MockTtsProviderOptions;
}

function describe(set: Omit<ProviderSet, "describe">): ProviderSetDescription {
  return {
    mode: set.mode,
    llm: { id: set.llm.id, kind: set.llm.kind, configured: set.llm.isConfigured() },
    asr: { id: set.asr.id, kind: set.asr.kind, configured: set.asr.isConfigured() },
    tts: { id: set.tts.id, kind: set.tts.kind, configured: set.tts.isConfigured() },
    keysRequired: set.mode === "real",
  };
}

export function createProviderSet(opts: CreateProviderSetOptions = {}): ProviderSet {
  const env = opts.env ?? process.env;
  const mode = resolveProviderMode(env);

  if (mode === "mock") {
    const llm = createMockLlmProvider({ clock: opts.clock, ...opts.mockLlm });
    const asr = createMockAsrProvider({ clock: opts.clock, ...opts.mockAsr });
    const tts = createMockTtsProvider(opts.mockTts);
    const set = { mode, llm, asr, tts, demoUser: true } as Omit<ProviderSet, "describe">;
    return { ...set, describe: () => describe(set) };
  }

  // Real mode must never silently use the mock LLM: construct the OpenRouter
  // adapter, which reports unconfigured (and streams throw) without a key.
  const realLlm = createOpenRouterLlmProvider();
  const asr = createDeepgramAsrProvider();
  const tts = createMockTtsProvider(opts.mockTts);
  const set = { mode, llm: realLlm, asr, tts, demoUser: false } as Omit<ProviderSet, "describe">;
  return { ...set, describe: () => describe(set) };
}
