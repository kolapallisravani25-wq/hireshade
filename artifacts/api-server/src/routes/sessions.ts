import { Router, type IRouter } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import {
  sessionsTable,
  sessionMessagesTable,
  answerRevisionsTable,
} from "@workspace/db/schema";
import { eq, and, desc, ilike, gte, lte, inArray, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { streamChatComplete, chatComplete } from "../lib/openrouter.js";
import { buildInterviewSystemPrompt } from "../lib/interviewPrompt.js";
import { getResumeContextById } from "../lib/resumeContext.js";
import type { ChatMessage } from "../lib/openrouter.js";

const router: IRouter = Router();

const parsedOpenRouterMaxTokens = Number(
  process.env["OPENROUTER_MAX_TOKENS"] ?? "400",
);
const OPENROUTER_MAX_TOKENS =
  Number.isFinite(parsedOpenRouterMaxTokens) && parsedOpenRouterMaxTokens > 0
    ? Math.floor(parsedOpenRouterMaxTokens)
    : 400;

const formParser = multer().none();
const screenshotParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("screenshot");

/**
 * Cap for free sessions, in minutes. Mirrors FREE_SESSION_DURATION on the
 * client (useFreeSessionTimer). Kept here so `maxAllowedMinutes` in the
 * activate/session responses stays in sync with the countdown the UI runs.
 */
const FREE_SESSION_MINUTES = 5;

/**
 * Statuses that occupy the user's single "live session" slot. PRE_CHECK is a
 * not-yet-started draft and deliberately does NOT block (an abandoned wizard
 * must not lock the user out). Anything terminal (COMPLETED/ABANDONED/etc.)
 * is likewise free to coexist.
 */
const BLOCKING_STATUSES = ["ACTIVE", "COMPLETING"] as const;

/**
 * Returns the user's currently-live session (ACTIVE/COMPLETING), if any,
 * optionally excluding one session id (used when re-activating that same row).
 */
async function findBlockingSession(userId: string, excludeId?: string) {
  const conditions = [
    eq(sessionsTable.userId, userId),
    inArray(sessionsTable.status, [...BLOCKING_STATUSES]),
  ];
  if (excludeId) {
    conditions.push(ne(sessionsTable.id, excludeId));
  }
  const [blocking] = await db
    .select()
    .from(sessionsTable)
    .where(and(...conditions))
    .limit(1);
  return blocking;
}

function maxAllowedMinutesFor(s: typeof sessionsTable.$inferSelect) {
  return s.free ? FREE_SESSION_MINUTES : null;
}

/**
 * 409 payload for the single live-session conflict. The token is emitted under
 * BOTH `error` and `message`: the web CreateSessionDialog reads `message`, the
 * Tauri useSessionCreation hook reads `error`. Keeping both in sync makes the
 * conflict + rejoin UX fire on every surface.
 */
function activeSessionConflict(id: string) {
  const token = `ACTIVE_SESSION_EXISTS:${id}`;
  return { error: token, message: token };
}

function toFrontendSession(s: typeof sessionsTable.$inferSelect) {
  return {
    id: s.id,
    userId: s.userId,
    companyName: s.companyName,
    round: s.round,
    jobDescription: s.jobDescription,
    mode: s.mode,
    free: s.free,
    status: s.status,
    isActive: s.status === "ACTIVE",
    language: s.language,
    simpleLanguage: s.simpleLanguage,
    extraContext: s.extraContext,
    instructions: s.instructions,
    aiModel: s.aiModel,
    autoGenerateResponse: s.autoGenerateResponse,
    saveTranscription: s.saveTranscription,
    resumeId: s.resumeId,
    documentId: s.documentId,
    projectIds: s.projectIds,
    primaryProjectId: s.primaryProjectId,
    creditsDeducted: s.creditsDeducted,
    deductionReason: s.deductionReason,
    aiUsage: s.aiUsage,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    maxAllowedMinutes: maxAllowedMinutesFor(s),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    company: s.companyName ? { name: s.companyName } : undefined,
  };
}

router.post("/create-session", requireAuth, formParser, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as Record<string, string>;

    const companyName = body["companyName"] ?? "";
    const round = body["round"] || null;
    const jobDescription = body["jobDescription"] ?? "";
    const resumeId = body["resumeId"] || null;
    const documentId = body["documentId"] || null;
    const language = body["language"] ?? "English";
    const simpleLanguage = body["simpleLanguage"] === "true";
    const extraContext = body["extraContext"] ?? "";
    const instructions = body["instructions"] ?? "";
    const aiModel = body["aiModel"] ?? "anthropic/claude-haiku-4-5";
    const autoGenerateResponse = body["autoGenerateAI"] !== "false";
    const saveTranscription = body["saveTranscript"] !== "false";
    const free = body["free"] === "true";
    const questionBankContributionOptIn =
      body["questionBankContributionOptIn"] === "true";
    let projectIds: string[] = [];
    try {
      projectIds = JSON.parse(body["projectIds"] ?? "[]");
    } catch {
      projectIds = [];
    }
    const primaryProjectId = body["primaryProjectId"] || null;

    // Enforce the single live-session invariant. The client (useSessionCreation /
    // ConnectDialog) keys its conflict + rejoin UX on this exact error shape.
    const blocking = await findBlockingSession(userId);
    if (blocking) {
      res.status(409).json(activeSessionConflict(blocking.id));
      return;
    }

    const sessionId = uuidv4();
    const now = new Date();

    await db.insert(sessionsTable).values({
      id: sessionId,
      userId,
      companyName,
      round,
      jobDescription,
      mode: "manual",
      free,
      status: "PRE_CHECK",
      language,
      simpleLanguage,
      extraContext,
      instructions,
      aiModel,
      autoGenerateResponse,
      saveTranscription,
      questionBankContributionOptIn,
      resumeId,
      documentId,
      projectIds,
      primaryProjectId,
      createdAt: now,
      updatedAt: now,
    });

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);

    res.status(201).json(toFrontendSession(session!));
  } catch (err) {
    console.error("[sessions] create-session error", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.get("/list", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const search = req.query["search"] as string | undefined;
    const fromDate = req.query["from_date"] as string | undefined;
    const toDate = req.query["to_date"] as string | undefined;

    const conditions = [eq(sessionsTable.userId, userId)];
    if (search) {
      conditions.push(ilike(sessionsTable.companyName, `%${search}%`));
    }
    if (fromDate) {
      conditions.push(gte(sessionsTable.createdAt, new Date(fromDate)));
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(sessionsTable.createdAt, to));
    }

    const sessions = await db
      .select()
      .from(sessionsTable)
      .where(and(...conditions))
      .orderBy(desc(sessionsTable.createdAt));

    res.json({ data: sessions.map(toFrontendSession) });
  } catch (err) {
    console.error("[sessions] list error", err);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

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

    res.json({ ...toFrontendSession(session), messages });
  } catch (err) {
    console.error("[sessions] get error", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.status === "ACTIVE") {
      res.status(409).json({ error: "Cannot delete an active session" });
      return;
    }

    await db
      .delete(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));

    res.json({ success: true });
  } catch (err) {
    console.error("[sessions] delete error", err);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

router.post("/:id/activate", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // A *different* live session blocks activation. Re-activating this same row
    // (rejoin / DISCONNECTED → ACTIVE) is idempotent and must be allowed.
    const blocking = await findBlockingSession(userId, sessionId);
    if (blocking) {
      res.status(409).json(activeSessionConflict(blocking.id));
      return;
    }

    // Anchor the start time once. On rejoin we keep the original startedAt so
    // the timer resumes from real elapsed time instead of restarting.
    const startedAt = session.startedAt ?? new Date();

    await db
      .update(sessionsTable)
      .set({ status: "ACTIVE", startedAt, updatedAt: new Date() })
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));

    res.json({
      success: true,
      status: "ACTIVE",
      startedAt,
      maxAllowedMinutes: maxAllowedMinutesFor(session),
    });
  } catch (err) {
    console.error("[sessions] activate error", err);
    res.status(500).json({ error: "Failed to activate session" });
  }
});

