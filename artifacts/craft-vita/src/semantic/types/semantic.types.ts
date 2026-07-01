// ---------------------------------------------------------------------------
// semantic.types.ts
// Core type definitions for the semantic marker engine
// ---------------------------------------------------------------------------

/**
 * Semantic intent classification for interview transcripts
 */
export type SemanticIntent =
  | "simple_question"
  | "scenario_based"
  | "system_design"
  | "behavioral_star"
  | "frontend"
  | "backend"
  | "database"
  | "scaling"
  | "debugging"
  | "deployment"
  | "ai_architecture"
  | "continuation"
  | "noise"
  | "filler"
  | "independent_questions";

/**
 * Transcript complexity levels for dynamic context window sizing
 */
export type TranscriptComplexity =
  | "minimal"
  | "standard"
  | "extended"
  | "scenario"
  | "architecture";

/**
 * Classification result with confidence and segmentation
 */
export interface SemanticClassification {
  intent: SemanticIntent;
  complexity: TranscriptComplexity;
  shouldGroup: boolean;
  segments: string[];
  confidence: number; // 0-1
  markers: string[]; // matched marker IDs
  reasoning?: string;
}

/**
 * Context window configuration
 */
export interface ContextWindowConfig {
  messageCount: number;
  timeWindowMs: number;
  expandForScenario: boolean;
  preserveNarrativeChains: boolean;
}

/**
 * Continuation detection result
 */
export interface ContinuationResult {
  isContinuation: boolean;
  confidence: number;
  relatedIntent?: SemanticIntent;
  contextWindow?: ContextWindowConfig;
}

/**
 * Semantic score for weighted marker matching
 */
export interface SemanticScore {
  intent: SemanticIntent;
  score: number; // 0-1
  markerCount: number;
  weightedSum: number;
}
