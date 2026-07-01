// ---------------------------------------------------------------------------
// scoring.rules.ts
// Configurable rules for semantic scoring
// ---------------------------------------------------------------------------

export interface ScoringRules {
  baseThreshold: number;
  markerDensityWeight: number;
  contextRelevanceWeight: number;
  negativePenaltyMultiplier: number;
  proximityWeight: number;
  continuationBonus: number;
}

/**
 * Scoring rules for semantic classification
 */
export const SCORING_RULES: ScoringRules = {
  baseThreshold: 0.5,
  markerDensityWeight: 0.3,
  contextRelevanceWeight: 0.4,
  negativePenaltyMultiplier: 1.5,
  proximityWeight: 0.2,
  continuationBonus: 0.15,
};

/**
 * Get scoring rules (can be customized per deployment)
 */
export function getScoringRules(): ScoringRules {
  return { ...SCORING_RULES };
}
