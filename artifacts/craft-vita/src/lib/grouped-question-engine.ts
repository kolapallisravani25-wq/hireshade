import type { ClassificationResult } from './semantic-classifier';

// ---------------------------------------------------------------------------
// Stop words – used by noun / keyword extraction in scoreDependencyChain
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but',
  'and', 'or', 'if', 'while', 'about', 'up', 'down', 'it', 'its', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
  'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'what',
  'which', 'who', 'whom',
]);

// ---------------------------------------------------------------------------
// Architectural vocabulary – used for cohesion scoring
// ---------------------------------------------------------------------------
const ARCH_TERMS = new Set([
  'scale', 'cache', 'database', 'api', 'service', 'server', 'load',
  'queue', 'deploy', 'auth', 'storage', 'system', 'client', 'backend',
  'frontend',
]);

// ---------------------------------------------------------------------------
// Scenario preambles
// ---------------------------------------------------------------------------
const SCENARIO_PREAMBLES: RegExp[] = [
  /\bsuppose\b/i,
  /\bimagine\b/i,
  /\bdesign a\b/i,
  /\bbuild a\b/i,
  /\bwhat would you do if\b/i,
  /\blet's say\b/i,
  /\bconsider\b/i,
  /\bif you were to\b/i,
  /\bwalk me through\b/i,
  /\bhow would you approach\b/i,
];

// ---------------------------------------------------------------------------
// Multi-part scenario follow-ups (after a preamble)
// ---------------------------------------------------------------------------
const SCENARIO_FOLLOW_UPS: RegExp[] = [
  /\bhow would you\b/i,
  /\bwhat about\b/i,
  /\band how\b/i,
];

// ---------------------------------------------------------------------------
// Pronoun back-references – found in segments 2+ without local antecedent
// ---------------------------------------------------------------------------
const PRONOUN_PATTERNS: RegExp[] = [
  /\bit\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthose\b/i,
  /\bthe system\b/i,
  /\bthe service\b/i,
];

// ---------------------------------------------------------------------------
// Sequential connectors – continuation words at the start of a segment
// ---------------------------------------------------------------------------
const SEQUENTIAL_CONNECTORS: RegExp[] = [
  /^and\b/i,
  /^then\b/i,
  /^also\b/i,
  /^next\b/i,
  /^after that\b/i,
  /^furthermore\b/i,
  /^additionally\b/i,
];

// ---------------------------------------------------------------------------
// isScenarioBasedQuestion & detectConversationalScenario
// ---------------------------------------------------------------------------

export interface ConversationalScenarioResult {
  isScenario: boolean;
  type?: "scenario_based";
  subtype?: "production_scaling_debugging" | "system_design_continuity";
  grouped?: boolean;
  complexity?: "architecture" | "system";
  preserveFullContext?: boolean;
}

/**
 * Detect complex scenario questions, specifically production scaling, debugging,
 * and system design narratives.
 */
export function detectConversationalScenario(
  transcript: string,
): ConversationalScenarioResult {
  const trimmed = transcript.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct scenario preambles
  const preamblePatterns = [
    /\bimagine\b/i,
    /\bsuppose\b/i,
    /\blet's say\b/i,
    /\blet's assume\b/i,
    /\bpretend you\b/i,
    /\bgiven a scenario\b/i,
    /\bin a situation where\b/i,
    /\bconsider a scenario\b/i,
    /\bpicture this\b/i,
    /\benvision a\b/i,
    /\bsay you are\b/i,
    /\bsay you have\b/i,
  ];

  // 2. Production/Scaling/Debugging Incident indicators
  const prodIncidentIndicators = [
    /\bin production\b/i,
    /\bproduction incident\b/i,
    /\btraffic spike\b/i,
    /\bmassive spike\b/i,
    /\bbackend starts choking\b/i,
    /\bchoking\b/i,
    /\bevent loop lag\b/i,
    /\bconnection pool\b/i,
    /\bmaxed out\b/i,
    /\bapis start failing\b/i,
    /\bserverselectionerror\b/i,
    /\btimeouts?\b/i,
    /\bmonitored\b/i,
    /\btroubleshooting steps\b/i,
    /\bimmediate troubleshooting\b/i,
    /\bhow would you configure\b/i,
    /\bconcurrency\b/i,
    /\bhammering the database\b/i,
    /\bdatabase tuning\b/i,
    /\barchitectural redesign\b/i,
  ];

  // 3. Question / action starters in scenarios
  const actionStarters = [
    /\bwhat would you do\b/i,
    /\bhow would you\b/i,
    /\bwhat would be your\b/i,
    /\bwhat architectural pattern\b/i,
    /\bif you saw this\b/i,
  ];

  // Check matching counts
  const matchesPreamble = preamblePatterns.some((pat) => pat.test(lower));
  const matchesProdIncident = prodIncidentIndicators.filter((pat) => pat.test(lower)).length;
  const matchesAction = actionStarters.some((pat) => pat.test(lower));

  // Determine if it is a production scaling/debugging incident or system design continuity
  const hasStrongScenarioSign = matchesPreamble || (matchesProdIncident >= 2) || (matchesPreamble && matchesAction);
  const isArchitectureComplexity = lower.includes("mongoose") || lower.includes("mern") || lower.includes("express") || lower.includes("concurrency") || lower.includes("database") || lower.includes("architecture");

  if (hasStrongScenarioSign || (matchesAction && isArchitectureComplexity)) {
    return {
      isScenario: true,
      type: "scenario_based",
      subtype: matchesProdIncident >= 2 ? "production_scaling_debugging" : "system_design_continuity",
      grouped: true,
      complexity: isArchitectureComplexity ? "architecture" : "system",
      preserveFullContext: true,
    };
  }

  return {
    isScenario: false,
  };
}

