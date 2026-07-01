// ---------------------------------------------------------------------------
// index.ts
// Central marker registry for the semantic engine
// ---------------------------------------------------------------------------

import { SCENARIO_MARKERS } from "./scenario.markers";
import { SYSTEM_DESIGN_MARKERS } from "./system-design.markers";
import { BEHAVIORAL_MARKERS } from "./behavioral.markers";
import { FRONTEND_MARKERS } from "./frontend.markers";
import { BACKEND_MARKERS } from "./backend.markers";
import { DATABASE_MARKERS } from "./database.markers";
import { SCALING_MARKERS } from "./scaling.markers";
import { DEBUGGING_MARKERS } from "./debugging.markers";
import { DEPLOYMENT_MARKERS } from "./deployment.markers";
import { AI_MARKERS } from "./ai.markers";
import { CONTINUATION_MARKERS } from "./continuation.markers";
import { FILLER_MARKERS } from "./filler.markers";
import { NOISE_MARKERS } from "./noise.markers";
import type { SemanticMarker } from "../types/marker.types";

// Export individual marker collections for direct access
export { SCENARIO_MARKERS } from "./scenario.markers";
export { SYSTEM_DESIGN_MARKERS } from "./system-design.markers";
export { BEHAVIORAL_MARKERS } from "./behavioral.markers";
export { FRONTEND_MARKERS } from "./frontend.markers";
export { BACKEND_MARKERS } from "./backend.markers";
export { DATABASE_MARKERS } from "./database.markers";
export { SCALING_MARKERS } from "./scaling.markers";
export { DEBUGGING_MARKERS } from "./debugging.markers";
export { DEPLOYMENT_MARKERS } from "./deployment.markers";
export { AI_MARKERS } from "./ai.markers";
export { CONTINUATION_MARKERS } from "./continuation.markers";
export { FILLER_MARKERS } from "./filler.markers";
export { NOISE_MARKERS } from "./noise.markers";

/**
 * Central registry of all semantic markers
 * Future developers can easily add new marker files here
 */
export const ALL_MARKERS: SemanticMarker[] = [
  ...SCENARIO_MARKERS,
  ...SYSTEM_DESIGN_MARKERS,
  ...BEHAVIORAL_MARKERS,
  ...FRONTEND_MARKERS,
  ...BACKEND_MARKERS,
  ...DATABASE_MARKERS,
  ...SCALING_MARKERS,
  ...DEBUGGING_MARKERS,
  ...DEPLOYMENT_MARKERS,
  ...AI_MARKERS,
  ...CONTINUATION_MARKERS,
  ...FILLER_MARKERS,
  ...NOISE_MARKERS,
];

/**
 * Get markers by category
 */
export function getMarkersByCategory(category: string): SemanticMarker[] {
  return ALL_MARKERS.filter(m => m.category === category);
}

/**
 * Get markers by type
 */
export function getMarkersByType(type: string): SemanticMarker[] {
  return ALL_MARKERS.filter(m => m.type === type);
}
