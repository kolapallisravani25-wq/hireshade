import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sessionMessagesTable, sessionsTable } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

const router: IRouter = Router();

router.get("/:sessionId/array", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["sessionId"] ?? "");
    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);
    if (!session) {
      res.status(404).json([]);
      return;
    }
    const messages = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.sessionId, sessionId))
      .orderBy(sessionMessagesTable.createdAt);

    res.json(
      messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content || m.answer || m.question || "",
        text: m.content || m.answer || m.question || "",
        question: m.question || "",
        answer: m.answer || "",
        source: m.source || "",
        createdAt: m.createdAt,
      })),
    );
  } catch (err) {
    console.error("[session-notes-legacy] error", err);
    res.json([]);
  }
});

export default router;