router.post("/:id/heartbeat", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    await db
      .update(sessionsTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to process heartbeat" });
  }
});

router.post("/:id/deactivate", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    await db
      .update(sessionsTable)
      .set({ status: "COMPLETED", endedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)));

    res.json({ success: true, status: "COMPLETED" });
  } catch (err) {
    res.status(500).json({ error: "Failed to deactivate session" });
  }
});

router.post("/:id/save-message", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const body = req.body as {
      role?: string;
      content?: string;
      question?: string;
      answer?: string;
      aiModel?: string;
    };

    const messageId = uuidv4();
    const now = new Date();

    await db.insert(sessionMessagesTable).values({
      id: messageId,
      sessionId,
      role: body.role ?? "assistant",
      content: body.content ?? body.answer ?? "",
      question: body.question ?? null,
      answer: body.answer ?? null,
      aiModel: body.aiModel ?? null,
      createdAt: now,
      updatedAt: now,
    });

    const [message] = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, messageId))
      .limit(1);

    res.json({ success: true, data: message });
  } catch (err) {
    console.error("[sessions] save-message error", err);
    res.status(500).json({ error: "Failed to save message" });
  }
});

router.post("/:id/analyze-screen", requireAuth, screenshotParser, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: "No screenshot uploaded" });
      return;
    }

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    let contextPayload: {
      currentQuestion?: string;
      answerMode?: string;
      previousAiAnswer?: string;
      previousAiAnswers?: { question?: string; answer: string }[];
    } = {};
    try {
      contextPayload = JSON.parse((req.body?.["contextPayload"] as string) ?? "{}");
    } catch {
      // Ignore malformed context payload; proceed with defaults.
    }

    const aiModel = (req.body?.["aiModel"] as string) || session.aiModel || undefined;
    const resumeContext = await getResumeContextById(session.resumeId);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      answerMode: contextPayload.answerMode,
    });

    const base64 = file.buffer.toString("base64");
    const dataUrl = `data:${file.mimetype};base64,${base64}`;

    // Multi-question screens: tell the model explicitly what's already been
    // answered so it can identify the CURRENTLY active question (typically
    // the most recent one without a visible answer) instead of re-answering
    // something already covered.
    const alreadyAnswered = (contextPayload.previousAiAnswers ?? [])
      .filter((entry) => entry.question?.trim())
      .slice(-5)
      .map((entry, i) => `${i + 1}. ${entry.question!.trim()}`)
      .join("\n");

    const question =
      contextPayload.currentQuestion ||
      [
        "Analyze the screenshot. If multiple questions or tasks are visible, identify the ONE that is currently active — typically the most recent one that does not yet have a visible answer — and answer only that one. Do not regenerate an answer for a question already covered below.",
        alreadyAnswered ? `Already answered in this session:\n${alreadyAnswered}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    const estimatedTokens = Math.ceil((systemPrompt.length + question.length) / 4);
    console.log("[sessions] analyze-screen context", {
      sessionId,
      systemPromptChars: systemPrompt.length,
      questionChars: question.length,
      previousAnswersIncluded: contextPayload.previousAiAnswers?.length ?? 0,
      estimatedTokens,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    res.write(`**QUESTION:** ${contextPayload.currentQuestion || "Screen analysis"}\n**ANSWER:** `);

    await streamChatComplete({ model: aiModel, messages, maxTokens: OPENROUTER_MAX_TOKENS }, (chunk) => {
      res.write(chunk);
    });
    res.end();
  } catch (err) {
    console.error("[sessions] analyze-screen error", err);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({ error: "Failed to analyze screen" });
    }
  }
});

router.post("/:id/ai-answer", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
      .limit(1);

    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const body = req.body as {
      transcript?: string;
      currentQuestion?: string;
      patchedTranscript?: string;
      previousAiAnswer?: string;
      regenerateInstruction?: string;
      answerMode?: string;
      aiModel?: string;
    };

    const question =
      body.patchedTranscript?.trim() ||
      body.currentQuestion?.trim() ||
      body.transcript?.trim() ||
      "";

    if (!question) {
      res.status(400).json({ error: "No question or transcript provided" });
      return;
    }

    const resumeContext = await getResumeContextById(session.resumeId);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      answerMode: body.answerMode,
    });

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    if (body.previousAiAnswer) {
      messages.push({ role: "assistant", content: body.previousAiAnswer });
    }
    if (body.regenerateInstruction) {
      messages.push({
        role: "user",
        content: `Revise the previous answer per this instruction: ${body.regenerateInstruction}\n\nOriginal question: ${question}`,
      });
    } else {
      messages.push({ role: "user", content: question });
    }

    const aiModel = body.aiModel || session.aiModel || undefined;

    const promptChars = messages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
      0,
    );
    console.log("[sessions] ai-answer context", {
      sessionId,
      questionChars: question.length,
      messageCount: messages.length,
      promptChars,
      estimatedTokens: Math.ceil(promptChars / 4),
      isRegenerate: !!body.regenerateInstruction,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    res.write(`**QUESTION:** ${question}\n**ANSWER:** `);

    await streamChatComplete({ model: aiModel, messages, maxTokens: OPENROUTER_MAX_TOKENS }, (chunk) => {
      res.write(chunk);
    });
    res.end();
  } catch (err) {
    console.error("[sessions] ai-answer error", err);
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({ error: "Failed to generate answer" });
    }
  }
});

router.get("/:id/analytics", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

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
      .where(eq(sessionMessagesTable.sessionId, sessionId));

    res.json({
      success: true,
      data: {
        sessionId,
        totalMessages: messages.length,
        duration: session.endedAt
          ? Math.round((session.endedAt.getTime() - session.createdAt.getTime()) / 1000)
          : null,
        creditsDeducted: session.creditsDeducted,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

router.get("/:id/events", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const keepAlive = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 30000);

  req.on("close", () => {
    clearInterval(keepAlive);
    res.end();
  });
});

// ── Answer endpoints (require auth — called from AskAIWorkspace) ──────────────

router.get("/:sessionId/answers/:messageId", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params["sessionId"] ?? "");
    const messageId = String(req.params["messageId"] ?? "");

    const [message] = await db
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
        ),
      )
      .limit(1);

    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch answer" });
  }
});

router.patch("/:sessionId/answers/:messageId", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params["sessionId"] ?? "");
    const messageId = String(req.params["messageId"] ?? "");

    const body = req.body as {
      answer: string;
      baseVersion: number;
      source: string;
      aiMode?: string;
      instruction?: string;
      model?: string;
    };

    const [existing] = await db
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const newVersion = existing.currentVersion + 1;

    await db.insert(answerRevisionsTable).values({
      id: uuidv4(),
      messageId,
      sessionId,
      version: existing.currentVersion,
      question: existing.question ?? "",
      answer: existing.answer ?? "",
      source: body.source,
      aiMode: body.aiMode ?? null,
      instruction: body.instruction ?? null,
      model: body.model ?? null,
    });

    await db
      .update(sessionMessagesTable)
      .set({
        answer: body.answer,
        content: body.answer,
        currentVersion: newVersion,
        updatedAt: new Date(),
      })
      .where(eq(sessionMessagesTable.id, messageId));

    const revisionId = uuidv4();
    await db.insert(answerRevisionsTable).values({
      id: revisionId,
      messageId,
      sessionId,
      version: newVersion,
      question: existing.question ?? "",
      answer: body.answer,
      source: body.source,
      aiMode: body.aiMode ?? null,
      instruction: body.instruction ?? null,
      model: body.model ?? null,
    });

    res.json({
      success: true,
      data: {
        answer: body.answer,
        currentVersion: newVersion,
        revisionId,
      },
    });
  } catch (err) {
    console.error("[sessions] patch answer error", err);
    res.status(500).json({ error: "Failed to update answer" });
  }
});

router.get("/:sessionId/answers/:messageId/revisions", requireAuth, async (req, res) => {
  try {
    const messageId = String(req.params["messageId"] ?? "");

    const [message] = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, messageId))
      .limit(1);

    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const revisions = await db
      .select()
      .from(answerRevisionsTable)
      .where(eq(answerRevisionsTable.messageId, messageId))
      .orderBy(desc(answerRevisionsTable.version));

    res.json({
      success: true,
      data: {
        answer: message.answer ?? "",
        currentVersion: message.currentVersion,
        revisions,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch revisions" });
  }
});

router.post(
  "/:sessionId/answers/:messageId/revisions/:revisionId/restore",
  requireAuth,
  async (req, res) => {
    try {
      const messageId = String(req.params["messageId"] ?? "");
      const revisionId = String(req.params["revisionId"] ?? "");
      const sessionId = String(req.params["sessionId"] ?? "");

      const [revision] = await db
        .select()
        .from(answerRevisionsTable)
        .where(eq(answerRevisionsTable.id, revisionId))
        .limit(1);

      if (!revision) {
        res.status(404).json({ error: "Revision not found" });
        return;
      }

      const [existing] = await db
        .select()
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.id, messageId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Message not found" });
        return;
      }

      const newVersion = existing.currentVersion + 1;
      const newRevisionId = uuidv4();

      await db
        .update(sessionMessagesTable)
        .set({
          answer: revision.answer,
          content: revision.answer,
          currentVersion: newVersion,
          updatedAt: new Date(),
        })
        .where(eq(sessionMessagesTable.id, messageId));

      await db.insert(answerRevisionsTable).values({
        id: newRevisionId,
        messageId,
        sessionId,
        version: newVersion,
        question: revision.question,
        answer: revision.answer,
        source: "restored",
      });

      res.json({
        success: true,
        data: {
          answer: revision.answer,
          currentVersion: newVersion,
          revisionId: newRevisionId,
        },
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to restore revision" });
    }
  },
);

router.post("/:sessionId/answers/:messageId/ai-preview", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params["sessionId"] ?? "");
    const messageId = String(req.params["messageId"] ?? "");

    const [session] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);

    const [message] = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, messageId))
      .limit(1);

    if (!session || !message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const body = req.body as { instruction?: string; mode?: string; model?: string };

    const resumeContext = await getResumeContextById(session.resumeId);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      answerMode: body.mode,
    });

    const instruction = body.instruction?.trim() || "Improve and polish this answer.";
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Question: ${message.question ?? ""}\n\nCurrent answer:\n${message.answer ?? ""}\n\nInstruction: ${instruction}\n\nReturn only the revised answer text.`,
      },
    ];

    const answer = await chatComplete({
      model: body.model || session.aiModel,
      messages,
      maxTokens: OPENROUTER_MAX_TOKENS,
    });

    res.json({ success: true, data: { answer } });
  } catch (err) {
    console.error("[sessions] ai-preview error", err);
    res.status(500).json({ error: "Failed to preview answer" });
  }
});

export default router;
