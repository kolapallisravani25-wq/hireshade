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
import {
  settleSession,
  isTerminalStatus,
  elapsedMinutes,
  getAvailableCredits,
  CREDITS_PER_MINUTE,
  GRACE_ZONE_MINUTES,
  FREE_SESSION_MINUTES,
  STALE_ACTIVE_MS,
} from "../lib/sessionCredits.js";
import { getSessionGrounding } from "../lib/sessionGrounding.js";
import {
  generateSessionFeedback,
  getExistingFeedback,
  triggerSessionFeedbackAsync,
  loadOwnedSession,
} from "../lib/sessionFeedback.js";

const router: IRouter = Router();

const parsedOpenRouterMaxTokens = Number(
  process.env["OPENROUTER_MAX_TOKENS"] ?? "1200",
);
const OPENROUTER_MAX_TOKENS =
  Number.isFinite(parsedOpenRouterMaxTokens) && parsedOpenRouterMaxTokens > 0
    ? Math.floor(parsedOpenRouterMaxTokens)
    : 1200;

const formParser = multer().none();
const screenshotParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("screenshot");

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
 *
 * STALE-SESSION REAPER: an ACTIVE session whose `updatedAt` hasn't been
 * bumped in STALE_ACTIVE_MS (heartbeats bump it every 60 s) means the client
 * crashed / lost power / was killed without deactivating. Previously such a
 * zombie blocked ALL new sessions until manually cleared. Now it is
 * auto-settled (AUTO_ENDED, billed up to its last heartbeat) and no longer
 * blocks. COMPLETING rows past the threshold are finalized the same way.
 */
