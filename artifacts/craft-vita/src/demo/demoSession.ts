/**
 * Maps the target's session-create contract (T-11) onto the real prompt
 * builder (artifacts/api-server/src/lib/interviewPrompt.ts).
 *
 * The client sends references + answer preferences; prompt assembly stays
 * server-side. The demo proves that the real builder still produces the system
 * prompt from the same contract shape without any keys.
 */
import { buildInterviewSystemPrompt } from "../../../api-server/src/lib/interviewPrompt";
import type { TargetSessionCreate } from "../../../api-server/src/lib/mocks/targetContracts";

type PromptSession = Parameters<typeof buildInterviewSystemPrompt>[0]["session"];

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
};

export function languageLabel(code: string): string {
  const base = code.split(":")[0]?.toLowerCase() ?? "en";
  return LANGUAGE_LABELS[base] ?? code;
}

export const DEMO_RESUME_CONTEXT = [
  "Demo Candidate - Senior Backend Engineer.",
  "Recent work: designed a Redis-backed rate limiter for an Express 5 API, added",
  "sliding-window counters for sensitive endpoints and an in-process fallback.",
  "Comfortable with Postgres, Redis, Node.js, TypeScript, system design and on-call.",
].join(" ");

export const DEMO_JOB_DESCRIPTION =
  "Senior backend engineer: Node.js/TypeScript services, Redis, Postgres, rate limiting, reliability and observability.";

/** Human-readable preference block appended to the real system prompt. */
export function formatSessionPreferences(create: TargetSessionCreate): string {
  return [
    "Session answer preferences (from the desktop session-create contract):",
    `- language: ${languageLabel(create.language)}`,
    `- response length: ${create.responseLength}`,
    `- response format: ${create.responseFormat}`,
    `- response tone: ${create.responseTone}`,
    `- use STAR method: ${create.useStarMethod ? "yes" : "no"}`,
    `- use filler words: ${create.useFillerWords ? "yes" : "no"}`,
    `- auto answer: ${create.autoAnswer ? "enabled" : "disabled"}`,
    `- save transcription: ${create.saveTranscription ? "enabled" : "disabled"}`,
  ].join("\n");
}

export interface DemoPromptInputs {
  session: PromptSession;
  answerMode: string | undefined;
  prompt: string;
}

/**
 * Builds the real system prompt for a target-contract session payload.
 * `resumeContext` stands in for the server-side resume rendering (T-11).
 */
export function buildDemoPromptInputs(
  create: TargetSessionCreate,
  opts: { resumeContext?: string } = {},
): DemoPromptInputs {
  const extraContext = [
    create.transcriptionContext,
    formatSessionPreferences(create),
  ]
    .filter(Boolean)
    .join("\n\n");

  const session = {
    companyName: "Northwind Labs (demo)",
    round: "Technical screen",
    jobDescription: DEMO_JOB_DESCRIPTION,
    language: languageLabel(create.language),
    simpleLanguage: false,
    instructions: create.systemInstructions,
    extraContext,
  } as unknown as PromptSession;

  const answerMode =
    create.responseFormat === "code"
      ? "code_required"
      : create.responseFormat === "bullets"
        ? "theory_only"
        : undefined;

  const prompt = buildInterviewSystemPrompt({
    session,
    resumeContext: opts.resumeContext ?? DEMO_RESUME_CONTEXT,
    answerMode,
  });

  return { session, answerMode, prompt };
}
