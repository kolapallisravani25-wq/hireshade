import type { sessionsTable } from "@workspace/db/schema";

type Session = typeof sessionsTable.$inferSelect;

const ANSWER_MODE_GUIDANCE: Record<string, string> = {
  theory_only: "Answer with theory/concepts only — do not write code.",
  minimal_code: "Keep code minimal; prioritize explanation over implementation.",
  code_required: "Provide a complete, working code solution.",
  explain_existing_code: "Focus on explaining the existing code shown, not writing new code.",
  system_design: "Answer as a system design discussion: components, trade-offs, scale.",
};

/** Builds the system prompt for live interview-copilot answers (text or screenshot). */
export function buildInterviewSystemPrompt(opts: {
  session: Session;
  resumeContext?: string;
  answerMode?: string;
}): string {
  const { session, resumeContext, answerMode } = opts;
  const parts: string[] = [
    "You are an expert interview copilot helping a candidate answer questions in a live interview, in real time.",
    "Answer directly, confidently, and concisely, as the candidate would say it out loud. Do not narrate that you are an AI.",
    "Never ask for more context or say context is missing. If details are incomplete, answer with the most likely interpretation and state brief assumptions.",
    "Treat short follow-up prompts as continuations of the latest active question unless the user explicitly changes topics.",
  ];

  if (session.companyName) parts.push(`Company: ${session.companyName}`);
  if (session.round) parts.push(`Interview round: ${session.round}`);
  if (session.jobDescription) {
    parts.push(`Job description:\n${session.jobDescription}`);
  }
  if (resumeContext) {
    parts.push(`Candidate's resume:\n${resumeContext}`);
  }
  if (session.simpleLanguage) {
    parts.push("Use simple, plain language — avoid jargon.");
  }
  if (session.language && session.language !== "English") {
    parts.push(`Respond in ${session.language}.`);
  }
  if (session.instructions) {
    parts.push(`Additional instructions from the candidate: ${session.instructions}`);
  }
  if (session.extraContext) {
    parts.push(`Extra context: ${session.extraContext}`);
  }
  if (answerMode && ANSWER_MODE_GUIDANCE[answerMode]) {
    parts.push(ANSWER_MODE_GUIDANCE[answerMode]!);
  }

  return parts.join("\n\n");
}
