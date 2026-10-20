/**
 * Structured answer contract for coding questions (G-023).
 *
 * The target sells "Full Coding Support". For a detected coding question the
 * answer must be shaped like an interview coding answer — approach, complexity,
 * edge cases, then code — instead of the usual prose answer. The contract is a
 * single string injected into the system prompt (Analyze Screen reuses the
 * existing POST /session/:id/analyze-screen route by setting answerMode to
 * "code_required", which the API maps to this guidance).
 */
import {
  detectCodingQuestion,
  type CodingQuestionDetection,
} from "./codingQuestionDetector";

export const CODING_ANSWER_MODE = "code_required" as const;

export const CODING_ANSWER_CONTRACT = [
  "This is a CODING problem. Answer the candidate's coding answer in exactly this structure:",
  "1. **Approach** — 2-4 sentences on the algorithm/data structures and why they fit.",
  "2. **Complexity** — state time AND space complexity in Big-O with a one-line justification.",
  "3. **Edge cases** — list the concrete edge cases the solution handles (empty input, single element, duplicates, overflow, invalid input, etc. as relevant).",
  "4. **Code** — ONE complete, runnable solution in a fenced code block with a language label. Satisfy every constraint stated in the question.",
  "Keep the prose tight; the code is the main artifact.",
].join("\n");

export interface AnalyzeScreenCodingRoute {
  /** Value to send as contextPayload.answerMode to /analyze-screen. */
  answerMode: typeof CODING_ANSWER_MODE | "auto";
  detection: CodingQuestionDetection;
  /** Extra instruction text to append to the Analyze Screen request, if any. */
  promptAddendum?: string;
}

/**
 * Routes an Analyze Screen request: a screenshot of a coding task gets the
 * structured coding contract; everything else keeps the existing "auto" mode.
 */
export function routeAnalyzeScreenCodingMode(input: {
  question?: string;
  transcript?: string;
}): AnalyzeScreenCodingRoute {
  const combined = [input.question ?? "", input.transcript ?? ""].join("\n");
  const detection = detectCodingQuestion(combined);
  if (!detection.isCoding) return { answerMode: "auto", detection };
  return {
    answerMode: CODING_ANSWER_MODE,
    detection,
    promptAddendum: CODING_ANSWER_CONTRACT,
  };
}
