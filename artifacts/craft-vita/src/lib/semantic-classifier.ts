// ---------------------------------------------------------------------------
// semantic-classifier.ts
// Lightweight heuristic-based classification engine for interview transcripts.
// NO LLM calls, NO external API costs — pure local analysis.
// ---------------------------------------------------------------------------

export type QuestionType =
  | 'scenario'
  | 'independent'
  | 'behavioral_star'
  | 'system_design'
  | 'follow_up'
  | 'continuation'
  | 'noise';

export type TranscriptComplexity =
  | 'simple_question'
  | 'independent_questions'
  | 'scenario_based'
  | 'system_design'
  | 'behavioral_star'
  | 'followup_continuation';

export interface ClassificationResult {
  type: QuestionType;
  shouldGroup: boolean;
  /** If independent: split segments. If grouped: single-element array with full transcript. */
  segments: string[];
  /** 0–1 confidence score */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Marker sets
// ---------------------------------------------------------------------------

const SCENARIO_MARKERS: readonly string[] = [
  'suppose',
  'imagine',
  'design a',
  'build a',
  'what would you do if',
  "let's say",
  'consider a scenario',
  'how would you approach',
  'walk me through',
  'if you were to build',
  'if you had to design',
  'picture this',
  'envision a',
  'say you have',
  'say you are',
  'pretend you',
  "let's assume",
  'given a scenario',
  'in a situation where',
  'you are tasked with',
  // Narrative setup markers
  'your team has',
  'your team',
  'a user clicks',
  'a user',
  'another user',
  'at the same time',
  'simultaneously',
  'concurrently',
  'writes overwrite',
  'data integrity',
  'high traffic',
  'collaborative',
  'dashboard',
  'deployed',
  'race condition',
  'concurrency conflict',
  'without locking',
];

const SYSTEM_DESIGN_KEYWORDS: readonly string[] = [
  'scale',
  'architecture',
  'database',
  'cache',
  'load balancer',
  'microservices',
  'distributed',
  'high availability',
  'latency',
  'throughput',
  'sharding',
  'replication',
  'cdn',
  'message queue',
  'consistency',
  'partitioning',
  'fault tolerance',
  'horizontal scaling',
  'vertical scaling',
  'rate limiting',
  'circuit breaker',
  'service mesh',
  'api gateway',
  'event driven',
  'event sourcing',
  'cap theorem',
  'eventual consistency',
  'concurrency',
  'bottleneck',
  'capacity',
  'deploy',
  'infrastructure',
  'redundancy',
];

const STAR_BEHAVIORAL_MARKERS: readonly string[] = [
  'tell me about a time',
  'describe a situation where',
  'give me an example of',
  'have you ever',
  'walk me through a challenge',
  'share an experience',
  'tell me about a challenge',
  'describe a time when',
  'can you give an example',
  'tell me about a situation',
  'recall a time',
  'think of a time',
  'walk me through a time',
  'share a time when',
  'describe an instance',
  'give an example of when',
  'tell me about when you',
  'what was the most',
  'what was the biggest',
  'have you had to',
  'when was the last time',
  'tell me about your experience',
];

const FOLLOW_UP_MARKERS: readonly string[] = [
  'and how would you',
  'what about',
  'also',
  'then how',
  'can you elaborate',
  'what if',
  'and then',
  'how about',
  'could you explain more',
  'go on',
  'continue',
  'and why',
  'but what if',
  'follow up',
  'still on that',
  'building on that',
  'going back to',
  'digging deeper',
  'on that note',
  'and what would',
  'moving on from that',
  'following up on',
  'to expand on that',
  'more specifically',
];

const NOISE_WORDS: readonly string[] = [
  'um',
  'uh',
  'okay',
  'sure',
  'yeah',
  'hmm',
  'mm',
  'ah',
  'oh',
  'right',
  'like',
  'you know',
  'so',
  'well',
  'huh',
  'mhm',
  'hm',
  'aha',
];

const PRONOUNS_WITHOUT_ANTECEDENT: readonly string[] = [
  'it',
  'that',
  'this',
  'those',
  'these',
  'they',
  'them',
  'he',
  'she',
  'its',
  "it's",
];

const CONTINUATION_STARTERS: readonly string[] = [
  'and',
  'also',
  'what about',
  'how about',
  'then',
  'but',
  'so',
  'plus',
  'additionally',
  'furthermore',
  'moreover',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Lower-case, collapse whitespace, trim. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Tokenize into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Extract meaningful nouns/subject words (heuristic: length >= 4, not a stop word). */
const STOP_WORDS = new Set([
  'that', 'this', 'these', 'those', 'with', 'from', 'have', 'been',
  'will', 'would', 'could', 'should', 'about', 'into', 'over',
  'after', 'under', 'between', 'through', 'during', 'before',
  'just', 'than', 'then', 'also', 'some', 'very', 'when',
  'what', 'where', 'which', 'while', 'does', 'your', 'their',
  'there', 'here', 'like', 'know', 'think', 'going', 'being',
  'doing', 'having', 'were', 'they', 'them', 'each', 'every',
  'both', 'other', 'such', 'only', 'same', 'more', 'most',
  'much', 'many', 'well', 'back', 'still', 'even', 'because',
  'since', 'without', 'within', 'along', 'upon', 'whether',
  'though', 'although', 'unless', 'until', 'among', 'against',
]);

function extractSubjectNouns(text: string): Set<string> {
  const tokens = tokenize(text);
  return new Set(
    tokens.filter((t) => t.length >= 4 && !STOP_WORDS.has(t)),
  );
}

/** Jaccard-like token overlap between two sets. */
function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  Array.from(a).forEach((item) => {
    if (b.has(item)) intersection++;
  });
  const unionSize = a.size + b.size - intersection;
  return unionSize === 0 ? 0 : intersection / unionSize;
}

/** Check if any marker phrase appears in the normalized text. */
function containsMarker(text: string, markers: readonly string[]): string | null {
  const norm = normalize(text);
  for (const marker of markers) {
    if (norm.includes(marker)) return marker;
  }
  return null;
}

/** Count how many distinct markers from the list appear in the text. */
function countMarkers(text: string, markers: readonly string[]): number {
  const norm = normalize(text);
  let count = 0;
  for (const marker of markers) {
    if (norm.includes(marker)) count++;
  }
  return count;
}

/** Check if text starts with any of the given markers. */
function startsWithMarker(text: string, markers: readonly string[]): boolean {
  const norm = normalize(text);
  return markers.some((m) => norm.startsWith(m));
}

export function stripLeadingConjunctionsAndFillers(text: string): string {
  let cleaned = text.trim();
  const regex = /^(?:and|or|then|also|but|so|now|plus|because|okay|ok|great|right|perfect|well|yes|no|wait|hey|hi|hello)\b\s*,?\s*/i;
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(regex, "");
  } while (cleaned !== previous);
  return cleaned;
}

