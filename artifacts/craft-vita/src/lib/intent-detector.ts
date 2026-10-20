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
 * Words that, as the FIRST meaningful word of an utterance, make it a
 * question/imperative-question. Start-anchored on purpose: matching these as
 * substrings anywhere turned ordinary candidate statements into "questions"
 * (e.g. "My code ... which causes re-renders", "I know how React handles
 * state", "I explained how the cache worked").
 */
const QUESTION_START_WORDS = new Set([
  // wh- words (apostrophe forms are letter-normalised before lookup)
  "what",
  "whats",
  "how",
  "hows",
  "why",
  "whys",
  "when",
  "where",
  "who",
  "which",
  "whose",
  // auxiliaries
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "may",
  "might",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "am",
  // interview imperatives that are questions in disguise
  "tell",
  "walk",
  "talk",
  "explain",
  "describe",
  "give",
  "share",
  "show",
  "define",
  "compare",
  "contrast",
  "discuss",
  "design",
  "implement",
  "write",
  "build",
  "find",
  "calculate",
  "propose",
  "outline",
  "summarize",
  "list",
  "name",
  "suppose",
  "imagine",
  "continue",
  "elaborate",
  "clarify",
  "expand",
]);

/**
 * Multi-word question openers that may legitimately appear EMBEDDED in a
 * merged STT snapshot ("so, can you explain ..."). Matched on word boundaries
 * so "explained"/"whoever" style false positives never fire.
 */
const EMBEDDED_QUESTION_OPENERS = [
  "can you",
  "could you",
  "would you",
  "will you",
  "can we",
  "could we",
  "would we",
  "tell me",
  "walk me through",
  "talk me through",
  "give me",
  "show me",
  "what about",
  "how about",
  "do you",
  "did you",
  "have you",
  "are you",
  "is there",
  "are there",
  "does it",
  "do we",
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

/** Word-boundary phrase test (regex-safe). */
function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/**
 * Detects if the transcript contains a question.
 *
 * Precision-oriented rewrite (G-016): a literal "?" always counts, otherwise
 * the utterance must START with a question/imperative word, or contain an
 * unambiguous multi-word question opener. Single wh-words buried inside a
 * statement ("I know how React handles state") no longer count.
 */
function isQuestion(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;

  // Check for question marks
  if (lower.includes("?")) return true;

  // First meaningful word (letters only, so "what's" → "whats").
  const firstWord = lower.split(/\s+/)[0].replace(/[^a-z]/g, "");
  if (QUESTION_START_WORDS.has(firstWord)) return true;

  // Unambiguous embedded openers (merged snapshots).
  return EMBEDDED_QUESTION_OPENERS.some((opener) => containsPhrase(lower, opener));
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
