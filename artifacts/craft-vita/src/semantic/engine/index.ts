// ---------------------------------------------------------------------------
// index.ts
// Semantic engine exports
// ---------------------------------------------------------------------------

export { matchSemanticMarkers, getMatchedCategories } from "./marker-matcher";
export { computeSemanticScores, getTopIntent } from "./semantic-score";
export { classifyTranscriptSemantic } from "./transcript-classifier";
export { buildDynamicTranscriptWindow, extractContextFromMessages } from "./context-window-builder";
export { detectContinuationChains } from "./continuation-detector";
export { semanticEngine, quickClassify, isScenarioBased } from "./semantic-engine";

export type { SemanticEngineResult } from "./semantic-engine";