/** Check if text is noise (very short, STT artifacts, non-question fragments). */
function isNoise(text: string): boolean {
  const norm = normalize(text);
  const words = norm.split(/\s+/).filter((w) => w.length > 0);

  // Very short fragments (< 5 meaningful words)
  if (words.length < 5) {
    // Check if it's mostly noise words
    const noiseCount = words.filter((w) => NOISE_WORDS.includes(w)).length;
    if (noiseCount / Math.max(words.length, 1) >= 0.6) return true;
    // Short + no question mark + no question word = likely noise
    if (!norm.includes('?')) {
      const stripped = stripLeadingConjunctionsAndFillers(norm);
      const questionStarters = ['who', 'what', 'when', 'where', 'why', 'how'];
      if (!questionStarters.some((q) => stripped.startsWith(q))) return true;
    }
  }

  // Check for repeated STT artifacts (same word repeated 3+ times consecutively)
  const tokenList = tokenize(text);
  for (let i = 0; i < tokenList.length - 2; i++) {
    if (tokenList[i] === tokenList[i + 1] && tokenList[i] === tokenList[i + 2]) {
      return true;
    }
  }

  // Almost entirely noise words regardless of length
  const meaningfulWords = words.filter((w) => !NOISE_WORDS.includes(w));
  if (meaningfulWords.length <= 1 && words.length <= 3) return true;

  return false;
}

/** Detect if transcript contains pronouns without clear antecedent within the text itself. */
function hasUnresolvedPronouns(text: string): boolean {
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;

  // Check if the first meaningful token is a pronoun (no antecedent possible)
  const firstThree = tokens.slice(0, Math.min(3, tokens.length));
  return firstThree.some((t) => PRONOUNS_WITHOUT_ANTECEDENT.includes(t));
}

