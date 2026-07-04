import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionsTable, sessionMessagesTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middlewares/requireAuth.js";
import { streamChatComplete } from "../lib/openrouter.js";
import { buildInterviewSystemPrompt } from "../lib/interviewPrompt.js";
import { getResumeContextById } from "../lib/resumeContext.js";
import type { ChatMessage } from "../lib/openrouter.js";
import { chargeOr402 } from "../lib/featureCredits.js";
import { getSessionGrounding } from "../lib/sessionGrounding.js";

const router: IRouter = Router();

const ASK_AI_MAX_TOKENS = Number.isFinite(Number(process.env["ASK_AI_MAX_TOKENS"]))
  ? Math.max(300, Math.floor(Number(process.env["ASK_AI_MAX_TOKENS"])))
  : 1000;
const MAX_TRANSCRIPT_CHARS = 8_000;
const MAX_HISTORY_MESSAGES = 16;

function compactText(value: unknown, maxChars: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function toAskAiMessage(message: typeof sessionMessagesTable.$inferSelect) {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.answer || message.content || "",
    timestamp: message.createdAt,
  };
}

async function getOwnedSession(sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
    .limit(1);
  return session;
}

async function getSessionTranscript(sessionId: string): Promise<string> {
  const messages = await db
    .select()
    .from(sessionMessagesTable)
    .where(eq(sessionMessagesTable.sessionId, sessionId))
    .orderBy(sessionMessagesTable.createdAt);

  return messages
    .filter((m) => m.source !== "ask_ai")
    .map((m) => {
      const role = m.role === "assistant" ? "AI answer" : m.role || "transcript";
      const text = m.question && m.answer
        ? `Question: ${m.question}\nAnswer: ${m.answer}`
        : m.content || m.answer || m.question || "";
      return `${role}: ${text}`.trim();
    })
    .filter(Boolean)
    .join("\n")
    .slice(-MAX_TRANSCRIPT_CHARS);
}

router.get("/:sessionId/history", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["sessionId"] ?? "");
    const session = await getOwnedSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messages = await db
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.source, "ask_ai")))
      .orderBy(sessionMessagesTable.createdAt);

    res.json({ success: true, data: messages.map(toAskAiMessage) });
  } catch (err) {
    console.error("[ask-ai] history error", err);
    res.status(500).json({ error: "Failed to fetch Ask AI history" });
  }
});

router.delete("/:sessionId/history", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["sessionId"] ?? "");
    const session = await getOwnedSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messages = await db
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.source, "ask_ai")));

    for (const message of messages) {
      await db.delete(sessionMessagesTable).where(eq(sessionMessagesTable.id, message.id));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[ask-ai] clear history error", err);
    res.status(500).json({ error: "Failed to clear Ask AI history" });
  }
});

router.post("/:sessionId/query", requireAuth, async (req, res) => {
  let userMessageId: string | null = null;
  let assistantMessageId: string | null = null;
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["sessionId"] ?? "");
    const query = compactText((req.body as { query?: string }).query, 1_500);
    if (!query) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    const session = await getOwnedSession(sessionId, userId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const resumeContext = await getResumeContextById(session.resumeId, userId);
    const grounding = await getSessionGrounding(session);
    const transcript = await getSessionTranscript(sessionId);
    const askHistory = await db
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.source, "ask_ai")))
      .orderBy(desc(sessionMessagesTable.createdAt))
      .limit(MAX_HISTORY_MESSAGES);

    userMessageId = uuidv4();
    await db.insert(sessionMessagesTable).values({
      id: userMessageId,
      sessionId,
      role: "user",
      content: query,
      source: "ask_ai",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const systemPrompt = [
      buildInterviewSystemPrompt({
        session,
        resumeContext,
        projectContext: grounding.projectContext,
        documentContext: grounding.documentContext,
        // No forced answerMode: previously this hardcoded "system_design",
        // which framed EVERY review-page question (behavioral, HR, coding,
        // clarifications...) as a system-design discussion. The base prompt
        // already adapts depth/style to the question type.
      }),
      "You are answering inside the session review Ask AI workspace.",
      "Use only the session context, transcript, prior generated answers, resume/project/JD context, and the user's question.",
      "Be practical and specific. Do not invent transcript details. If something is absent, say it is not visible in the saved transcript.",
      "Use clean markdown. Include code blocks only when useful.",
    ].join("\n\n");

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    if (transcript) {
      messages.push({ role: "user", content: `=== SAVED SESSION TRANSCRIPT / ANSWERS ===\n${transcript}` });
    }
    for (const m of askHistory.reverse()) {
      const content = compactText(m.answer || m.content, 1_000);
      if (!content) continue;
      messages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }
    messages.push({ role: "user", content: query });

    // Charge (if priced) BEFORE the SSE header flush, same upfront pattern as
    // the other streaming AI routes — keeps a 402 a clean JSON response.
    const _meter = await chargeOr402(res, {
      userId,
      operation: "ask_ai_query",
      idempotencyKey: req.header("Idempotency-Key") ?? null,
      sessionId,
      aiModel: session.aiModel ?? null,
    });
    if (!_meter) return;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullAnswer = "";
    await streamChatComplete(
      { model: session.aiModel, messages, maxTokens: ASK_AI_MAX_TOKENS, temperature: 0.5 },
      (chunk) => {
        fullAnswer += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      },
    );

    assistantMessageId = uuidv4();
    await db.insert(sessionMessagesTable).values({
      id: assistantMessageId,
      sessionId,
      role: "assistant",
      content: fullAnswer,
      answer: fullAnswer,
      aiModel: session.aiModel,
      source: "ask_ai",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[ask-ai] query error", err);
    if (userMessageId) {
      await db.delete(sessionMessagesTable).where(eq(sessionMessagesTable.id, userMessageId)).catch(() => undefined);
    }
    if (assistantMessageId) {
      await db.delete(sessionMessagesTable).where(eq(sessionMessagesTable.id, assistantMessageId)).catch(() => undefined);
    }
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Ask AI failed" })}\n\n`);
      res.end();
    } else {
      res.status(502).json({ error: "Ask AI failed" });
    }
  }
});

export default router;
