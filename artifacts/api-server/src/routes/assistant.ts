import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import {
  assistantChatsTable,
  assistantMessagesTable,
  sessionsTable,
  questionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, or, ilike, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { streamChatComplete } from "../lib/openrouter.js";
import type { ChatMessage } from "../lib/openrouter.js";

const router: IRouter = Router();

type Citation = { id: string; question: string; sessionId?: string; companyName?: string | null };

function toFrontendMessage(m: typeof assistantMessagesTable.$inferSelect) {
  return {
    id: m.id,
    chatId: m.chatId,
    role: m.role,
    content: m.content,
    citations: m.citations ?? undefined,
    createdAt: m.createdAt,
  };
}

async function loadOwnedChat(chatId: string, userId: string) {
  const [chat] = await db
    .select()
    .from(assistantChatsTable)
    .where(and(eq(assistantChatsTable.id, chatId), eq(assistantChatsTable.userId, userId)))
    .limit(1);
  return chat;
}

// ── List chats ────────────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const chats = await db
      .select()
      .from(assistantChatsTable)
      .where(eq(assistantChatsTable.userId, userId))
      .orderBy(desc(assistantChatsTable.updatedAt));

    const counts = await db
      .select({
        chatId: assistantMessagesTable.chatId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(assistantMessagesTable)
      .where(sql`${assistantMessagesTable.chatId} in (select id from ${assistantChatsTable} where ${assistantChatsTable.userId} = ${userId})`)
      .groupBy(assistantMessagesTable.chatId);

    const countMap = new Map(counts.map((c) => [c.chatId, Number(c.count)]));

    res.json({
      data: chats.map((c) => ({
        id: c.id,
        title: c.title,
        sessionId: c.sessionId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        _count: { messages: countMap.get(c.id) ?? 0 },
      })),
    });
  } catch (err) {
    console.error("[assistant] list chats error", err);
    res.status(500).json({ error: "Failed to load chats" });
  }
});

// ── Create chat ───────────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as { title?: string };
    const id = uuidv4();
    const now = new Date();

    await db.insert(assistantChatsTable).values({
      id,
      userId,
      title: body.title?.trim() || "New Chat",
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({
      data: { id, title: body.title?.trim() || "New Chat", sessionId: null, createdAt: now, updatedAt: now },
    });
  } catch (err) {
    console.error("[assistant] create chat error", err);
    res.status(500).json({ error: "Failed to create chat" });
  }
});

// ── List user's own sessions (for the scope picker) ───────────────────────────
router.get("/sessions", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessions = await db
      .select({
        id: sessionsTable.id,
        companyName: sessionsTable.companyName,
        jobDescription: sessionsTable.jobDescription,
        status: sessionsTable.status,
        createdAt: sessionsTable.createdAt,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.userId, userId))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(100);

    res.json({ data: sessions });
  } catch (err) {
    console.error("[assistant] list sessions error", err);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

// ── Get messages for a chat ───────────────────────────────────────────────────
router.get("/:chatId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const chatId = String(req.params["chatId"] ?? "");
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    const messages = await db
      .select()
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.chatId, chatId))
      .orderBy(assistantMessagesTable.createdAt);

    res.json({ data: messages.map(toFrontendMessage) });
  } catch (err) {
    console.error("[assistant] list messages error", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// ── Rename chat ────────────────────────────────────────────────────────────────
router.patch("/:chatId/title", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const chatId = String(req.params["chatId"] ?? "");
    const body = req.body as { title?: string };
    if (!body.title?.trim()) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    await db
      .update(assistantChatsTable)
      .set({ title: body.title.trim(), updatedAt: new Date() })
      .where(eq(assistantChatsTable.id, chatId));

    res.json({ data: { id: chatId, title: body.title.trim() } });
  } catch (err) {
    console.error("[assistant] rename chat error", err);
    res.status(500).json({ error: "Failed to rename chat" });
  }
});

// ── Delete chat ────────────────────────────────────────────────────────────────
router.delete("/:chatId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const chatId = String(req.params["chatId"] ?? "");
    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    await db.delete(assistantChatsTable).where(eq(assistantChatsTable.id, chatId));
    res.json({ success: true });
  } catch (err) {
    console.error("[assistant] delete chat error", err);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// ── Scope chat to a session (or clear scope) ──────────────────────────────────
router.post("/:chatId/session", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const chatId = String(req.params["chatId"] ?? "");
    const body = req.body as { sessionId?: string | null };

    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    if (body.sessionId) {
      const [session] = await db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.id, body.sessionId), eq(sessionsTable.userId, userId)))
        .limit(1);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
    }

    await db
      .update(assistantChatsTable)
      .set({ sessionId: body.sessionId ?? null, updatedAt: new Date() })
      .where(eq(assistantChatsTable.id, chatId));

    res.json({ data: { id: chatId, sessionId: body.sessionId ?? null } });
  } catch (err) {
    console.error("[assistant] set session scope error", err);
    res.status(500).json({ error: "Failed to update chat scope" });
  }
});