/** Check if there's a scenario-like preamble before system design keywords. */
function hasScenarioPreamble(text: string): boolean {
  return containsMarker(text, SCENARIO_MARKERS) !== null;
}

/** Count the number of distinct question marks (rough proxy for sub-questions). */
function countQuestionMarks(text: string): number {
  return (text.match(/\?/g) || []).length;
}

// ---------------------------------------------------------------------------
// Splitting logic for independent questions
// ---------------------------------------------------------------------------

/**
 * Split independent questions into segments.
 * DO NOT split on `?` alone — only split when semantic independence is confirmed.
 */
function splitIndependentQuestions(transcript: string): string[] {
  // Strategy 1: Newline-anchored numbered lists (1. Q1\n2. Q2)
  const numberedPattern = /(?:^|\n)\s*\d+[.)]\s+/;
  if (numberedPattern.test(transcript)) {
    const segments = transcript
      .split(/(?:\n|^)\s*\d+[.)]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length > 1 && areSegmentsSemanticallyIndependent(segments)) {
      return segments;
    }
  }

  // Strategy 2: Try splitting on question-mark boundaries, then verify independence
  const questionSegments = splitOnQuestionBoundaries(transcript);
  if (questionSegments.length > 1 && areSegmentsSemanticallyIndependent(questionSegments)) {
    return questionSegments;
  }

  // Cannot confirm independence — keep as one segment
  return [transcript.trim()];
}

/**
 * Split on '?' boundaries, but only when followed by a new subject/question start.
 */
function splitOnQuestionBoundaries(transcript: string): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;

  while (i < transcript.length) {
    current += transcript[i];
    if (transcript[i] === '?') {
      // Look ahead: is there a clear new question starting?
      const rest = transcript.slice(i + 1).trim();
      if (rest.length > 0 && isNewQuestionStart(rest)) {
        segments.push(current.trim());
        current = '';
      }
    }
    i++;
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }

  return segments.length > 1 ? segments : [transcript.trim()];
}

/** Check if text starts a new question (question word, imperative, or numbered). */
function isNewQuestionStart(text: string): boolean {
  const norm = normalize(text);
  const questionStarters = [
    'what', 'who', 'when', 'where', 'why', 'how',
    'explain', 'describe', 'define', 'compare', 'contrast',
    'tell', 'give', 'show', 'list', 'name',
    'can you', 'could you', 'would you', 'do you',
    'is there', 'are there', 'does',
  ];
  const stripped = stripLeadingConjunctionsAndFillers(norm);
  return questionStarters.some((s) => stripped.startsWith(s)) || /^\d+[.)]\s/.test(norm);
}

/**
 * Verify that segments are truly semantically independent (no shared context).
 * Uses subject-noun overlap as the independence signal.
 */
function areSegmentsSemanticallyIndependent(segments: string[]): boolean {
  if (segments.length < 2) return false;

  const nounSets = segments.map((s) => extractSubjectNouns(s));
  let independentPairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < nounSets.length; i++) {
    for (let j = i + 1; j < nounSets.length; j++) {
      totalPairs++;
      const overlap = tokenOverlap(nounSets[i], nounSets[j]);
      // Low overlap = independent
      if (overlap < 0.15) independentPairs++;
    }
  }

  // At least 60% of pairs must be independent
  return totalPairs > 0 && independentPairs / totalPairs >= 0.6;
}

// ---------------------------------------------------------------------------
// Scenario-based question detection
// ---------------------------------------------------------------------------

/**
 * Detect if a transcript is a scenario-based question that requires
 * preserving full context (narrative, architecture, constraints, causal chain).
 */
