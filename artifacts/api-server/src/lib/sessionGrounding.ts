import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@workspace/db";
import { documentsTable, projectsTable, type DbSession } from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Session grounding context (spec: answers must use Resume, AI Project,
 * uploaded Documents, JD, Session Prompt).
 *
 * The session wizard already collects projectIds/primaryProjectId and a
 * documentId, but until now that selection was silently dropped — the answer
 * engine only ever received resume + JD + custom prompt. This helper resolves
 * the selected project(s) and document into bounded plain text so the system
 * prompt can actually ground answers in them.
 *
 * Follows the same resilience contract as resumeContext: returns "" on any
 * failure (missing file, unsupported type, bad JSON) rather than throwing, so
 * a broken grounding source degrades to "answer without it" instead of
 * failing the whole AI request.
 */

const MAX_PROJECT_CHARS = 4_000;
const MAX_DOCUMENT_CHARS = 6_000;

function jsonToText(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => jsonToText(v, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value === "object" && depth < 4) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith("_")) continue;
      const text = jsonToText(v, depth + 1);
      if (text.trim()) lines.push(`${k}: ${text.trim()}`);
    }
    return lines.join("\n");
  }
  return "";
}

/** Resolve the session's selected AI project(s) into prompt-ready text. */
export async function getProjectContext(session: DbSession): Promise<string> {
  try {
    const ids = new Set<string>();
    if (session.primaryProjectId) ids.add(session.primaryProjectId);
    for (const id of session.projectIds ?? []) ids.add(id);
    if (ids.size === 0) return "";

    const rows = await db
      .select()
      .from(projectsTable)
      .where(
        and(
          inArray(projectsTable.id, [...ids]),
          eq(projectsTable.userId, session.userId),
        ),
      );
    if (rows.length === 0) return "";

    // Primary project first, then the rest in selection order.
    rows.sort((a, b) => {
      if (a.id === session.primaryProjectId) return -1;
      if (b.id === session.primaryProjectId) return 1;
      return 0;
    });

    const blocks = rows.map((p) => {
      const parts = [
        `Project: ${p.title}`,
        p.roleType ? `Role type: ${p.roleType}` : "",
        p.description ? `Description: ${p.description}` : "",
        p.content ? jsonToText(p.content) : "",
      ].filter(Boolean);
      return parts.join("\n");
    });

    return blocks.join("\n\n---\n\n").slice(0, MAX_PROJECT_CHARS);
  } catch (err) {
    logger.warn({ sessionId: session.id, err }, "[grounding] project context failed");
    return "";
  }
}

async function extractDocumentText(filePath: string, mimeType?: string | null): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mt = (mimeType ?? "").toLowerCase();

  if (ext === ".pdf" || mt.includes("pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);
    return result.text ?? "";
  }
  if ([".txt", ".md", ".csv", ".json"].includes(ext) || mt.startsWith("text/")) {
    return await fs.readFile(filePath, "utf8");
  }
  // Unsupported binary type (docx etc.) — degrade gracefully.
  return "";
}

/** Resolve the session's selected uploaded document into prompt-ready text. */
export async function getDocumentContext(session: DbSession): Promise<string> {
  try {
    if (!session.documentId) return "";
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.id, session.documentId),
          eq(documentsTable.userId, session.userId),
        ),
      )
      .limit(1);
    if (!doc?.path) return "";

    const text = (await extractDocumentText(doc.path, doc.mimeType)).trim();
    if (!text) return "";
    return `Document "${doc.filename}":\n${text}`.slice(0, MAX_DOCUMENT_CHARS);
  } catch (err) {
    logger.warn({ sessionId: session.id, err }, "[grounding] document context failed");
    return "";
  }
}

export interface SessionGrounding {
  projectContext: string;
  documentContext: string;
}

/** Resolve both grounding sources in parallel. Never throws. */
export async function getSessionGrounding(session: DbSession): Promise<SessionGrounding> {
  const [projectContext, documentContext] = await Promise.all([
    getProjectContext(session),
    getDocumentContext(session),
  ]);
  return { projectContext, documentContext };
}
