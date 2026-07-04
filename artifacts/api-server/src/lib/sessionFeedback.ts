import { db } from "@workspace/db";
import {
  sessionFeedbackTable,
  sessionMessagesTable,
  sessionsTable,
  type DbSession,
} from "@workspace/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { chatCompleteJSON } from "./openrouter.js";
import { getResumeContextById } from "./resumeContext.js";
import { logger } from "./logger.js";

/**
 * Post-session Insights (spec §4.3 / §7 / §8 / §13).
 *
 * The review page's Insights/Analytics tab renders an AI-generated evaluation
 * of the interview: 0–100 metrics, interviewer mood, strengths, improvements,
 * key topics, and study areas. This module generates that evaluation once from
 * the saved transcript, persists it (one row per session), and re-serves it on
 * subsequent opens.
 *
 * Generation is idempotent: a UNIQUE constraint on session_id means concurrent
 * triggers (the async on-end job + the dialog's auto-generate) converge on a
 * single row instead of producing duplicates or double-charging model calls.
 */

export interface SessionFeedbackShape {
  id: string;
  sessionId: string;
  score: number;
  confidence: number;
  communication: number;
  interactivity: number;
  technicalDepth: number;
  conciseness: number;
  avgResponseTime: number | null;
  interviewerMood: string | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  keyTopics: string[];
  studyAreas: string[];
  resumeGaps: string[];
  generatedAt: string;
}

function clamp100(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function toStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : String(x ?? "").trim()))
    .filter(Boolean)
    .slice(0, max);
}

function rowToShape(
  row: typeof sessionFeedbackTable.$inferSelect,
): SessionFeedbackShape {
  return {
    id: row.id,
    sessionId: row.sessionId,
    score: row.score,
    confidence: row.confidence,
    communication: row.communication,
    interactivity: row.interactivity,
    technicalDepth: row.technicalDepth,
    conciseness: row.conciseness,
    avgResponseTime: row.avgResponseTime ?? null,
    interviewerMood: row.interviewerMood ?? null,
    summary: row.summary ?? null,
    strengths: row.strengths ?? [],
    improvements: row.improvements ?? [],
    keyTopics: row.keyTopics ?? [],
    studyAreas: row.studyAreas ?? [],
    resumeGaps: row.resumeGaps ?? [],
    generatedAt: row.generatedAt.toISOString(),
  };
}

/** Return the stored feedback for a session, or null if not generated yet. */
export async function getExistingFeedback(
  sessionId: string,
): Promise<SessionFeedbackShape | null> {
  const [row] = await db
    .select()
    .from(sessionFeedbackTable)
    .where(eq(sessionFeedbackTable.sessionId, sessionId))
    .limit(1);
  return row ? rowToShape(row) : null;
}

/** Mean whole-second gap between an interviewer turn and the following reply. */
function computeAvgResponseTime(
  messages: { role: string; createdAt: Date }[],
): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]!;
    const cur = messages[i]!;
    const prevIsInterviewer =
      prev.role === "INTERVIEWER" || prev.role === "interviewer";
    const curIsCandidate =
      cur.role === "USER" || cur.role === "user" || cur.role === "assistant";
    if (prevIsInterviewer && curIsCandidate) {
      const gap = (cur.createdAt.getTime() - prev.createdAt.getTime()) / 1000;
      if (gap >= 0 && gap < 600) gaps.push(gap);
    }
  }
  if (gaps.length === 0) return null;
  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}

interface LlmFeedback {
  score: number;
  confidence: number;
  communication: number;
  interactivity: number;
  technicalDepth: number;
  conciseness: number;
  interviewerMood: string;
  summary: string;
  strengths: string[];
  improvements: string[];
  keyTopics: string[];
  studyAreas: string[];
  resumeGaps: string[];
}

/**
 * Generate-or-return session feedback. Idempotent: if a row already exists it
 * is returned unchanged (no re-generation, no duplicate model spend). Returns
 * null only when there is not enough transcript to evaluate.
 */
