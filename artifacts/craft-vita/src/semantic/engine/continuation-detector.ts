// ---------------------------------------------------------------------------
// continuation-detector.ts
// Continuation chain detection
// ---------------------------------------------------------------------------

import type { ContinuationResult, SemanticIntent } from "../types/semantic.types";
import { matchSemanticMarkers } from "./marker-matcher";
import { CONTINUATION_MARKERS } from "../markers";

/**
 * Detect if transcript is a continuation of previous context
 */
export function detectContinuationChains(
  transcript: string,
  previousContext: string,
  previousIntent?: SemanticIntent,
): ContinuationResult {
  const normalizedTranscript = transcript.toLowerCase().trim();
  const normalizedPrevious = previousContext.toLowerCase().trim();
  
  // Check for continuation markers
  const continuationMatches = matchSemanticMarkers(transcript, CONTINUATION_MARKERS);
  const hasContinuationMarkers = continuationMatches.length > 0;
  
  // Check for pronoun references without clear antecedent
  const pronouns = ["it", "that", "this", "those", "these", "they", "them", "he", "she", "its", "it's"];
  const hasUnresolvedPronouns = pronouns.some(pronoun => {
    const regex = new RegExp(`\\b${pronoun}\\b`, "i");
    return regex.test(normalizedTranscript);
  });
  
  // Calculate continuation score
  let score = 0;
  
  if (hasContinuationMarkers) {
    score += 0.4;
  }
  
  if (hasUnresolvedPronouns) {
    score += 0.3;
  }
  
  // Check for semantic overlap with previous context
  const overlap = calculateSemanticOverlap(normalizedTranscript, normalizedPrevious);
  score += overlap * 0.3;
  
  // Determine if it's a continuation
  const isContinuation = score >= 0.5;
  
  // Determine related intent (use previous intent if available)
  const relatedIntent = isContinuation ? previousIntent : undefined;
  
  return {
    isContinuation,
    confidence: score,
    relatedIntent,
  };
}

/**
 * Calculate semantic overlap between two texts
 */
function calculateSemanticOverlap(text1: string, text2: string): number {
  const words1 = text1.split(/\s+/).filter(w => w.length > 3);
  const words2 = text2.split(/\s+/).filter(w => w.length > 3);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1.map(w => w.toLowerCase()));
  const set2 = new Set(words2.map(w => w.toLowerCase()));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}