async function findBlockingSession(userId: string, excludeId?: string) {
  const conditions = [
    eq(sessionsTable.userId, userId),
    inArray(sessionsTable.status, [...BLOCKING_STATUSES]),
  ];
  if (excludeId) {
    conditions.push(ne(sessionsTable.id, excludeId));
  }
  const candidates = await db
    .select()
    .from(sessionsTable)
    .where(and(...conditions));

  const now = Date.now();
  for (const candidate of candidates) {
    const lastSeen = candidate.updatedAt?.getTime() ?? 0;
    if (now - lastSeen > STALE_ACTIVE_MS) {
      try {
        // Bill only up to the moment the client was last known alive.
        await settleSession({
          session: candidate,
          endedAt: candidate.updatedAt ?? new Date(),
          reason: "AUTO_ENDED",
        });
        console.log(
          "[sessions] reaped stale live session",
          candidate.id,
          "last seen",
          candidate.updatedAt,
        );
        continue; // reaped — no longer blocking
      } catch (err) {
        console.error("[sessions] failed to reap stale session", candidate.id, err);
        return candidate; // settlement failed — keep blocking (fail safe)
      }
    }
    return candidate; // genuinely live → blocks
  }
  return undefined;
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

    // A session that already ended can never be re-activated — otherwise a
    // stale tab could resurrect a settled session and evade billing.
    if (isTerminalStatus(session.status)) {
      res.status(409).json({
        error: "SESSION_ALREADY_ENDED",
        message: "SESSION_ALREADY_ENDED",
        status: session.status,
      });
      return;
    }

    // A *different* live session blocks activation. Re-activating this same row
    // (rejoin / DISCONNECTED → ACTIVE) is idempotent and must be allowed.
    const blocking = await findBlockingSession(userId, sessionId);
    if (blocking) {
      res.status(409).json(activeSessionConflict(blocking.id));
      return;
    }

    // Paid sessions require at least one billable minute of credit beyond the
    // grace zone — otherwise metering would let a zero-balance user run
    // indefinitely inside repeated grace windows.
    if (!session.free) {
      const { total: available } = await getAvailableCredits(userId);
      if (available < CREDITS_PER_MINUTE) {
        res.status(402).json({
          error: "INSUFFICIENT_CREDITS",
          message: "INSUFFICIENT_CREDITS",
          available: String(available),
        });
        return;
      }
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

/**
 * Heartbeat — the client posts every 60 s while a session is live.
 * Responsibilities:
 *  1. Liveness: bump `updatedAt` so the stale-session reaper knows the
 *     client is alive (this now applies to FREE sessions too).
 *  2. Free cap: server-side enforcement of FREE_SESSION_MINUTES — a free
 *     session past its cap (+1 min tolerance for clock skew) is settled and
 *     the client is told to stop.
 *  3. Credits: for paid sessions, compute the accrued cost and emit
 *     CREDIT_WARNING / CREDIT_EXHAUSTED per the contract the client's
 *     useSessionHeartbeat hook already implements.
 */
router.post("/:id/heartbeat", requireAuth, async (req, res) => {
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

    // Session already ended (another device / exhausted / reaped) — tell the
    // client to stop heartbeating and clean up.
    if (session.status !== "ACTIVE") {
      res.json({ success: false, action: "SESSION_NOT_ACTIVE", status: session.status });
      return;
    }

    const now = new Date();
    const elapsed = elapsedMinutes(session.startedAt, now);

    // Free-session cap (server-side; client timer is advisory only).
    if (session.free && elapsed > FREE_SESSION_MINUTES + 1) {
      const settled = await settleSession({
        session,
        endedAt: now,
        reason: "AUTO_ENDED",
      });
      res.json({ success: true, action: "TIME_EXHAUSTED", status: settled.status });
      return;
    }

    if (!session.free) {
      const { total: available } = await getAvailableCredits(userId);
      const accrued =
        elapsed > GRACE_ZONE_MINUTES ? elapsed * CREDITS_PER_MINUTE : 0;

      if (accrued > 0 && accrued >= available + CREDITS_PER_MINUTE) {
        // Cost has overtaken the balance — force-end and settle (charges
        // whatever remains, marks CREDIT_EXHAUSTED if it can't cover).
        const settled = await settleSession({
          session,
          endedAt: now,
          reason: "FORCE_ENDED",
        });
        res.json({
          success: true,
          action: "CREDIT_EXHAUSTED",
          status: settled.status,
          creditsDeducted: settled.creditsDeducted,
        });
        return;
      }

      // Liveness bump BEFORE responding so the reaper never races a live client.
      await db
        .update(sessionsTable)
        .set({ updatedAt: now })
        .where(eq(sessionsTable.id, sessionId));

      const remainingMinutes = Math.max(
        0,
        Math.floor((available - accrued) / CREDITS_PER_MINUTE),
      );
      if (remainingMinutes <= 5) {
        res.json({
          success: true,
          action: "CREDIT_WARNING",
          remainingMinutes: Math.max(1, remainingMinutes),
        });
        return;
      }

      res.json({ success: true, remainingMinutes });
      return;
    }

    // Live free session within its cap — just bump liveness.
    await db
      .update(sessionsTable)
      .set({ updatedAt: now })
      .where(eq(sessionsTable.id, sessionId));

    res.json({
      success: true,
      remainingMinutes: Math.max(0, FREE_SESSION_MINUTES - elapsed),
    });
  } catch (err) {
    console.error("[sessions] heartbeat error", err);
    res.status(500).json({ error: "Failed to process heartbeat" });
  }
});

/**
 * Deactivate — the terminal "end session" call. Implements the full contract
 * the client already speaks:
 *   body: { transcript?, aiUsage?, durationMinutes? }
 *   response: { success, status, creditsDeducted, deductionReason, minutes }
 *
 * Guarantees:
 *  - 404 for unknown/foreign sessions (previously returned success:true —
 *    which hid the exact failure mode that left sessions stuck ACTIVE).
 *  - Idempotent: repeated calls (retry button, double click, heartbeat race)
 *    never double-charge — settlement claims the row transactionally.
 *  - Transcript persistence: when the session opted into saveTranscription,
 *    the raw live transcript is upserted as a single role="transcript"
 *    message row so the review page can show it.
 */
router.post("/:id/deactivate", requireAuth, async (req, res) => {
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

    const body = (req.body ?? {}) as {
      transcript?: string;
      aiUsage?: number;
      durationMinutes?: number;
    };

    // Persist the live transcript (idempotent). The client sends lines in the
    // form "[User]: ..." / "[Interviewer]: ..." — parse them into individual
    // USER / INTERVIEWER message rows, which is exactly what the review page's
    // TranscriptDialog renders natively. Idempotency: transcript rows are only
    // written while the session is still non-terminal AND none exist yet, so a
    // retried deactivate can't duplicate them. Ephemeral sessions never send one.
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (transcript && session.saveTranscription && !isTerminalStatus(session.status)) {
      const [existingTranscript] = await db
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            inArray(sessionMessagesTable.role, ["USER", "INTERVIEWER", "transcript"]),
          ),
        )
        .limit(1);

      if (!existingTranscript) {
        const base = Date.now();
        const rows = transcript
          .split("\n")
          .map((line, i) => {
            const m = line.match(/^\[([^\]]+)\]:\s*(.*)$/);
            if (!m || !m[2]?.trim()) return null;
            const senderRaw = m[1]!.trim().toLowerCase();
            const role =
              senderRaw === "user"
                ? "USER"
                : senderRaw === "interviewer"
                  ? "INTERVIEWER"
                  : null;
            if (!role) return null; // AI lines are already saved via save-message
            return {
              id: uuidv4(),
              sessionId,
              role,
              content: m[2]!.trim(),
              source: "live",
              // Preserve ordering: 1 ms apart so createdAt sorts correctly.
              createdAt: new Date(base + i),
              updatedAt: new Date(base + i),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        if (rows.length > 0) {
          await db.insert(sessionMessagesTable).values(rows);
        }
      }
    }

    const settled = await settleSession({
      session,
      endedAt: new Date(),
      reason: "COMPLETED",
      aiUsage: typeof body.aiUsage === "number" ? body.aiUsage : null,
    });

    // Spec §6.5 / §8.8b: insights generation is triggered asynchronously on
    // session end. Fire-and-forget — a slow/failed model call must never fail
    // or delay the end-session response; the review page will regenerate on
    // open if this didn't complete. Only worth triggering when the session
    // actually reached a terminal (settled) state with a saved transcript.
    if (isTerminalStatus(settled.status) && session.saveTranscription) {
      triggerSessionFeedbackAsync({ ...session, status: settled.status, endedAt: new Date() });
    }

    res.json({
      success: true,
      status: settled.status,
      creditsDeducted: settled.creditsDeducted,
      deductionReason: settled.deductionReason,
      minutes: settled.minutes,
    });
  } catch (err) {
    console.error("[sessions] deactivate error", err);
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
      messageId?: string;
      role?: string;
      content?: string;
      question?: string;
      answer?: string;
      aiModel?: string;
    };

    // Use the client-supplied id when present. This is what makes the write
    // IDEMPOTENT: the desktop retries a failed save-message with the same id,
    // and it must not create a duplicate row. It also keeps the client's local
    // message id in sync with the persisted row so the later transcript PATCH
    // (which addresses messages by that id) resolves. Fall back to a generated
    // id only for legacy callers that don't send one.
    const messageId =
      typeof body.messageId === "string" && body.messageId.trim()
        ? body.messageId.trim()
        : uuidv4();
    const now = new Date();

    await db
      .insert(sessionMessagesTable)
      .values({
        id: messageId,
        sessionId,
        role: body.role ?? "assistant",
        content: body.content ?? body.answer ?? "",
        question: body.question ?? null,
        answer: body.answer ?? null,
        aiModel: body.aiModel ?? null,
        createdAt: now,
        updatedAt: now,
      })
      // Idempotent: a retry of the same message id updates in place rather
      // than inserting a duplicate. Content is refreshed because a retry may
      // carry a richer/cleaner version of the same utterance.
      .onConflictDoUpdate({
        target: sessionMessagesTable.id,
        set: {
          content: body.content ?? body.answer ?? "",
          question: body.question ?? null,
          answer: body.answer ?? null,
          aiModel: body.aiModel ?? null,
          updatedAt: now,
        },
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

// Persist a live STT transcript correction (auto-upgrade of an interim line, or
// a user edit of a transcript row). This is distinct from /answers/:messageId,
// which versions AI ANSWER text — this updates the transcript utterance itself.
//
// The desktop client was already PATCHing this URL, but the route did not
// exist, so every correction 404'd silently (the caller only .catch(console
// .error)'d) and transcript fixes were never persisted — visible as stale text
// on the review page. Idempotent: patching the same id twice is fine.
router.patch("/:sessionId/transcript/:messageId", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params["sessionId"] ?? "");
    const messageId = String(req.params["messageId"] ?? "");

    const owned = await loadOwnedMessage(req.userId!, sessionId, messageId);
    if (!owned) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const body = req.body as {
      patchedText?: string;
      originalText?: string;
      patchedByUser?: boolean;
      sender?: string;
    };

    const patchedText = typeof body.patchedText === "string" ? body.patchedText.trim() : "";
    if (!patchedText) {
      res.status(400).json({ error: "patchedText is required" });
      return;
    }

    await db
      .update(sessionMessagesTable)
      .set({
        content: patchedText,
        question: patchedText,
        updatedAt: new Date(),
      })
      .where(eq(sessionMessagesTable.id, messageId));

    res.json({ success: true });
  } catch (err) {
    console.error("[sessions] transcript patch error", err);
    res.status(500).json({ error: "Failed to patch transcript" });
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

    const aiModel = process.env["ANSWER_MODEL"] || session.aiModel || undefined;
    const resumeContext = await getResumeContextById(session.resumeId, userId);
    const grounding = await getSessionGrounding(session);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      projectContext: grounding.projectContext,
      documentContext: grounding.documentContext,
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

    // The frontend deliberately does NOT send a real currentQuestion for
    // screen analysis (the screenshot is authoritative — a possibly-stale
    // voice transcript must not override it). That means only the model
    // itself, having seen the image, can say what the actual question is.
    // So instead of the backend pre-writing a guessed/generic "**QUESTION:**"
    // line, the model is instructed to state it, and its output is streamed
    // through untouched. The frontend's `parseAnswerContent` already parses
    // "**QUESTION:** ... **ANSWER:** ..." out of raw stream text regardless
    // of whether the backend or the model produced it.
    const instruction = [
      "Analyze the screenshot. If multiple questions or tasks are visible, identify the ONE that is currently active — typically the most recent one that does not yet have a visible answer.",
      alreadyAnswered
        ? `Already answered in this session — do not regenerate an answer for these:\n${alreadyAnswered}`
        : "",
      'Respond in exactly this format: the first line is "**QUESTION:** " followed by the exact question or task text as it appears on screen. Then, starting on a new line, "**ANSWER:** " followed by your answer.',
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ];

    const estimatedTokens = Math.ceil((systemPrompt.length + instruction.length) / 4);
    console.log("[sessions] analyze-screen context", {
      sessionId,
      systemPromptChars: systemPrompt.length,
      instructionChars: instruction.length,
      previousAnswersIncluded: contextPayload.previousAiAnswers?.length ?? 0,
      estimatedTokens,
    });

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    // No hardcoded "**QUESTION:** ..." prefix here on purpose — see comment
    // above. The model streams its own structured output directly.

    await streamChatComplete({ model: aiModel, messages, maxTokens: OPENROUTER_MAX_TOKENS }, (chunk) => {
      res.write(chunk);
    });
    res.end();
  } catch (err) {
    console.error("[sessions] analyze-screen error", err);
    if (res.headersSent) {
      // Mid-stream provider failure: without a marker the client renders a
      // silently truncated answer as if it were complete. Emit a visible
      // error tail so the UI (and the user) can tell it failed and retry.
      res.write("\n\n**ERROR:** Screen analysis failed mid-generation — please retry.");
      res.end();
    } else {
      res.status(502).json({ error: "Failed to analyze screen" });
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

    const resumeContext = await getResumeContextById(session.resumeId, userId);
    const grounding = await getSessionGrounding(session);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      projectContext: grounding.projectContext,
      documentContext: grounding.documentContext,
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

    const aiModel = process.env["ANSWER_MODEL"] || session.aiModel || undefined;

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
      res.write("\n\n**ERROR:** Answer generation failed mid-stream — please retry.");
      res.end();
    } else {
      res.status(502).json({ error: "Failed to generate answer" });
    }
  }
});

/**
 * Insights / Analytics (spec §4.3 Insights tab, §7 session_insights, §8).
 *
 *  GET /:id/analytics/existing — returns the stored feedback object, or null
 *    if it hasn't been generated yet. The review dialog calls this first so a
 *    previously-generated evaluation loads instantly without a model call.
 *  GET /:id/analytics — generate-or-return: produces the evaluation if missing
 *    (idempotent, persisted), otherwise returns the stored one. Returns the
 *    feedback object DIRECTLY (not wrapped) because the client reads it as-is.
 */
router.get("/:id/analytics/existing", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const session = await loadOwnedSession(userId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const existing = await getExistingFeedback(sessionId);
    res.json(existing ?? null);
  } catch (err) {
    console.error("[sessions] analytics/existing error", err);
    res.status(500).json({ error: "Failed to fetch insights" });
  }
});