/**
 * Quick check: does this transcript represent a scenario-based question?
 * Returns true if the transcript contains scenario patterns that indicate
 * sub-questions should NOT be split.
 */
export function isScenarioBasedQuestion(transcript: string): boolean {
  // Check the new conversational scenario detector first
  const scenarioResult = detectConversationalScenario(transcript);
  if (scenarioResult.isScenario) {
    return true;
  }

  const lower = transcript.toLowerCase();

  // 1. Direct scenario preamble match
  if (SCENARIO_PREAMBLES.some((re) => re.test(lower))) {
    // If we have a preamble AND a follow-up, it's definitely scenario-based
    if (SCENARIO_FOLLOW_UPS.some((re) => re.test(lower))) {
      return true;
    }
    // Preamble alone is enough – err on the side of grouping
    return true;
  }

  // 2. Architecture chain detection – multiple questions sharing
  //    architecture terms suggests a system-design scenario
  const archMatches = lower.match(
    /\b(system|service|api|server|client|backend|frontend|database)\b/gi,
  );
  if (archMatches && archMatches.length >= 3) {
    // At least 3 mentions of architectural terms → likely a design scenario
    const uniqueArchTerms = new Set(archMatches.map((t) => t.toLowerCase()));
    if (uniqueArchTerms.size >= 2) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// scoreDependencyChain
// ---------------------------------------------------------------------------

/**
 * Extract significant keywords from a segment (words > 3 chars, not stop words).
 */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return new Set(words);
}

/**
 * Compute Jaccard similarity between two sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score how dependent a set of question segments are on each other.
 * Returns 0-1 where 1 means fully dependent (should group) and 0 means fully independent.
 */
export function scoreDependencyChain(segments: string[]): number {
  if (segments.length <= 1) return 1;

  // --- 1. Shared noun overlap (0-0.4) ---
  const keywordSets = segments.map(extractKeywords);
  let totalJaccard = 0;
  let pairCount = 0;
  for (let i = 1; i < keywordSets.length; i++) {
    totalJaccard += jaccard(keywordSets[i - 1], keywordSets[i]);
    pairCount++;
  }
  const avgJaccard = pairCount > 0 ? totalJaccard / pairCount : 0;
  const nounScore = avgJaccard * 0.4;

  // --- 2. Pronoun back-references (0-0.2) ---
  let pronounHits = 0;
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    // A pronoun in segment i is a back-reference if it references something
    // only defined in an earlier segment. We approximate: if the segment
    // contains a pronoun pattern AND the pronoun's referent is not defined
    // within the same segment (i.e. the keyword from earlier segments is
    // absent in this segment).
    for (const re of PRONOUN_PATTERNS) {
      if (re.test(segment)) {
        // Check whether the likely referent (from earlier segments) appears
        // in this segment too. If not, it's a back-reference.
        const earlierKeywords = keywordSets
          .slice(0, i)
          .reduce<Set<string>>((acc, s) => new Set([...acc, ...s]), new Set());
        const currentKeywords = keywordSets[i];
        let hasLocalAntecedent = false;
        for (const kw of earlierKeywords) {
          if (currentKeywords.has(kw)) {
            hasLocalAntecedent = true;
            break;
          }
        }
        if (!hasLocalAntecedent) {
          pronounHits++;
        }
        break; // one pronoun hit per segment is enough
      }
    }
  }
  const pronounScore = Math.min(pronounHits / (segments.length - 1), 1) * 0.2;

  // --- 3. Architectural cohesion (0-0.2) ---
  const archSets = segments.map((s) => {
    const words = s.toLowerCase().split(/\s+/);
    return new Set(words.filter((w) => ARCH_TERMS.has(w)));
  });
  // Count segments sharing 2+ architectural terms
  const allArchTerms = archSets.reduce<Set<string>>(
    (acc, s) => new Set([...acc, ...s]),
    new Set(),
  );
  let segmentsWithSharedArch = 0;
  for (const archSet of archSets) {
    let sharedWithOthers = 0;
    for (const term of archSet) {
      // Count how many OTHER segments also contain this term
      const otherCount = archSets.filter((s) => s !== archSet && s.has(term)).length;
      if (otherCount >= 1) sharedWithOthers++;
    }
    if (sharedWithOthers >= 2) segmentsWithSharedArch++;
  }
  const archScore =
    segmentsWithSharedArch >= 3
      ? 0.2
      : segmentsWithSharedArch >= 2
        ? 0.1
        : 0;

  // --- 4. Sequential connectors (0-0.2) ---
  let connectorCount = 0;
  for (let i = 1; i < segments.length; i++) {
    const trimmed = segments[i].trim();
    if (SEQUENTIAL_CONNECTORS.some((re) => re.test(trimmed))) {
      connectorCount++;
    }
  }
  const connectorScore = Math.min(connectorCount / (segments.length - 1), 1) * 0.2;

  // --- Weighted sum, clamped to [0, 1] ---
  const total = nounScore + pronounScore + archScore + connectorScore;
  return Math.max(0, Math.min(1, total));
}

