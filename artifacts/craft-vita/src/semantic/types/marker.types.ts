// ---------------------------------------------------------------------------
// marker.types.ts
// Marker definition types for extensible semantic detection
// ---------------------------------------------------------------------------

import type { SemanticIntent } from "./semantic.types";

/**
 * Marker type for different matching strategies
 */
export type MarkerType = "phrase" | "regex" | "semantic_group" | "negative";

/**
 * Marker definition with weighted scoring
 */
export interface SemanticMarker {
  id: string;
  phrase?: string;
  regex?: string | RegExp;
  type: MarkerType;
  weight: number; // 0-1 confidence contribution
  category: SemanticIntent;
  context?: string; // optional contextual dependency
  negative?: boolean; // if true, reduces confidence when matched
}

/**
 * Marker collection for a domain
 */
export interface MarkerCollection {
  domain: string;
  markers: SemanticMarker[];
}

/**
 * Marker match result with position and score
 */
export interface MarkerMatch {
  marker: SemanticMarker;
  position: number;
  length: number;
  score: number;
}
