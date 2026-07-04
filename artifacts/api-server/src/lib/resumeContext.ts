import { db } from "@workspace/db";
import { resumesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { readResumeObject } from "./resumeStorage.js";
import { logger } from "./logger.js";

type Resume = typeof resumesTable.$inferSelect;

export function fieldsToText(fields: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith("_") || !value) continue;
    if (typeof value === "string" && value.trim()) {
      lines.push(`${key}: ${value.trim()}`);
    }
  }
  return lines.join("\n");
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return result.text.trim();
}

/**
 * Resolves a resume to plain-text context for AI prompts.
 *  - Builder resumes: serializes the structured `fields` JSON.
 *  - Uploaded resumes: returns cached `resumeContext`, or extracts text
 *    from the stored PDF (via object storage) and caches it.
 * Returns "" on any failure rather than throwing, so callers can proceed
 * without resume context instead of hard-failing the whole AI request.
 */
export async function getResumeContextText(resume: Resume): Promise<string> {
  if (resume.source === "builder") {
    return resume.fields ? fieldsToText(resume.fields) : "";
  }

  if (resume.resumeContext?.trim()) {
    return resume.resumeContext;
  }

  if (!resume.path) return "";

  try {
    const buffer = await readResumeObject(resume.path);
    const text = await extractPdfText(buffer);

    if (text) {
      await db
        .update(resumesTable)
        .set({ resumeContext: text })
        .where(eq(resumesTable.id, resume.id));
    }
    return text;
  } catch (err) {
    logger.warn({ err, resumeId: resume.id }, "[resumeContext] extraction failed");
    return "";
  }
}

/**
 * SECURITY: ownership is mandatory. Resume ids arrive from the client (or from
 * session rows that stored a client-supplied id at creation), so every lookup
 * must be scoped to the requesting user — otherwise any user who obtains
 * another user's resume id could ground AI answers, ATS scores, and cover
 * letters in someone else's resume (cross-user PII exposure). The userId
 * parameter is deliberately required, not optional, so the compiler forces
 * every current and future caller to make the ownership decision explicitly.
 */
export async function getResumeContextById(
  resumeId: string | null | undefined,
  userId: string,
): Promise<string> {
  if (!resumeId) return "";
  const resume = await getResumeById(resumeId, userId);
  if (!resume) return "";
  return getResumeContextText(resume);
}

export async function getResumeById(resumeId: string, userId: string): Promise<Resume | undefined> {
  const [resume] = await db
    .select()
    .from(resumesTable)
    .where(and(eq(resumesTable.id, resumeId), eq(resumesTable.userId, userId)))
    .limit(1);
  return resume;
}

export type { Resume };
