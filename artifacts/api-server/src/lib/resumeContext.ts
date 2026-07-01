import { db } from "@workspace/db";
import { resumesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
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

export async function getResumeContextById(resumeId: string | null | undefined): Promise<string> {
  if (!resumeId) return "";
  const resume = await getResumeById(resumeId);
  if (!resume) return "";
  return getResumeContextText(resume);
}

export async function getResumeById(resumeId: string): Promise<Resume | undefined> {
  const [resume] = await db
    .select()
    .from(resumesTable)
    .where(eq(resumesTable.id, resumeId))
    .limit(1);
  return resume;
}

export type { Resume };