router.get("/:id/analytics", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params["id"] ?? "");

    const session = await loadOwnedSession(userId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const feedback = await generateSessionFeedback(session);
    if (!feedback) {
      res.status(422).json({
        error: "NOT_ENOUGH_TRANSCRIPT",
        message: "Not enough conversation in this session to generate insights.",
      });
      return;
    }

    // Returned directly — the client's SessionAnalyticsDialog reads the
    // feedback object at the top level (feedback.score, .strengths, etc.).
    res.json(feedback);
  } catch (err) {
    console.error("[sessions] analytics error", err);
    res.status(502).json({ error: "Failed to generate insights" });
  }
});

// NOTE: the previous GET /:id/events SSE endpoint was removed. It had no
// requireAuth / ownership check (any caller could open a stream for any
// session id — an unauthenticated resource-exhaustion surface) and only ever
// sent keep-alive pings; it never emitted the CREDIT_WARNING/SESSION_CLOSED
// events its (now-removed) client listener expected. The heartbeat endpoint
// above is authenticated, ownership-checked, and already delivers the full
// CREDIT_WARNING / CREDIT_EXHAUSTED / TIME_EXHAUSTED / SESSION_NOT_ACTIVE
// contract every 60s, so this channel added an open unauthenticated
// connection per session with no corresponding benefit.

