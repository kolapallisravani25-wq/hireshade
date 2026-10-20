/**
 * Demo/CI hook for pronunciation-robust understanding (G-039).
 *
 * The demo pipeline takes an opt-in `pronunciation` option; this module builds
 * it from the demo session material so `make demo` (or any harness) can switch
 * the path on with one flag:
 *
 *   DEMO_PRONUNCIATION=1 make demo
 *
 * and exercises it directly with:
 *
 *   pnpm --dir artifacts/craft-vita exec tsx src/features/pronunciation/demoHook.ts
 *
 * Nothing here touches the network or reads provider keys.
 */
import {
  buildVocabulary,
  type PronunciationVocabulary,
} from "./vocabulary";
import {
  createMockRepairProvider,
  type RepairProvider,
} from "./repair";
import { understandTranscript, type PronunciationUnderstandingResult } from "./understanding";
import type { AccentProfileId } from "../../../../api-server/src/lib/pronunciation/accentProfiles";
import { degradeTranscript } from "../../../../api-server/src/lib/pronunciation/degradation";

export const DEMO_PRONUNCIATION_ENV = "DEMO_PRONUNCIATION";

export interface DemoPronunciationMaterial {
  resumeContext?: string;
  jobDescription?: string;
  companyNames?: readonly string[];
  sessionLanguage?: string;
}

export interface DemoPronunciationStage {
  vocabulary: PronunciationVocabulary;
  repairProvider: RepairProvider;
  sessionLanguage: string;
}

export function isDemoPronunciationEnabled(
  env: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const value = (env[DEMO_PRONUNCIATION_ENV] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const DEMO_PRONUNCIATION_RESUME = [
  "Demo Candidate - Senior Backend Engineer.",
  "Designed a Redis-backed rate limiter for an Express 5 API and owned",
  "Postgres, Kubernetes, Kafka and observability work with Northwind Labs.",
  "Worked with Nguyen on the payments review and Priya on the migration.",
].join(" ");

export const DEMO_PRONUNCIATION_JOB =
  "Senior backend engineer: Node.js/TypeScript, Redis, Postgres, rate limiting, Kubernetes, Kafka.";

export function createDemoPronunciationStage(
  material: DemoPronunciationMaterial = {},
): DemoPronunciationStage {
  return {
    vocabulary: buildVocabulary({
      resumeText: material.resumeContext ?? DEMO_PRONUNCIATION_RESUME,
      jobDescription: material.jobDescription ?? DEMO_PRONUNCIATION_JOB,
      companyNames: material.companyNames ?? ["Northwind Labs"],
      extraTerms: ["Nguyen", "Priya"],
    }),
    repairProvider: createMockRepairProvider({ simulateLatencyMs: 18 }),
    sessionLanguage: material.sessionLanguage ?? "en",
  };
}

/** Options object the demo pipeline accepts (spread into runDemoPipeline). */
export function demoPronunciationPipelineOptions(
  stage: DemoPronunciationStage = createDemoPronunciationStage(),
) {
  return {
    vocabulary: stage.vocabulary,
    repairProvider: stage.repairProvider,
    sessionLanguage: stage.sessionLanguage,
  };
}

export interface DemoPronunciationStageResult {
  canonicalText: string;
  degradedText: string;
  understanding: PronunciationUnderstandingResult;
}

/**
 * One-shot demo step: degrade a canonical question with a chosen accent, then
 * run the full pronunciation layer over it. Useful for `make demo` output and
 * for hand verification.
 */
export async function runDemoPronunciationStage(
  canonicalText: string,
  options: DemoPronunciationMaterial & {
    profile?: AccentProfileId;
    seed?: string | number;
    stage?: DemoPronunciationStage;
  } = {},
): Promise<DemoPronunciationStageResult> {
  const stage = options.stage ?? createDemoPronunciationStage(options);
  const degraded = degradeTranscript(canonicalText, options.profile ?? "south_indian", {
    seed: options.seed ?? canonicalText,
  });
  const understanding = await understandTranscript(
    {
      segmentId: "demo-pronunciation",
      text: degraded.text,
      words: degraded.words,
      alternatives: degraded.alternatives,
      language: stage.sessionLanguage,
    },
    {
      vocabulary: stage.vocabulary,
      repairProvider: stage.repairProvider,
      sessionLanguage: stage.sessionLanguage,
      resumeContext: options.resumeContext,
      jobDescription: options.jobDescription,
    },
  );
  return { canonicalText, degradedText: degraded.text, understanding };
}
