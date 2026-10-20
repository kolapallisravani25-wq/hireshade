/**
 * Structured coding-answer contract (G-023), server side.
 *
 * Mirrors `artifacts/craft-vita/src/features/coding/analyzeScreenCodingRoute.ts`.
 * The client detects coding questions and sends `answerMode: "code_required"`;
 * the prompt builder appends this contract so Analyze Screen / AI Answer
 * produce an approach → complexity → edge cases → code answer.
 */
export const CODING_ANSWER_MODE = "code_required" as const;

export const CODING_ANSWER_CONTRACT = [
  "This is a CODING problem. Answer the candidate's coding answer in exactly this structure:",
  "1. **Approach** — 2-4 sentences on the algorithm/data structures and why they fit.",
  "2. **Complexity** — state time AND space complexity in Big-O with a one-line justification.",
  "3. **Edge cases** — list the concrete edge cases the solution handles (empty input, single element, duplicates, overflow, invalid input, etc. as relevant).",
  "4. **Code** — ONE complete, runnable solution in a fenced code block with a language label. Satisfy every constraint stated in the question.",
  "Keep the prose tight; the code is the main artifact.",
].join("\n");

/** Extra prompt text for a given answerMode (empty unless code_required). */
export function codingGuidanceForAnswerMode(answerMode?: string): string {
  return answerMode === CODING_ANSWER_MODE ? CODING_ANSWER_CONTRACT : "";
}
