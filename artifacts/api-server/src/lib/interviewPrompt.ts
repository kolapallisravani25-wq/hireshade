import type { sessionsTable } from "@workspace/db/schema";

type Session = typeof sessionsTable.$inferSelect;

const ANSWER_MODE_GUIDANCE: Record<string, string> = {
  theory_only: "Answer with theory/concepts only — do not write code.",
  minimal_code: "Keep code minimal; prioritize explanation over implementation.",
  code_required: "Provide a complete, working code solution with a labelled markdown code block.",
  explain_existing_code: "Focus on explaining the existing code shown, not writing new code.",
  system_design: "Answer as a system design discussion: components, trade-offs, scale, reliability, and risks.",
};

/** Builds the system prompt for session answers (text or screenshot). */
export function buildInterviewSystemPrompt(opts: {
  session: Session;
  resumeContext?: string;
  answerMode?: string;
}): string {
  const { session, resumeContext, answerMode } = opts;
  const parts: string[] = [
    "You generate the user's own answer in first person.",
    "Do not ask questions back. Do not act as an evaluator. Do not roleplay as the other person.",
    "Answer directly, confidently, and naturally, as the user would say it out loud.",
    "Use the user's resume, selected project context, job description, and custom instructions whenever available.",
    "Avoid generic filler. Prefer specific tools, metrics, responsibilities, and project details already present in the provided context.",
    "If details are incomplete, make one brief practical assumption and continue.",
    "Treat short follow-up prompts as continuations of the latest active question unless the topic clearly changes.",
    "Keep the response token-efficient: useful, structured, and not padded.",
    "Never return dummy placeholder values or canned fallback text.",
    "Use markdown formatting that renders cleanly in the app.",
    "When useful, format the answer exactly with these sections:",
    "**Answer:** a polished first-person answer.",
    "**Key points:** 3-5 short bullets with **important keywords** bolded.",
    "**Technical depth:** concrete implementation or architecture details where relevant.",
    "**Plain version:** a simple non-technical version when the session asks for simple/plain language.",
    "For coding questions, include a fenced code block with the correct language label and a brief explanation.",
    "For behavioral questions, prefer Situation → Action → Result when it improves clarity.",
  ];

  if (session.companyName) parts.push(`Company: ${session.companyName}`);
  if (session.round) parts.push(`Round/context: ${session.round}`);
  if (session.jobDescription) {
    parts.push(`Job description / target role context:\n${session.jobDescription}`);
  }
  if (resumeContext) {
    parts.push(`User resume/context to ground answers in:\n${resumeContext}`);
  }
  if (session.simpleLanguage) {
    parts.push("Plain-language mode is enabled. Include a simple explanation and avoid unnecessary jargon.");
  }
  if (session.language && session.language !== "English") {
    parts.push(`Respond in ${session.language}.`);
  }
  if (session.instructions) {
    parts.push(`Custom session instructions from the user:\n${session.instructions}`);
  }
  if (session.extraContext) {
    parts.push(`Extra session context:\n${session.extraContext}`);
  }
  if (answerMode && ANSWER_MODE_GUIDANCE[answerMode]) {
    parts.push(ANSWER_MODE_GUIDANCE[answerMode]!);
  }

  return parts.join("\n\n");
}
