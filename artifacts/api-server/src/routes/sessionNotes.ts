import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionsTable, sessionMessagesTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/:sessionId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["sessionId"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const messages = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.sessionId, sessionId))
      .orderBy(sessionMessagesTable.createdAt);

    const transcript = messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content ?? "",
      text: m.content ?? m.answer ?? m.question ?? "",
      question: m.question ?? null,
      answer: m.answer ?? null,
      source: m.source ?? null,
      aiModel: m.aiModel ?? null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));

    const summary = {
      sessionId,
      totalMessages: transcript.length,
      totalAiAnswers: transcript.filter((m) => m.role === "assistant" || m.answer).length,
      status: session.status,
      endedAt: session.endedAt,
    };

    // Compatibility response:
    // Older frontend code calls `response.data.map(...)`, while newer code may
    // call `response.data.transcript.map(...)`. Return both shapes to prevent
    // runtime crashes while Session Engine v2 is being rebuilt.
    res.json({
      success: true,
      data: transcript,
      transcript,
      messages: transcript,
      notes: transcript,
      summary,
      meta: summary,
    });
  } catch (err) {
    console.error("[session-notes] fetch error", err);
    res.status(500).json({ error: "Failed to fetch session notes" });
  }
});

export default router;
