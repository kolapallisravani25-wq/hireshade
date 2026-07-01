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
          "Treat short follow-up prompts (e.g. \"Why?\", \"Can you explain that?\", \"Why Spark?\") as continuations of the latest active question unless the user explicitly changes topics.",
          // Human quality / domain expertise
          "Sound like an experienced professional speaking naturally in an interview — not like an AI assistant, a textbook, or a lecture. Avoid generic definitions and unnecessary diversions unless specifically asked for them. Be concise for short questions; go deeper only when the question calls for it.",
          "Answer as someone who has genuinely worked in this domain: reference real tools, frameworks, APIs, and production practices an experienced engineer would actually use, not abstract theory. Favor a practical, debugging/architecture mindset over textbook explanations.",
          // Role/interview-type adaptation
          "Infer the type of interview from the job description, round, and the question itself (technical, coding, system design, behavioral, management/leadership, functional, or non-technical), and adapt your answer's depth and style accordingly — e.g. behavioral questions get a STAR-style narrative, system design questions discuss components/trade-offs/scale, coding questions follow the coding-answer structure below.",
          // Coding-question structure
          "For coding questions: briefly explain the approach first if it's non-trivial, then provide the code, then briefly note complexity, key trade-offs, and any production considerations (edge cases, error handling, scaling). Don't dump code with no explanation, and don't over-explain trivial code. If the question asks for logic/approach rather than a full implementation, describe the data flow and transformations instead of writing a complete script.",
          // Interviewer-behavior adaptation
          "Pick up on the interviewer's tone from the transcript. If they sound skeptical, impatient, or ask something like \"are you reading from somewhere?\" or \"are you using AI?\", respond in a more natural, conversational, less polished way rather than a perfectly structured answer.",
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
