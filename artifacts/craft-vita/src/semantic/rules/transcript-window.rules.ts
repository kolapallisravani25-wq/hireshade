// ---------------------------------------------------------------------------
// transcript-window.rules.ts
// Configurable rules for transcript context window sizing
// ---------------------------------------------------------------------------

import type { TranscriptComplexity } from "../types/semantic.types";

export interface TranscriptWindowRules {
  messageCount: number;
  timeWindowMs: number;
  expandForScenario: boolean;
  preserveNarrativeChains: boolean;
  maxContextLength: number;
}

/**
 * Transcript window rules by complexity level
 */
export const TRANSCRIPT_WINDOW_RULES: Record<TranscriptComplexity, TranscriptWindowRules> = {
  minimal: {
    messageCount: 5,
    timeWindowMs: 5000,
    expandForScenario: false,
    preserveNarrativeChains: false,
    maxContextLength: 200,
  },
  standard: {
    messageCount: 12,
    timeWindowMs: 10000,
    expandForScenario: false,
    preserveNarrativeChains: false,
    maxContextLength: 500,
  },
  extended: {
    messageCount: 20,
    timeWindowMs: 30000,
    expandForScenario: true,
    preserveNarrativeChains: true,
    maxContextLength: 1000,
  },
  scenario: {
    messageCount: 30,
    timeWindowMs: 60000,
    expandForScenario: true,
    preserveNarrativeChains: true,
    maxContextLength: 2000,
  },
  architecture: {
    messageCount: 40,
    timeWindowMs: 120000,
    expandForScenario: true,
    preserveNarrativeChains: true,
    maxContextLength: 3000,
  },
};

/**
 * Get transcript window rules for a specific complexity level
 */
export function getTranscriptWindowRules(complexity: TranscriptComplexity): TranscriptWindowRules {
  return TRANSCRIPT_WINDOW_RULES[complexity] || TRANSCRIPT_WINDOW_RULES.standard;
}
