/**
 * Coding-question detector (G-023).
 *
 * The target advertises "Full Coding Support"; this module decides when a
 * question is a coding/algorithm/system-design problem so the answer path can
 * switch to the structured coding contract instead of a prose interview answer.
 *
 * Pure and dependency-free: weighted signal rules, no LLM call, so it is cheap
 * enough to run on every Analyze Screen / AI Answer trigger.
 */

export interface CodingQuestionDetection {
  isCoding: boolean;
  /** 0..1 confidence. Threshold is CONTRACT_THRESHOLD. */
  confidence: number;
  /** Rule ids that fired — logged for tuning and useful in tests. */
  signals: string[];
}

export const CODING_CONFIDENCE_THRESHOLD = 0.5;

interface CodingSignalRule {
  id: string;
  weight: number;
  pattern: RegExp;
}

// Strong rules are near-unambiguous coding phrasings; medium rules cover
// problem-statement shape; weak rules only contribute alongside another signal.
const RULES: readonly CodingSignalRule[] = [
  { id: "complexity", weight: 0.8, pattern: /\b(time|space)\s+complexity\b|\bbig[\s-]?o\b|\bO\([^)]+\)/i },
  { id: "implement", weight: 0.75, pattern: /\bimplement\b|\bwrite\s+(a|an|the)?\s*(function|method|program|script|class)\b/i },
  { id: "code-keyword", weight: 0.65, pattern: /\b(code|coding|codebase|snippet|pseudocode)\b/i },
  { id: "debug", weight: 0.7, pattern: /\bdebug\b|\bfix\s+(this|the)\s+(bug|code|error|issue)\b|\bwhy\s+(does|is)\s+this\s+(code|function|program)\b/i },
  { id: "optimize", weight: 0.6, pattern: /\boptimi[sz]e\b(?=[^.!?]{0,40}\b(code|query|function|algorithm|solution|implementation|complexity|loop)\b)|\brefactor\b/i },
  { id: "algorithm", weight: 0.6, pattern: /\balgorithm\b|\brecursion\b|\bdynamic\s+programming\b|\bbinary\s+search\b|\btwo[\s-]?pointer\b|\bsorting\b|\bbreadth[\s-]?first\b|\bdepth[\s-]?first\b|\bbacktracking\b/i },
  { id: "data-structure", weight: 0.55, pattern: /\barray\b|\blinked\s+list\b|\bhash\s*(map|table|set)\b|\bbinary\s+tree\b|\bstack\b|\bqueue\b|\bgraph\b|\bheap\b|\btrie\b/i },
  { id: "problem-statement", weight: 0.5, pattern: /\bgiven\s+(an?|the)\s+(array|string|list|tree|matrix|integer|number)\b|\breturn\s+(the|true|false|an?|all)\b|\binput:\b|\boutput:\b|\btest\s+cases?\b|\bedge\s+cases?\b/i },
  { id: "coding-language", weight: 0.45, pattern: /\b(python|javascript|typescript|java|c\+\+|c#|golang|go\s+lang|rust|sql)\b/i },
  { id: "sql", weight: 0.6, pattern: /\b(sql|select\s+.*\bfrom\b|join\s+.*\bon\b)\b/i },
  { id: "design-system", weight: 0.6, pattern: /\bdesign\s+(a|an|the)\s+[\w\s-]{2,60}(system|service|api|database|schema|pipeline|cache|rate\s+limiter|url\s+shortener|chat|feed)\b/i },
  { id: "design-a", weight: 0.5, pattern: /\bdesign\s+(a|an)\b/i },
  { id: "leetcode", weight: 0.7, pattern: /\bleetcode\b|\bcodility\b|\bhackerrank\b|\bcoderpad\b/i },
  { id: "output-prediction", weight: 0.55, pattern: /\bwhat('s| is)\s+(the\s+)?(output|result|return\s+value)\b/i },
  { id: "dry-run", weight: 0.4, pattern: /\btrace\s+(the|through)\s+(code|function|loop)\b|\bdry[\s-]?run\b/i },
];

function normalize(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Detects whether the question/transcript describes a coding task. */
export function detectCodingQuestion(text: string): CodingQuestionDetection {
  const normalized = normalize(text);
  if (!normalized) return { isCoding: false, confidence: 0, signals: [] };

  const signals: string[] = [];
  let score = 0;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) {
      signals.push(rule.id);
      score += rule.weight;
    }
  }

  // A lone weak signal ("this is code") is not enough; require >= threshold.
  const confidence = Math.min(1, Math.round(score * 100) / 100);
  return {
    isCoding: confidence >= CODING_CONFIDENCE_THRESHOLD,
    confidence,
    signals,
  };
}

/** Convenience boolean used by the screen-answer route. */
export function isCodingQuestion(text: string): boolean {
  return detectCodingQuestion(text).isCoding;
}