// ---------------------------------------------------------------------------
// splitIndependentQuestions
// ---------------------------------------------------------------------------

/**
 * Try to split a numbered-list transcript into individual questions.
 * Handles patterns like "1. Question\n2. Question" etc.
 */
function tryNumberedListSplit(transcript: string): string[] | null {
  const lines = transcript.split(/\n/);
  const numberedPattern = /^\s*(\d+)[.)]\s*/;
  const numberedLineIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (numberedPattern.test(lines[i])) {
      numberedLineIndices.push(i);
    }
  }

  if (numberedLineIndices.length < 2) return null;

  // Verify the numbers are sequential starting from 1
  const numbers = numberedLineIndices.map((idx) => {
    const match = lines[idx].match(numberedPattern);
    return match ? parseInt(match[1], 10) : 0;
  });

  let isSequential = true;
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) {
      isSequential = false;
      break;
    }
  }

  if (!isSequential) return null;

  // Build segments from numbered items
  const segments: string[] = [];
  for (let i = 0; i < numberedLineIndices.length; i++) {
    const start = numberedLineIndices[i];
    const end =
      i + 1 < numberedLineIndices.length
        ? numberedLineIndices[i + 1]
        : lines.length;
    const segment = lines
      .slice(start, end)
      .join('\n')
      .replace(numberedPattern, '')
      .trim();
    if (segment) segments.push(segment);
  }

  return segments.length >= 2 ? segments : null;
}

/**
 * Try to split transcript on question boundaries (? followed by capital
 * letter or whitespace that begins a new sentence).
 */
function tryQuestionBoundarySplit(transcript: string): string[] | null {
  // Split on "? " followed by a capital letter or end of string
  const parts = transcript
    .split(/\?\s+(?=[A-Z])/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Re-add the question mark to each part except the last (which may or may
  // not end with one)
  const segments: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i < parts.length - 1) {
      // This part was split before a "?", so it originally ended with "?"
      segments.push(part.endsWith('?') ? part : part + '?');
    } else {
      segments.push(part);
    }
  }

  return segments.length >= 2 ? segments : null;
}

/**
 * Split transcript into independent questions ONLY when it's safe to do so.
 * Uses strict criteria to avoid splitting scenario-based questions.
 * Returns array of independent question strings.
 * If questions should remain grouped, returns single-element array with full transcript.
 */
export function splitIndependentQuestions(
  transcript: string,
  classification: ClassificationResult,
): string[] {
  // Rule 1: If classification explicitly says group, do not split
  if (classification.shouldGroup === true) {
    return [transcript];
  }

  // Rule 2: Scenario / system-design / behavioral questions stay grouped
  if (
    classification.type === 'scenario' ||
    classification.type === 'system_design' ||
    classification.type === 'behavioral_star'
  ) {
    return [transcript];
  }

  // Rule 3: If the transcript itself looks like a scenario, stay grouped
  if (isScenarioBasedQuestion(transcript)) {
    return [transcript];
  }

  // --- Attempt splitting ---

  // Strategy 1: Numbered list
  let segments = tryNumberedListSplit(transcript);

  // Strategy 2: Question-boundary split
  if (!segments) {
    segments = tryQuestionBoundarySplit(transcript);
  }

  // If no split strategy produced results, return as-is
  if (!segments || segments.length < 2) {
    return [transcript];
  }

  // Validate: run dependency scoring on resulting segments
  const dependencyScore = scoreDependencyChain(segments);

  // If dependency > 0.3, abort split – likely a false-positive independent detection
  if (dependencyScore > 0.3) {
    return [transcript];
  }

  return segments;
}
