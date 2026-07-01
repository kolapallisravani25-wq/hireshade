// ---------------------------------------------------------------------------
// grouping.rules.ts
// Configurable rules for transcript grouping
// ---------------------------------------------------------------------------

import type { SemanticIntent } from "../types/semantic.types";

export interface GroupingRules {
  minScore: number;
  continuationWindowMs: number;
  preserveNarrativeChains: boolean;
}

/**
 * Grouping rules by intent
 * Future developers can tune these without touching engine logic
 */
export const GROUPING_RULES: Record<SemanticIntent, GroupingRules> = {
  simple_question: {
    minScore: 0.3,
    continuationWindowMs: 5000,
    preserveNarrativeChains: false,
  },
  scenario_based: {
    minScore: 0.75,
    continuationWindowMs: 12000,
    preserveNarrativeChains: true,
  },
  system_design: {
    minScore: 0.75,
    continuationWindowMs: 15000,
    preserveNarrativeChains: true,
  },
  behavioral_star: {
    minScore: 0.7,
    continuationWindowMs: 10000,
    preserveNarrativeChains: true,
  },
  frontend: {
    minScore: 0.5,
    continuationWindowMs: 5000,
    preserveNarrativeChains: false,
  },
  backend: {
    minScore: 0.5,
    continuationWindowMs: 5000,
    preserveNarrativeChains: false,
  },
  database: {
    minScore: 0.5,
    continuationWindowMs: 5000,
    preserveNarrativeChains: false,
  },
  scaling: {
    minScore: 0.6,
    continuationWindowMs: 8000,
    preserveNarrativeChains: false,
  },
  debugging: {
    minScore: 0.6,
    continuationWindowMs: 8000,
    preserveNarrativeChains: false,
  },
  deployment: {
    minScore: 0.6,
    continuationWindowMs: 8000,
    preserveNarrativeChains: false,
  },
  ai_architecture: {
    minScore: 0.6,
    continuationWindowMs: 8000,
    preserveNarrativeChains: false,
  },
  continuation: {
    minScore: 0.5,
    continuationWindowMs: 10000,
    preserveNarrativeChains: true,
  },
  noise: {
    minScore: 0.9,
    continuationWindowMs: 0,
    preserveNarrativeChains: false,
  },
  filler: {
    minScore: 0.8,
    continuationWindowMs: 0,
    preserveNarrativeChains: false,
  },
  independent_questions: {
    minScore: 0.5,
    continuationWindowMs: 5000,
    preserveNarrativeChains: false,
  },
};

/**
 * Get grouping rules for a specific intent
 */
export function getGroupingRules(intent: SemanticIntent): GroupingRules {
  return GROUPING_RULES[intent] || GROUPING_RULES.simple_question;
}
