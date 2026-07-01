// ---------------------------------------------------------------------------
// marker-matcher.ts
// Weighted marker matching engine
// ---------------------------------------------------------------------------

import type { SemanticMarker, MarkerMatch } from "../types/marker.types";
import { ALL_MARKERS } from "../markers";

/**
 * Normalize text for matching (lowercase, collapse whitespace)
 */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Match semantic markers against transcript
 * Returns weighted matches with positions and scores
 */
export function matchSemanticMarkers(
  transcript: string,
  markers: SemanticMarker[] = ALL_MARKERS,
): MarkerMatch[] {
  const normalized = normalizeText(transcript);
  const matches: MarkerMatch[] = [];

  for (const marker of markers) {
    if (marker.type === "phrase" && marker.phrase) {
      const phrase = normalizeText(marker.phrase);
      let position = 0;
      
      // Find all occurrences of the phrase
      while (true) {
        const index = normalized.indexOf(phrase, position);
        if (index === -1) break;
        
        matches.push({
          marker,
          position: index,
          length: phrase.length,
          score: marker.weight,
        });
        
        position = index + phrase.length;
      }
    } else if (marker.type === "regex" && marker.regex) {
      const regex = typeof marker.regex === "string" 
        ? new RegExp(marker.regex, "gi") 
        : new RegExp(marker.regex.source, marker.regex.flags || "gi");
      
      let match;
      while ((match = regex.exec(normalized)) !== null) {
        matches.push({
          marker,
          position: match.index,
          length: match[0].length,
          score: marker.weight,
        });
      }
    }
  }

  return matches;
}

/**
 * Get unique marker categories found in transcript
 */
export function getMatchedCategories(transcript: string): Set<string> {
  const matches = matchSemanticMarkers(transcript);
  const categories = new Set<string>();
  
  for (const match of matches) {
    categories.add(match.marker.category);
  }
  
  return categories;
}
