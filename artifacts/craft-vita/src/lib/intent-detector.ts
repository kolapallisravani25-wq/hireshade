/**
 * Intent Detection / Question Extraction Layer
 *
 * This module processes raw speech-to-text transcripts and extracts clean,
 * interpretable questions for AI processing and UI display.
 *
 * Architecture:
 * Raw Transcript → Intent Detection → Cleaned Question → AI Processing + UI
 */

/**
 * Speech recognition artifacts to filter out
 */
const FILLER_WORDS = new Set([
  "uh",
  "um",
  "ah",
  "er",
  "like",
  "you know",
  "kind of",
  "sort of",
  "basically",
  "actually",
  "literally",
  "just",
  "so",
  "well",
  "hmm",
  "let me see",
  "let's see",
  "i mean",
  "right",
  "okay",
  "alright",
  "yeah",
  "yep",
  "yup",
  "sure",
  "got it",
  "mhmm",
  "mhm",
  "mm-hmm",
  "mmhmm",
  "uh-huh",
  "uhhuh",
  "mm",
  "mhm",
]);

/**
 * Question opening phrases that indicate a question is starting
 */
const QUESTION_OPENERS = [
  "can you",
  "could you",
  "would you",
  "will you",
  "tell me",
  "explain",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "which",
  "describe",
  "what's",
  "how's",
  "why's",
  "can we",
  "could we",
  "would we",
];

/**
 * Cleans up speech recognition artifacts from transcript
 */
function removeFillerWords(text: string): string {
  const words = text.split(/\s+/);
  const cleaned = words.filter(word => {
    const lower = word.toLowerCase().replace(/[^a-z]/g, "");
    return !FILLER_WORDS.has(lower) && lower.length > 0;
  });
  return cleaned.join(" ");
}

/**
 * Detects if the transcript contains a question
 */
function isQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  
  // Check for question marks
  if (lower.includes("?")) return true;
  
  // Check for question openers
  for (const opener of QUESTION_OPENERS) {
    if (lower.startsWith(opener) || lower.includes(opener)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Extracts the core question from noisy transcript
 * Handles cases like:
 * - "uh can you tell me what is react" → "What is React?"
 * - "um like explain the difference between x and y" → "Explain the difference between X and Y"
 */
function extractCoreQuestion(text: string): string {
  let cleaned = text.trim();
  
  // Remove filler words first
  cleaned = removeFillerWords(cleaned);
  
  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  
  // Remove trailing punctuation if not a question mark
  if (!cleaned.endsWith("?")) {
    cleaned = cleaned.replace(/[.,!]$/, "");
  }
  
  // Add question mark if it's a question but doesn't have one
  if (isQuestion(cleaned) && !cleaned.endsWith("?")) {
    cleaned += "?";
  }
  
  // Fix common speech recognition errors
  cleaned = cleaned
    .replace(/\s+/g, " ")  // Normalize whitespace
    .replace(/\s+([.,!?])/g, "$1")  // Remove space before punctuation
    .replace(/([.,!?])\s*([.,!?])/g, "$1 $2")  // Add space between consecutive punctuation
    .trim();
  
  return cleaned;
}

/**
 * Main intent detection function
 * Takes raw transcript and returns cleaned question
 */
export interface IntentDetectionResult {
  cleanedQuestion: string;
  originalTranscript: string;
  isQuestion: boolean;
  confidence: number;
}

export function detectIntent(transcript: string): IntentDetectionResult {
  const original = transcript.trim();
  
  if (!original) {
    return {
      cleanedQuestion: "",
      originalTranscript: "",
      isQuestion: false,
      confidence: 0,
    };
  }
  
  const cleaned = extractCoreQuestion(original);
  const questionDetected = isQuestion(cleaned);
  
  // Simple confidence scoring based on length and question indicators
  let confidence = 0.5;
  if (questionDetected) confidence += 0.3;
  if (cleaned.length > 10) confidence += 0.1;
  if (cleaned.length > 20) confidence += 0.1;
  if (cleaned.includes("?")) confidence += 0.2;
  
  confidence = Math.min(confidence, 1.0);
  
  return {
    cleanedQuestion: cleaned,
    originalTranscript: original,
    isQuestion: questionDetected,
    confidence,
  };
}

/**
 * Checks if text is primarily filler/noise
 * Returns true if the text consists mostly of filler words
 */
export function isFillerPhrase(text: string): boolean {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return true;
  
  const words = cleaned.split(/\s+/);
  const fillerCount = words.filter(word => {
    const normalized = word.replace(/[^a-z]/g, "");
    return FILLER_WORDS.has(normalized);
  }).length;
  
  // If 80% or more of words are filler, consider it a filler phrase
  const fillerRatio = fillerCount / words.length;
  return fillerRatio >= 0.8;
}

/**
 * Batch process multiple transcript segments
 */
export function detectIntentBatch(transcripts: string[]): IntentDetectionResult[] {
  return transcripts.map(detectIntent);
}