// ── Answer endpoints (require auth — called from AskAIWorkspace) ──────────────

/**
 * Ownership-checked loader for the answer endpoints. Every route below MUST
 * go through this: previously these endpoints looked messages up by id alone,
 * which let any authenticated user read or rewrite any other user's answers
 * (IDOR). Returns null unless the session belongs to `userId` AND the message
 * belongs to that session.
 */
async function loadOwnedMessage(
  userId: string,
  sessionId: string,
  messageId: string,
) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.userId, userId)))
    .limit(1);
  if (!session) return null;

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
  if (!message) return null;

  return { session, message };
}

router.get("/:sessionId/answers/:messageId", requireAuth, async (req, res) => {
  try {
    const owned = await loadOwnedMessage(
      req.userId!,
      String(req.params["sessionId"] ?? ""),
      String(req.params["messageId"] ?? ""),
    );
    if (!owned) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    res.json({ success: true, data: owned.message });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch answer" });
  }
});

router.patch("/:sessionId/answers/:messageId", requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.params["sessionId"] ?? "");
    const messageId = String(req.params["messageId"] ?? "");

    const owned = await loadOwnedMessage(req.userId!, sessionId, messageId);
    if (!owned) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const existing = owned.message;

    const body = req.body as {
      answer?: string;
      baseVersion?: number;
      source?: string;
      aiMode?: string;
      instruction?: string;
      model?: string;
    };

    if (typeof body.answer !== "string" || !body.answer.trim()) {
      res.status(400).json({ error: "Answer text is required" });
      return;
    }

    // Optimistic concurrency: the client sends the version it edited from.
    // A mismatch means someone (another tab/device) saved in between — reject
    // instead of silently clobbering their edit.
    if (
      typeof body.baseVersion === "number" &&
      body.baseVersion !== existing.currentVersion
    ) {
      res.status(409).json({
        error: "VERSION_CONFLICT",
        currentVersion: existing.currentVersion,
      });
      return;
    }

    const newVersion = existing.currentVersion + 1;
    const revisionId = uuidv4();

    await db.transaction(async (tx) => {
      // Seed the baseline revision ONCE (first edit only) so "restore to
      // original" works. Previous code inserted the old version on EVERY
      // edit, duplicating each version row from the second edit onward.
      const [baselineExists] = await tx
        .select({ id: answerRevisionsTable.id })
        .from(answerRevisionsTable)
        .where(
          and(
            eq(answerRevisionsTable.messageId, messageId),
            eq(answerRevisionsTable.version, existing.currentVersion),
          ),
        )
        .limit(1);

      if (!baselineExists) {
        await tx.insert(answerRevisionsTable).values({
          id: uuidv4(),
          messageId,
          sessionId,
          version: existing.currentVersion,
          question: existing.question ?? "",
          answer: existing.answer ?? "",
          source: "original",
        });
      }

      await tx
        .update(sessionMessagesTable)
        .set({
          answer: body.answer,
          content: body.answer,
          currentVersion: newVersion,
          updatedAt: new Date(),
        })
        .where(eq(sessionMessagesTable.id, messageId));

      await tx.insert(answerRevisionsTable).values({
        id: revisionId,
        messageId,
        sessionId,
        version: newVersion,
        question: existing.question ?? "",
        answer: body.answer!,
        source: body.source ?? "manual",
        aiMode: body.aiMode ?? null,
        instruction: body.instruction ?? null,
        model: body.model ?? null,
      });
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

    const owned = await loadOwnedMessage(
      req.userId!,
      String(req.params["sessionId"] ?? ""),
      messageId,
    );
    if (!owned) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const message = owned.message;

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

      const owned = await loadOwnedMessage(req.userId!, sessionId, messageId);
      if (!owned) {
        res.status(404).json({ error: "Message not found" });
        return;
      }
      const existing = owned.message;

      // The revision must belong to THIS message — otherwise a crafted
      // revisionId could inject another message's (or user's) content here.
      const [revision] = await db
        .select()
        .from(answerRevisionsTable)
        .where(
          and(
            eq(answerRevisionsTable.id, revisionId),
            eq(answerRevisionsTable.messageId, messageId),
          ),
        )
        .limit(1);

      if (!revision) {
        res.status(404).json({ error: "Revision not found" });
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

    const owned = await loadOwnedMessage(req.userId!, sessionId, messageId);
    if (!owned) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    const { session, message } = owned;

    const body = req.body as { instruction?: string; mode?: string; model?: string };

    const resumeContext = await getResumeContextById(session.resumeId, req.userId!);
    const grounding = await getSessionGrounding(session);
    const systemPrompt = buildInterviewSystemPrompt({
      session,
      resumeContext,
      projectContext: grounding.projectContext,
      documentContext: grounding.documentContext,
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
