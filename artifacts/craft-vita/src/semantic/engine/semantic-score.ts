// ---------------------------------------------------------------------------
// semantic-score.ts
// Weighted semantic scoring engine
// ---------------------------------------------------------------------------

import type { SemanticMarker, MarkerMatch } from "../types/marker.types";
import type { SemanticScore } from "../types/semantic.types";

/**
 * Compute weighted semantic scores for each intent
 */
export function computeSemanticScores(
  matches: MarkerMatch[],
  allIntents: string[],
): SemanticScore[] {
  const scores = new Map<string, { sum: number; count: number; weightedSum: number }>();
  
  // Initialize scores for all intents
  for (const intent of allIntents) {
    scores.set(intent, { sum: 0, count: 0, weightedSum: 0 });
  }
  
  // Aggregate scores by intent
  for (const match of matches) {
    const intent = match.marker.category;
    const current = scores.get(intent) || { sum: 0, count: 0, weightedSum: 0 };
    
    if (match.marker.negative) {
      // Negative markers reduce confidence
      current.sum -= match.score;
      current.weightedSum -= match.score * match.marker.weight;
    } else {
      current.sum += match.score;
      current.weightedSum += match.score * match.marker.weight;
    }
    current.count++;
    
    scores.set(intent, current);
  }
  
  // Convert to SemanticScore array and normalize
  const results: SemanticScore[] = [];
  for (const [intent, data] of scores.entries()) {
    // Normalize score to 0-1 range
    const normalizedScore = Math.max(0, Math.min(1, data.weightedSum / 5)); // Normalize against max expected score
    
    results.push({
      intent: intent as any,
      score: normalizedScore,
      markerCount: data.count,
      weightedSum: data.weightedSum,
    });
  }
  
  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Get top intent with confidence threshold
 */
export function getTopIntent(
  scores: SemanticScore[],
  threshold: number = 0.5,
): SemanticScore | null {
  if (scores.length === 0) return null;
  
  const top = scores[0];
  return top.score >= threshold ? top : null;
}