export function isScenarioBasedQuestion(transcript: string): boolean {
  const trimmed = transcript.trim();
  const norm = normalize(trimmed);

  // Check for scenario markers
  if (containsMarker(trimmed, SCENARIO_MARKERS)) return true;

  // Check for system design keywords (indicates complex scenario)
  const sdKeywordCount = countMarkers(trimmed, SYSTEM_DESIGN_KEYWORDS);
  if (sdKeywordCount >= 2) return true;

  // Check for narrative setup patterns
  const narrativePatterns = [
    /your team (has|is|was)/i,
    /a user (clicks|click|does|did)/i,
    /another user/i,
    /at the same time/i,
    /simultaneously/i,
    /concurrently/i,
    /race condition/i,
    /concurrency (conflict|issue|problem)/i,
    /data integrity/i,
    /writes overwrite/i,
  ];

  if (narrativePatterns.some(pattern => pattern.test(norm))) return true;

  // Check for long transcripts with question marks and causal language
  const questionMarks = countQuestionMarks(trimmed);
  const causalWords = ['because', 'since', 'due to', 'as a result', 'consequently', 'therefore'];
  const hasCausalLanguage = causalWords.some(word => norm.includes(word));

  if (questionMarks >= 2 && hasCausalLanguage) return true;

  // Check for length + complexity combination
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 30 && sdKeywordCount >= 1) return true;

  return false;
}

/**
 * Extract complete scenario context block from transcript messages.
 * Preserves narrative setup, architecture constraints, and causal chain.
 */
export function extractScenarioContextBlock(
  allMessages: { text: string; sender: string; timestamp: number }[],
  lastAnswerTimestamp: number | null,
): { context: string; messageCount: number } | null {
  if (allMessages.length === 0) return null;

  // Determine the cutoff - for scenarios, we want a wider window
  const cutoff = lastAnswerTimestamp !== null
    ? Math.min(lastAnswerTimestamp, Date.now() - 10000) // 10s window for scenarios
    : Date.now() - 180000; // 3-minute window for first scenario

  // Start with messages after cutoff
  let contextMessages = allMessages.filter(
    (m) => m.timestamp > cutoff && m.text?.trim()
  );

  // If we have scenario markers in recent messages, look backward for context
  const recentText = contextMessages.map(m => m.text).join(' ').toLowerCase();
  const hasScenarioMarkers = SCENARIO_MARKERS.some(marker => recentText.includes(marker));

  if (hasScenarioMarkers && contextMessages.length < 30) {
    // Expand window backward to capture scenario setup
    // Look for messages that might be part of the scenario narrative
    const allSenderMessages = allMessages.filter(
      m => m.sender === contextMessages[0]?.sender
    );

    // Find the start of the scenario (look for narrative setup markers)
    let scenarioStartIndex = allSenderMessages.length;
    for (let i = allSenderMessages.length - 1; i >= 0; i--) {
      const msg = allSenderMessages[i];
      if (!msg.text?.trim()) continue;

      // Stop if we hit the cutoff or found too much context
      if (msg.timestamp < cutoff - 60000) break; // Don't go more than 1 minute back
      if (allSenderMessages.length - i > 40) break; // Max 40 messages

      const text = msg.text.toLowerCase();
      // Check if this message looks like part of scenario setup
      if (SCENARIO_MARKERS.some(marker => text.includes(marker)) ||
          text.includes('your team') ||
          text.includes('a user') ||
          text.includes('race condition') ||
          text.includes('concurrency')) {
        scenarioStartIndex = i;
      }
    }

    // Use expanded context if found
    if (scenarioStartIndex < allSenderMessages.length) {
      contextMessages = allSenderMessages.slice(scenarioStartIndex);
    }
  }

  if (contextMessages.length === 0) return null;

  // Join and deduplicate
  const joinedText = contextMessages.map(m => m.text.trim()).join(' ');
  return {
    context: joinedText,
    messageCount: contextMessages.length,
  };
}

/**
 * Classify transcript complexity for dynamic context window sizing.
 */
export function classifyTranscriptComplexity(transcript: string): TranscriptComplexity {
  const classification = classifyTranscript(transcript);

  // Map QuestionType to TranscriptComplexity
  switch (classification.type) {
    case 'scenario':
      return 'scenario_based';
    case 'system_design':
      return 'system_design';
    case 'behavioral_star':
      return 'behavioral_star';
    case 'follow_up':
    case 'continuation':
      return 'followup_continuation';
    case 'independent':
      if (classification.segments.length > 1) {
        return 'independent_questions';
      }
      return 'simple_question';
    case 'noise':
      return 'simple_question';
    default:
      return 'simple_question';
  }
}

// ---------------------------------------------------------------------------
// Main classification function
// ---------------------------------------------------------------------------