/** Best-effort keyword lookup against the question bank to cite relevant prior questions. */
async function findCitations(query: string, userId: string, companyName?: string | null): Promise<Citation[]> {
  const words = query
    .split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter((w) => w.length >= 4)
    .slice(0, 6);

  if (words.length === 0) return [];

  try {
    const conditions = words.map((w) => ilike(questionsTable.question, `%${w}%`));
    const visibilityFilter = or(
      eq(questionsTable.visibility, "public"),
      eq(questionsTable.contributorUserId, userId),
    );

    const rows = await db
      .select({
        id: questionsTable.id,
        question: questionsTable.question,
        sessionId: questionsTable.sessionId,
        company: questionsTable.company,
      })
      .from(questionsTable)
      .where(and(visibilityFilter, or(...conditions)))
      .orderBy(desc(questionsTable.upvotes))
      .limit(companyName ? 8 : 5);

    const ranked = companyName
      ? rows.sort((a, b) => {
          const aMatch = a.company?.toLowerCase() === companyName.toLowerCase() ? 1 : 0;
          const bMatch = b.company?.toLowerCase() === companyName.toLowerCase() ? 1 : 0;
          return bMatch - aMatch;
        })
      : rows;

    return ranked.slice(0, 5).map((r) => ({
      id: r.id,
      question: r.question,
      sessionId: r.sessionId ?? undefined,
      companyName: r.company,
    }));
  } catch (err) {
    console.error("[assistant] findCitations error", err);
    return [];
  }
}

function sseWrite(res: import("express").Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Send a message and stream the AI response ─────────────────────────────────
router.post("/:chatId/query", requireAuth, async (req, res) => {
  const chatId = String(req.params["chatId"] ?? "");
  try {
    const userId = req.userId!;
    const body = req.body as { query?: string; aiModel?: string };
    const query = body.query?.trim();

    if (!query) {
      res.status(400).json({ error: "Query is required" });
      return;
    }

    const chat = await loadOwnedChat(chatId, userId);
    if (!chat) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }

    let scopedSession: typeof sessionsTable.$inferSelect | undefined;
    if (chat.sessionId) {
      const [session] = await db
        .select()
        .from(sessionsTable)
        .where(and(eq(sessionsTable.id, chat.sessionId), eq(sessionsTable.userId, userId)))
        .limit(1);
      scopedSession = session;
    }

    const now = new Date();
    await db.insert(assistantMessagesTable).values({
      id: uuidv4(),
      chatId,
      role: "USER",
      content: query,
      createdAt: now,
    });

    const citations = await findCitations(query, userId, scopedSession?.companyName);

    const history = await db
      .select()
      .from(assistantMessagesTable)
      .where(eq(assistantMessagesTable.chatId, chatId))
      .orderBy(desc(assistantMessagesTable.createdAt))
      .limit(20);

    const systemPromptParts = [
      "You are HireShade's AI career assistant. Help the user prepare for interviews, review their performance, and answer career-related questions clearly and concisely.",
    ];
    if (scopedSession) {
      systemPromptParts.push(
        `This conversation is scoped to a specific interview session: company "${scopedSession.companyName || "unknown"}", role/context: ${scopedSession.jobDescription?.slice(0, 300) || "n/a"}. Tailor answers to this context when relevant.`,
      );
    }
    if (citations.length > 0) {
      systemPromptParts.push(
        `Relevant question-bank entries you may reference: ${citations.map((c) => `"${c.question}"`).join("; ")}.`,
      );
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPromptParts.join("\n\n") },
      ...history
        .slice()
        .reverse()
        .slice(0, -1) // exclude the user message we just inserted (added explicitly below)
        .map((m) => ({
          role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        })),
      { role: "user", content: query },
    ];

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    let full = "";
    try {
      full = await streamChatComplete({ model: body.aiModel, messages, maxTokens: 1200 }, (chunk) => {
        sseWrite(res, { content: chunk });
      });
    } catch (streamErr) {
      console.error("[assistant] stream error", streamErr);
      sseWrite(res, { error: "AI generation failed. Please try again." });
      res.end();
      return;
    }

    await db.insert(assistantMessagesTable).values({
      id: uuidv4(),
      chatId,
      role: "ASSISTANT",
      content: full,
      citations: citations.length > 0 ? citations : undefined,
      createdAt: new Date(),
    });

    await db
      .update(assistantChatsTable)
      .set({ updatedAt: new Date() })
      .where(eq(assistantChatsTable.id, chatId));

    sseWrite(res, { done: true });
    res.end();
  } catch (err) {
    console.error("[assistant] query error", err);
    if (res.headersSent) {
      sseWrite(res, { error: "Something went wrong." });
      res.end();
    } else {
      res.status(500).json({ error: "Failed to process query" });
    }
  }
});

export default router;