export async function generateSessionFeedback(
  session: DbSession,
): Promise<SessionFeedbackShape | null> {
  // Fast path: already generated.
  const existing = await getExistingFeedback(session.id);
  if (existing) return existing;

  const messages = await db
    .select()
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, session.id))
    .orderBy(asc(sessionMessagesTable.createdAt));

  // Need a real conversation to evaluate — a couple of stray lines isn't one.
  const meaningful = messages.filter((m) => (m.content ?? m.answer ?? "").trim());
  if (meaningful.length < 2) {
    return null;
  }

  const transcript = meaningful
    .map((m) => {
      const who =
        m.role === "INTERVIEWER"
          ? "Interviewer"
          : m.role === "USER"
            ? "Candidate"
            : m.role === "assistant"
              ? "Candidate (AI-assisted)"
              : m.role;
      return `${who}: ${(m.content ?? m.answer ?? "").trim()}`;
    })
    .join("\n")
    .slice(0, 12_000);

  const resumeContext = session.resumeId
    ? await getResumeContextById(session.resumeId, session.userId).catch(() => "")
    : "";

  const prompt = [
    "You are an expert technical interview evaluator. Analyze the following interview transcript and produce a structured, honest evaluation of the CANDIDATE's performance.",
    session.round ? `Role: ${session.round}` : "",
    session.companyName ? `Company: ${session.companyName}` : "",
    resumeContext ? `Candidate resume context:\n${resumeContext.slice(0, 3000)}` : "",
    `Transcript:\n${transcript}`,
    'Respond with ONLY a JSON object of this exact shape (all metrics are integers 0-100): {"score":n,"confidence":n,"communication":n,"interactivity":n,"technicalDepth":n,"conciseness":n,"interviewerMood":"one short sentence describing the interviewer\'s apparent mood/receptiveness","summary":"2-3 sentence overall summary","strengths":["..."],"improvements":["..."],"keyTopics":["technical topics discussed"],"studyAreas":["areas the candidate should study further"],"resumeGaps":["gaps between the resume and what was asked, or [] if no resume"]}. No other text.',
  ]
    .filter(Boolean)
    .join("\n\n");

  let llm: LlmFeedback;
  try {
    llm = await chatCompleteJSON<LlmFeedback>({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1500,
      ...(session.aiModel ? { model: session.aiModel } : {}),
    });
  } catch (err) {
    logger.error({ sessionId: session.id, err }, "[insights] generation failed");
    throw err;
  }

  const avgResponseTime = computeAvgResponseTime(
    meaningful.map((m) => ({ role: m.role, createdAt: m.createdAt })),
  );

  const row = {
    id: uuidv4(),
    sessionId: session.id,
    userId: session.userId,
    score: clamp100(llm.score),
    confidence: clamp100(llm.confidence),
    communication: clamp100(llm.communication),
    interactivity: clamp100(llm.interactivity),
    technicalDepth: clamp100(llm.technicalDepth),
    conciseness: clamp100(llm.conciseness),
    avgResponseTime,
    interviewerMood:
      typeof llm.interviewerMood === "string" ? llm.interviewerMood.trim().slice(0, 500) : null,
    summary: typeof llm.summary === "string" ? llm.summary.trim().slice(0, 2000) : null,
    strengths: toStringArray(llm.strengths),
    improvements: toStringArray(llm.improvements),
    keyTopics: toStringArray(llm.keyTopics),
    studyAreas: toStringArray(llm.studyAreas),
    resumeGaps: toStringArray(llm.resumeGaps),
    generatedAt: new Date(),
  };

  // Idempotent insert: if a concurrent trigger already wrote the row (unique on
  // session_id), keep theirs and return it rather than erroring or overwriting.
  const inserted = await db
    .insert(sessionFeedbackTable)
    .values(row)
    .onConflictDoNothing({ target: sessionFeedbackTable.sessionId })
    .returning();

  if (inserted.length > 0) {
    return rowToShape(inserted[0]!);
  }
  // Lost the race — return the winner's row.
  const winner = await getExistingFeedback(session.id);
  return winner ?? rowToShape({ ...row } as typeof sessionFeedbackTable.$inferSelect);
}

/**
 * Fire-and-forget trigger used on session end (spec §6.5 / §8.8b: "Insights
 * generation job is triggered asynchronously"). Never throws into the caller —
 * a failed insights generation must not fail the end-session request.
 */
export function triggerSessionFeedbackAsync(session: DbSession): void {
  void generateSessionFeedback(session).catch((err) => {
    logger.warn(
      { sessionId: session.id, err },
      "[insights] async on-end generation failed (will retry on review open)",
    );
  });
}

export async function loadOwnedSession(
  userId: string,
  sessionId: string,
): Promise<DbSession | null> {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
    .limit(1);
  return session ?? null;
}