// Control/demo speech uttered by the candidate while operating the app.
// These must never be treated as interview questions.
const CONTROL_SPEECH_RE =
  /\b(click\s+ai\s+answer|clear\s+transcript|enable\s+automation|disable\s+automation|next\s+question|stop\s+recording|start\s+recording|open\s+overlay|close\s+overlay|hey\s+scribe|okay\s+scribe|ai\s+answer)\b/i;

export function classifyTranscript(
  transcript: string,
  previousContext?: string,
): ClassificationResult {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) {
    return {
      type: 'noise',
      shouldGroup: false,
      segments: [],
      confidence: 1.0,
    };
  }

  // --- Priority 0: Control/demo speech — block before any other check ---
  if (CONTROL_SPEECH_RE.test(trimmed)) {
    return {
      type: 'noise',
      shouldGroup: false,
      segments: [trimmed],
      confidence: 1.0,
    };
  }

  // --- Priority 1: Noise detection ---
  if (isNoise(trimmed)) {
    return {
      type: 'noise',
      shouldGroup: false,
      segments: [trimmed],
      confidence: 0.85,
    };
  }

  // --- Priority 2: Continuation of previous context ---
  if (previousContext) {
    const continuationResult = checkContinuationContext(trimmed, previousContext);
    if (continuationResult.isContinuation) {
      // The combined transcript is available in segments[0]
      // Underlying type can be re-derived by calling classifyTranscript on the combined text
      const combined = `${previousContext} ${trimmed}`;
      return {
        type: 'continuation',
        shouldGroup: true,
        segments: [combined],
        confidence: continuationResult.confidence,
      };
    }
  }

  // --- Priority 3: Scenario markers (KEY RULE: group entire transcript) ---
  const scenarioMatch = containsMarker(trimmed, SCENARIO_MARKERS);
  if (scenarioMatch) {
    // Check if it's also a system design question
    const sdKeywordCount = countMarkers(trimmed, SYSTEM_DESIGN_KEYWORDS);
    if (sdKeywordCount >= 2 || (sdKeywordCount >= 1 && hasScenarioPreamble(trimmed))) {
      return {
        type: 'system_design',
        shouldGroup: true,
        segments: [trimmed],
        confidence: computeConfidence('system_design', trimmed, sdKeywordCount),
      };
    }
    return {
      type: 'scenario',
      shouldGroup: true,
      segments: [trimmed],
      confidence: computeConfidence('scenario', trimmed),
    };
  }

  // --- Priority 4: System design (standalone, without explicit scenario preamble) ---
  const sdKeywordCount = countMarkers(trimmed, SYSTEM_DESIGN_KEYWORDS);
  // System design needs either 3+ keywords OR 2+ keywords with multiple sub-questions
  if (sdKeywordCount >= 3 || (sdKeywordCount >= 2 && countQuestionMarks(trimmed) >= 2)) {
    return {
      type: 'system_design',
      shouldGroup: true,
      segments: [trimmed],
      confidence: computeConfidence('system_design', trimmed, sdKeywordCount),
    };
  }

  // --- Priority 5: STAR behavioral markers ---
  if (containsMarker(trimmed, STAR_BEHAVIORAL_MARKERS)) {
    return {
      type: 'behavioral_star',
      shouldGroup: true,
      segments: [trimmed],
      confidence: computeConfidence('behavioral_star', trimmed),
    };
  }

  // --- Priority 6: Follow-up markers ---
  if (startsWithMarker(trimmed, FOLLOW_UP_MARKERS) || containsMarker(trimmed, FOLLOW_UP_MARKERS)) {
    return {
      type: 'follow_up',
      shouldGroup: true,
      segments: [trimmed],
      confidence: computeConfidence('follow_up', trimmed),
    };
  }

  // --- Priority 7: Independent question detection ---
  const segments = splitIndependentQuestions(trimmed);
  if (segments.length > 1) {
    return {
      type: 'independent',
      shouldGroup: false,
      segments,
      confidence: computeConfidence('independent', trimmed),
    };
  }

  // --- Default: Treat as a single independent question ---
  return {
    type: 'independent',
    shouldGroup: false,
    segments: [trimmed],
    confidence: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Continuation check against previous context
// ---------------------------------------------------------------------------

interface ContinuationCheckResult {
  isContinuation: boolean;
  confidence: number;
}

function checkContinuationContext(
  newTranscript: string,
  previousContext: string,
): ContinuationCheckResult {
  let score = 0;

  // Pronoun references without clear antecedent in new text
  if (hasUnresolvedPronouns(newTranscript)) score += 0.3;

  // Follow-up markers at start of new text
  if (startsWithMarker(newTranscript, CONTINUATION_STARTERS)) score += 0.35;

  // Shared subject nouns between previous and new
  const prevNouns = extractSubjectNouns(previousContext);
  const newNouns = extractSubjectNouns(newTranscript);
  const overlap = tokenOverlap(prevNouns, newNouns);
  if (overlap > 0.3) score += 0.3;

  // Follow-up marker anywhere in new text
  if (containsMarker(newTranscript, FOLLOW_UP_MARKERS)) score += 0.15;

  const confidence = Math.min(score, 1.0);
  return {
    isContinuation: score >= 0.4,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Confidence computation
// ---------------------------------------------------------------------------

function computeConfidence(
  type: QuestionType,
  text: string,
  extraSignal?: number,
): number {
  const norm = normalize(text);

  switch (type) {
    case 'scenario': {
      // More scenario markers → higher confidence
      const markerCount = countMarkers(text, SCENARIO_MARKERS);
      let conf = 0.7 + Math.min(markerCount * 0.1, 0.2);
      // Longer transcripts with scenario markers are more confident
      if (norm.split(/\s+/).length > 20) conf += 0.05;
      return Math.min(conf, 0.98);
    }

    case 'system_design': {
      const sdCount = extraSignal ?? countMarkers(text, SYSTEM_DESIGN_KEYWORDS);
      let conf = 0.6 + Math.min(sdCount * 0.08, 0.3);
      if (hasScenarioPreamble(text)) conf += 0.05;
      return Math.min(conf, 0.98);
    }

    case 'behavioral_star': {
      const markerCount = countMarkers(text, STAR_BEHAVIORAL_MARKERS);
      return Math.min(0.75 + markerCount * 0.1, 0.98);
    }

    case 'follow_up': {
      const atStart = startsWithMarker(text, FOLLOW_UP_MARKERS);
      let conf = atStart ? 0.8 : 0.65;
      conf += Math.min(countMarkers(text, FOLLOW_UP_MARKERS) * 0.05, 0.1);
      return Math.min(conf, 0.98);
    }

    case 'independent': {
      const segments = splitIndependentQuestions(text);
      const pairCount = segments.length;
      // More segments = more confident about independence
      return Math.min(0.6 + pairCount * 0.1, 0.95);
    }

    case 'continuation': {
      return Math.min(0.7 + (extraSignal ?? 0) * 0.1, 0.95);
    }

    case 'noise':
      return 0.85;

    default:
      return 0.5;
  }
}

// ---------------------------------------------------------------------------
// isContinuationOfPreviousQuestion
// ---------------------------------------------------------------------------

export function isContinuationOfPreviousQuestion(
  newTranscript: string,
  previousTranscript: string,
  timeDeltaMs: number,
): boolean {
  let score = 0;

  // --- Time proximity ---
  if (timeDeltaMs < 3000) score += 0.4;
  else if (timeDeltaMs < 5000) score += 0.3;
  else if (timeDeltaMs < 8000) score += 0.15;
  // Beyond 8s: no time-proximity bonus

  // --- Semantic similarity: normalized token overlap > 0.3 ---
  const prevNouns = extractSubjectNouns(previousTranscript);
  const newNouns = extractSubjectNouns(newTranscript);
  const overlap = tokenOverlap(prevNouns, newNouns);
  if (overlap > 0.5) score += 0.35;
  else if (overlap > 0.3) score += 0.25;

  // --- Pronoun references without clear antecedent ---
  if (hasUnresolvedPronouns(newTranscript)) score += 0.2;

  // --- Follow-up markers at start of new text ---
  if (startsWithMarker(newTranscript, CONTINUATION_STARTERS)) score += 0.3;
  // Follow-up markers anywhere
  else if (containsMarker(newTranscript, FOLLOW_UP_MARKERS)) score += 0.15;

  // --- Shared subject nouns ---
  if (overlap > 0.15) score += 0.1;

  return score >= 0.5;
}
