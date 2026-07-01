// ---------------------------------------------------------------------------
// transcript-classifier.ts
// Transcript classification logic using semantic markers
// ---------------------------------------------------------------------------

import type { SemanticClassification } from "../types/semantic.types";
import type { SemanticIntent } from "../types/semantic.types";
import type { TranscriptComplexity } from "../types/semantic.types";
import { matchSemanticMarkers } from "./marker-matcher";
import { computeSemanticScores, getTopIntent } from "./semantic-score";

/**
 * All possible semantic intents
 */
const ALL_INTENTS: SemanticIntent[] = [
  "simple_question",
  "scenario_based",
  "system_design",
  "behavioral_star",
  "frontend",
  "backend",
  "database",
  "scaling",
  "debugging",
  "deployment",
  "ai_architecture",
  "continuation",
  "noise",
  "filler",
  "independent_questions",
];

/**
 * Classify transcript using semantic marker engine
 */
export function classifyTranscriptSemantic(
  transcript: string,
  previousContext?: string,
): SemanticClassification {
  const trimmed = transcript.trim();
  
  if (trimmed.length === 0) {
    return {
      intent: "noise",
      complexity: "minimal",
      shouldGroup: false,
      segments: [],
      confidence: 1.0,
      markers: [],
      reasoning: "Empty transcript",
    };
  }
  
  // Match semantic markers
  const matches = matchSemanticMarkers(trimmed);
  
  // Compute weighted scores
  const scores = computeSemanticScores(matches, ALL_INTENTS);
  
  // Get top intent
  const topIntent = getTopIntent(scores, 0.3); // Lower threshold for more lenient matching
  
  if (!topIntent) {
    // Default to simple question if no clear intent
    return {
      intent: "simple_question",
      complexity: "minimal",
      shouldGroup: false,
      segments: [trimmed],
      confidence: 0.5,
      markers: [],
      reasoning: "No clear semantic intent detected",
    };
  }
  
  // Determine complexity based on intent and transcript length
  const complexity = determineComplexity(topIntent.intent, trimmed);
  
  // Determine if should group based on intent
  const shouldGroup = shouldGroupIntent(topIntent.intent);
  
  // Extract matched marker IDs
  const markerIds = matches.map(m => m.marker.id);
  
  // Determine segmentation
  const segments = shouldGroup ? [trimmed] : splitIntoSegments(trimmed);
  
  return {
    intent: topIntent.intent,
    complexity,
    shouldGroup,
    segments,
    confidence: topIntent.score,
    markers: markerIds,
    reasoning: `Detected ${topIntent.intent} with ${topIntent.markerCount} markers`,
  };
}

/**
 * Determine transcript complexity based on intent and length
 */
function determineComplexity(intent: SemanticIntent, transcript: string): TranscriptComplexity {
  const wordCount = transcript.split(/\s+/).length;
  
  // High complexity intents
  if (intent === "scenario_based" || intent === "system_design") {
    if (wordCount >= 50) return "architecture";
    if (wordCount >= 30) return "scenario";
    return "extended";
  }
  
  // Medium complexity intents
  if (intent === "behavioral_star" || intent === "scaling" || intent === "debugging") {
    if (wordCount >= 30) return "extended";
    return "standard";
  }
  
  // Low complexity intents
  if (intent === "simple_question" || intent === "frontend" || intent === "backend") {
    if (wordCount >= 20) return "standard";
    return "minimal";
  }
  
  // Default
  return "standard";
}

/**
 * Determine if intent should be grouped
 */
function shouldGroupIntent(intent: SemanticIntent): boolean {
  const groupingIntents: SemanticIntent[] = [
    "scenario_based",
    "system_design",
    "behavioral_star",
    "continuation",
  ];
  
  return groupingIntents.includes(intent);
}

/**
 * Split transcript into segments (for independent questions)
 */
function splitIntoSegments(transcript: string): string[] {
  // Simple split by question marks
  const segments = transcript.split(/(?<=[?!.])/).filter(s => s.trim().length > 0);
  
  return segments.length > 1 ? segments : [transcript];
}
