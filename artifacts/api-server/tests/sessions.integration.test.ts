/**
 * Integration tests for the Sessions module — run against a real Postgres.
 *
 *   DATABASE_URL=postgres://hs:hs@localhost:5432/hs pnpm vitest run
 *
 * requireAuth is mocked (Clerk JWKS is unreachable in CI); everything below
 * it — routing, ownership checks, settlement transactions, idempotency — is
 * the real production code against a real database.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";

// ── Auth mock: x-test-user header → req.userId ────────────────────────────────
vi.mock("../src/middlewares/requireAuth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "no test user" });
    req.userId = String(uid);
    next();
  },
}));

import { db } from "@workspace/db";
import {
  usersTable,
  sessionsTable,
  sessionMessagesTable,
  answerRevisionsTable,
  creditsBalanceTable,
  creditsUsageTable,
  creditsPurchasesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import sessionsRouter from "../src/routes/sessions.js";
import creditsRouter from "../src/routes/credits.js";
import {
  settleSession,
  STALE_ACTIVE_MS,
  CREDITS_PER_MINUTE,
  GRACE_ZONE_MINUTES,
} from "../src/lib/sessionCredits.js";

const app = express();
app.use(express.json());
app.use("/api/session", sessionsRouter);
app.use("/api/credits", creditsRouter);

const USER_A = "user-a";
const USER_B = "user-b";

async function seedUser(id: string, credits = "100") {
  await db
    .insert(usersTable)
    .values({ id, clerkUserId: `clerk_${id}`, email: `${id}@t.local` })
    .onConflictDoNothing();
  await db.delete(creditsBalanceTable).where(eq(creditsBalanceTable.userId, id));
  await db.insert(creditsBalanceTable).values({
    id: uuidv4(),
    userId: id,
    purchasedCredits: "0",
    earnedCredits: credits,
    heldCredits: "0",
  });
}

async function makeSession(
  userId: string,
  overrides: Partial<typeof sessionsTable.$inferInsert> = {},
) {
  const id = uuidv4();
  await db.insert(sessionsTable).values({
    id,
    userId,
    companyName: "TestCo",
    status: "ACTIVE",
    startedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, id))
    .limit(1);
  return row!;
}

async function balanceOf(userId: string): Promise<number> {
  const [b] = await db
    .select()
    .from(creditsBalanceTable)
    .where(eq(creditsBalanceTable.userId, userId))
    .limit(1);
  if (!b) return NaN;
  return (
    parseFloat(b.purchasedCredits) + parseFloat(b.earnedCredits) - parseFloat(b.heldCredits)
  );
}

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
});

beforeEach(async () => {
  await db.delete(answerRevisionsTable);
  await db.delete(sessionMessagesTable);
  await db.delete(creditsUsageTable);
  await db.delete(creditsPurchasesTable);
  await db.delete(sessionsTable);
  await seedUser(USER_A);
  await seedUser(USER_B);
});

describe("deactivate contract", () => {
  it("404s for unknown sessions instead of fake success", async () => {
    const res = await request(app)
      .post(`/api/session/${uuidv4()}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.status).toBe(404);
  });

  it("charges session minutes past the grace zone and writes the ledger", async () => {
    const startedAt = new Date(Date.now() - 11.5 * 60_000); // ceil → 12 min
    const s = await makeSession(USER_A, { startedAt });
    const res = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({ transcript: "[User]: hello\n[Interviewer]: tell me about yourself", aiUsage: 3 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    const expected = Math.ceil(12) * CREDITS_PER_MINUTE;
    expect(parseFloat(res.body.creditsDeducted)).toBeCloseTo(expected, 2);
    expect(await balanceOf(USER_A)).toBeCloseTo(100 - expected, 2);

    const usage = await db.select().from(creditsUsageTable);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.operation).toBe("session_minutes");

    // transcript persisted as native USER/INTERVIEWER rows
    const msgs = await db.select().from(sessionMessagesTable);
    expect(msgs.some((m) => m.role === "USER" && m.content === "hello")).toBe(true);

    // aiUsage stored
    const [after] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, s.id));
    expect(after!.aiUsage).toBe(3);
  });

  it("is idempotent — a retried deactivate never double-charges", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 10 * 60_000),
    });
    const r1 = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    const r2 = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.body.creditsDeducted).toBe(r1.body.creditsDeducted);
    expect(await balanceOf(USER_A)).toBeCloseTo(
      100 - parseFloat(r1.body.creditsDeducted),
      2,
    );
    const usage = await db.select().from(creditsUsageTable);
    expect(usage).toHaveLength(1);
  });

  it("survives concurrent double-clicks without double-charging", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 19.5 * 60_000), // ceil → 20 min
    });
    const [r1, r2, r3] = await Promise.all([
      request(app).post(`/api/session/${s.id}/deactivate`).set("x-test-user", USER_A).send({}),
      request(app).post(`/api/session/${s.id}/deactivate`).set("x-test-user", USER_A).send({}),
      request(app).post(`/api/session/${s.id}/deactivate`).set("x-test-user", USER_A).send({}),
    ]);
    for (const r of [r1, r2, r3]) expect(r.status).toBe(200);
    const usage = await db.select().from(creditsUsageTable);
    expect(usage).toHaveLength(1);
    expect(await balanceOf(USER_A)).toBeCloseTo(100 - 20 * CREDITS_PER_MINUTE, 2);
  });

  it("grace-zone sessions end free", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - (GRACE_ZONE_MINUTES - 1) * 60_000),
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.deductionReason).toBe("FREE_ZONE");
    expect(parseFloat(res.body.creditsDeducted)).toBe(0);
    expect(await balanceOf(USER_A)).toBe(100);
  });

  it("marks CREDIT_EXHAUSTED and charges only what exists when balance can't cover", async () => {
    await seedUser(USER_A, "2"); // 2 credits = 4 minutes of coverage
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 60 * 60_000), // 60 min → cost 30
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.status).toBe("CREDIT_EXHAUSTED");
    expect(parseFloat(res.body.creditsDeducted)).toBeCloseTo(2, 2);
    expect(await balanceOf(USER_A)).toBeCloseTo(0, 2);
  });

  it("never charges free sessions", async () => {
    const s = await makeSession(USER_A, {
      free: true,
      startedAt: new Date(Date.now() - 30 * 60_000),
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.deductionReason).toBe("FREE_SESSION");
    expect(await balanceOf(USER_A)).toBe(100);
  });
});

describe("stale-session reaper", () => {
  it("auto-settles a zombie ACTIVE session so it stops blocking creation", async () => {
    const lastSeen = new Date(Date.now() - STALE_ACTIVE_MS - 60_000);
    const zombieStart = new Date(Date.now() - 30 * 60_000);
    const zombie = await makeSession(USER_A, {
      startedAt: zombieStart,
      updatedAt: lastSeen,
    });

    const res = await request(app)
      .post("/api/session/create-session")
      .set("x-test-user", USER_A)
      .field("companyName", "NextCo");
    expect(res.status).toBe(201); // NOT 409 — zombie was reaped

    const [after] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, zombie.id));
    expect(after!.status).toBe("AUTO_ENDED");
    // billed only up to last heartbeat, not to "now"
    const minutesBilled = Math.ceil(
      (lastSeen.getTime() - zombieStart.getTime()) / 60_000,
    );
    expect(parseFloat(after!.creditsDeducted!)).toBeCloseTo(
      minutesBilled * CREDITS_PER_MINUTE,
      2,
    );
  });

  it("a genuinely live ACTIVE session still blocks", async () => {
    const live = await makeSession(USER_A, { updatedAt: new Date() });
    const res = await request(app)
      .post("/api/session/create-session")
      .set("x-test-user", USER_A)
      .field("companyName", "NextCo");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(`ACTIVE_SESSION_EXISTS:${live.id}`);
  });
});

describe("heartbeat contract", () => {
  it("bumps liveness and reports remaining minutes", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 2 * 60_000),
      updatedAt: new Date(Date.now() - 2 * 60_000),
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/heartbeat`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [after] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, s.id));
    expect(after!.updatedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it("force-ends a paid session whose accrued cost exceeds the balance", async () => {
    await seedUser(USER_A, "3");
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 60 * 60_000),
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/heartbeat`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.action).toBe("CREDIT_EXHAUSTED");
    const [after] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, s.id));
    expect(["CREDIT_EXHAUSTED", "FORCE_ENDED"]).toContain(after!.status);
  });

  it("enforces the free-session cap server-side", async () => {
    const s = await makeSession(USER_A, {
      free: true,
      startedAt: new Date(Date.now() - 30 * 60_000),
    });
    const res = await request(app)
      .post(`/api/session/${s.id}/heartbeat`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.action).toBe("TIME_EXHAUSTED");
    const [after] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, s.id));
    expect(after!.status).toBe("AUTO_ENDED");
    expect(await balanceOf(USER_A)).toBe(100); // free — never charged
  });

  it("tells a zombie client the session is no longer active", async () => {
    const s = await makeSession(USER_A, { status: "COMPLETED", endedAt: new Date() });
    const res = await request(app)
      .post(`/api/session/${s.id}/heartbeat`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.body.action).toBe("SESSION_NOT_ACTIVE");
  });
});

describe("activation", () => {
  it("refuses to re-activate a settled session", async () => {
    const s = await makeSession(USER_A, { status: "COMPLETED", endedAt: new Date() });
    const res = await request(app)
      .post(`/api/session/${s.id}/activate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("SESSION_ALREADY_ENDED");
  });

  it("blocks paid activation with zero credits", async () => {
    await seedUser(USER_A, "0");
    const s = await makeSession(USER_A, { status: "PRE_CHECK", startedAt: null });
    const res = await request(app)
      .post(`/api/session/${s.id}/activate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("INSUFFICIENT_CREDITS");
  });

  it("allows rejoining one's own ACTIVE session and keeps startedAt", async () => {
    const startedAt = new Date(Date.now() - 4 * 60_000);
    const s = await makeSession(USER_A, { startedAt });
    const res = await request(app)
      .post(`/api/session/${s.id}/activate`)
      .set("x-test-user", USER_A)
      .send({});
    expect(res.status).toBe(200);
    expect(new Date(res.body.startedAt).getTime()).toBe(startedAt.getTime());
  });
});

describe("answer endpoints — ownership (IDOR)", () => {
  async function seedMessage(userId: string) {
    const s = await makeSession(userId, { status: "COMPLETED" });
    const mid = uuidv4();
    await db.insert(sessionMessagesTable).values({
      id: mid,
      sessionId: s.id,
      role: "assistant",
      content: "secret answer",
      question: "q?",
      answer: "secret answer",
      currentVersion: 1,
    });
    return { sessionId: s.id, messageId: mid };
  }

  it("blocks reading another user's answer", async () => {
    const { sessionId, messageId } = await seedMessage(USER_A);
    const res = await request(app)
      .get(`/api/session/${sessionId}/answers/${messageId}`)
      .set("x-test-user", USER_B);
    expect(res.status).toBe(404);
  });

  it("blocks editing another user's answer", async () => {
    const { sessionId, messageId } = await seedMessage(USER_A);
    const res = await request(app)
      .patch(`/api/session/${sessionId}/answers/${messageId}`)
      .set("x-test-user", USER_B)
      .send({ answer: "defaced", baseVersion: 1, source: "manual" });
    expect(res.status).toBe(404);
    const [msg] = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, messageId));
    expect(msg!.answer).toBe("secret answer");
  });

  it("blocks reading another user's revisions and cross-message restore", async () => {
    const a = await seedMessage(USER_A);
    const revRes = await request(app)
      .get(`/api/session/${a.sessionId}/answers/${a.messageId}/revisions`)
      .set("x-test-user", USER_B);
    expect(revRes.status).toBe(404);

    // cross-message revision injection: revision belongs to A's message,
    // attacker tries to restore it onto B's own message
    await request(app)
      .patch(`/api/session/${a.sessionId}/answers/${a.messageId}`)
      .set("x-test-user", USER_A)
      .send({ answer: "v2", baseVersion: 1, source: "manual" });
    const [rev] = await db.select().from(answerRevisionsTable).limit(1);

    const b = await seedMessage(USER_B);
    const restoreRes = await request(app)
      .post(
        `/api/session/${b.sessionId}/answers/${b.messageId}/revisions/${rev!.id}/restore`,
      )
      .set("x-test-user", USER_B)
      .send({});
    expect(restoreRes.status).toBe(404);
  });
});

describe("answer revisions — integrity", () => {
  async function seedOwn() {
    const s = await makeSession(USER_A, { status: "COMPLETED" });
    const mid = uuidv4();
    await db.insert(sessionMessagesTable).values({
      id: mid,
      sessionId: s.id,
      role: "assistant",
      content: "original",
      question: "q?",
      answer: "original",
      currentVersion: 1,
    });
    return { sessionId: s.id, messageId: mid };
  }

  it("does not duplicate version rows across successive edits", async () => {
    const { sessionId, messageId } = await seedOwn();
    for (const [i, text] of ["v2", "v3", "v4"].entries()) {
      const r = await request(app)
        .patch(`/api/session/${sessionId}/answers/${messageId}`)
        .set("x-test-user", USER_A)
        .send({ answer: text, baseVersion: 1 + i, source: "manual" });
      expect(r.status).toBe(200);
    }
    const revs = await db.select().from(answerRevisionsTable);
    const versions = revs.map((r) => r.version).sort();
    // baseline (1) + three edits (2,3,4) — each version exactly once
    expect(versions).toEqual([1, 2, 3, 4]);
  });

  it("rejects concurrent edits from a stale base version", async () => {
    const { sessionId, messageId } = await seedOwn();
    await request(app)
      .patch(`/api/session/${sessionId}/answers/${messageId}`)
      .set("x-test-user", USER_A)
      .send({ answer: "tab1 edit", baseVersion: 1, source: "manual" });
    const stale = await request(app)
      .patch(`/api/session/${sessionId}/answers/${messageId}`)
      .set("x-test-user", USER_A)
      .send({ answer: "tab2 stale edit", baseVersion: 1, source: "manual" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("VERSION_CONFLICT");
    const [msg] = await db
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, messageId));
    expect(msg!.answer).toBe("tab1 edit");
  });
});

describe("purchase verification — idempotency", () => {
  it("replayed verification does not credit twice and seeds a missing balance row", async () => {
    process.env["RAZORPAY_KEY_SECRET"] = "test-secret";
    const crypto = await import("crypto");
    const orderId = "order_test_1";
    const paymentId = "pay_test_1";
    const signature = crypto
      .createHmac("sha256", "test-secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId: USER_A,
      orderId,
      creditsPurchased: "50",
      status: "pending",
    });
    // simulate a user with NO balance row (legacy)
    await db.delete(creditsBalanceTable).where(eq(creditsBalanceTable.userId, USER_A));

    const call = () =>
      request(app)
        .post("/api/credits/purchase/verify")
        .set("x-test-user", USER_A)
        .send({ orderId, paymentId, signature });

    const r1 = await call();
    expect(r1.status).toBe(200);
    const afterFirst = await balanceOf(USER_A);
    expect(afterFirst).toBeCloseTo(150, 2); // 100 seed grant + 50 purchased

    const r2 = await call();
    expect(r2.status).toBe(200);
    expect(await balanceOf(USER_A)).toBeCloseTo(afterFirst, 2); // unchanged
  });
});

describe("settleSession race", () => {
  it("parallel settlement callers charge exactly once", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 9.5 * 60_000), // ceil → 10 min
    });
    const results = await Promise.all([
      settleSession({ session: s, reason: "COMPLETED" }),
      settleSession({ session: s, reason: "AUTO_ENDED" }),
      settleSession({ session: s, reason: "FORCE_ENDED" }),
    ]);
    const usage = await db.select().from(creditsUsageTable);
    expect(usage).toHaveLength(1);
    expect(await balanceOf(USER_A)).toBeCloseTo(100 - 10 * CREDITS_PER_MINUTE, 2);
    // all callers converge on the same recorded charge
    const charges = new Set(results.map((r) => r.creditsDeducted));
    expect(charges.size).toBe(1);
  });
});

describe("transcript persistence", () => {
  it("parses sender lines into ordered USER/INTERVIEWER rows and is retry-safe", async () => {
    const s = await makeSession(USER_A, {
      startedAt: new Date(Date.now() - 2 * 60_000),
    });
    const transcript = [
      "[Interviewer]: first question?",
      "[User]: my answer",
      "[Interviewer]: follow-up?",
      "[AI]: generated (should be skipped — saved via save-message)",
      "not a transcript line",
    ].join("\n");

    const call = () =>
      request(app)
        .post(`/api/session/${s.id}/deactivate`)
        .set("x-test-user", USER_A)
        .send({ transcript });

    await call();
    await call(); // retry — must not duplicate

    const msgs = (await db.select().from(sessionMessagesTable)).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    expect(msgs.map((m) => m.role)).toEqual(["INTERVIEWER", "USER", "INTERVIEWER"]);
    expect(msgs[0]!.content).toBe("first question?");
    expect(msgs[1]!.content).toBe("my answer");
  });

  it("skips persistence for ephemeral sessions (saveTranscription=false)", async () => {
    const s = await makeSession(USER_A, {
      saveTranscription: false,
      startedAt: new Date(Date.now() - 2 * 60_000),
    });
    await request(app)
      .post(`/api/session/${s.id}/deactivate`)
      .set("x-test-user", USER_A)
      .send({ transcript: "[User]: private stuff" });
    const msgs = await db.select().from(sessionMessagesTable);
    expect(msgs).toHaveLength(0);
  });
});

// ── Per-feature credit charging (resume / project AI) ─────────────────────────
import { chargeFeature, InsufficientCreditsError } from "../src/lib/featureCredits.js";

describe("chargeFeature — per-action metering", () => {
  it("charges the configured cost and records an idempotency-keyed ledger row", async () => {
    await seedUser(USER_A, "20");
    const key = uuidv4();
    const r = await chargeFeature({
      userId: USER_A,
      operation: "resume_generate", // cost 10
      idempotencyKey: key,
    });
    expect(r.creditsUsed).toBe(10);
    expect(r.cached).toBe(false);
    expect(r.creditsRemaining).toBeCloseTo(10, 2);
    expect(await balanceOf(USER_A)).toBeCloseTo(10, 2);

    const usage = await db.select().from(creditsUsageTable);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.idempotencyKey).toBe(key);
  });

  it("is idempotent — replaying the same key never double-charges", async () => {
    await seedUser(USER_A, "20");
    const key = uuidv4();
    const opts = { userId: USER_A, operation: "resume_generate", idempotencyKey: key };
    const r1 = await chargeFeature(opts);
    const r2 = await chargeFeature(opts);
    expect(r1.cached).toBe(false);
    expect(r2.cached).toBe(true);
    expect(r2.creditsUsed).toBe(10);
    expect(await balanceOf(USER_A)).toBeCloseTo(10, 2);
    expect(await db.select().from(creditsUsageTable)).toHaveLength(1);
  });

  it("concurrent duplicate keys charge exactly once", async () => {
    await seedUser(USER_A, "20");
    const key = uuidv4();
    const opts = { userId: USER_A, operation: "resume_generate", idempotencyKey: key };
    const results = await Promise.all([
      chargeFeature(opts),
      chargeFeature(opts),
      chargeFeature(opts),
    ]);
    expect(await db.select().from(creditsUsageTable)).toHaveLength(1);
    expect(await balanceOf(USER_A)).toBeCloseTo(10, 2);
    expect(results.filter((r) => !r.cached)).toHaveLength(1);
  });

  it("throws InsufficientCreditsError and charges nothing when balance can't cover", async () => {
    await seedUser(USER_A, "3"); // < 10
    await expect(
      chargeFeature({ userId: USER_A, operation: "resume_generate", idempotencyKey: uuidv4() }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await balanceOf(USER_A)).toBeCloseTo(3, 2);
    expect(await db.select().from(creditsUsageTable)).toHaveLength(0);
  });

  it("free operations (cost 0) never write a ledger row and always succeed", async () => {
    await seedUser(USER_A, "0");
    const r = await chargeFeature({
      userId: USER_A,
      operation: "resume_rewrite", // cost 0 (unpriced)
      idempotencyKey: uuidv4(),
    });
    expect(r.creditsUsed).toBe(0);
    expect(await db.select().from(creditsUsageTable)).toHaveLength(0);
  });

  it("spends earned credits before purchased", async () => {
    await db.delete(creditsBalanceTable).where(eq(creditsBalanceTable.userId, USER_A));
    await db.insert(creditsBalanceTable).values({
      id: uuidv4(),
      userId: USER_A,
      earnedCredits: "6",
      purchasedCredits: "10",
      heldCredits: "0",
    });
    await chargeFeature({ userId: USER_A, operation: "resume_generate", idempotencyKey: uuidv4() }); // 10
    const [b] = await db
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, USER_A));
    expect(parseFloat(b!.earnedCredits)).toBeCloseTo(0, 2); // 6 earned drained first
    expect(parseFloat(b!.purchasedCredits)).toBeCloseTo(6, 2); // 4 taken from purchased
  });
});

// ── Newly-metered routes: assistant chat + ai/project-generation ──────────────
import assistantRouter from "../src/routes/assistant.js";
import aiRouter from "../src/routes/ai.js";
app.use("/api/assistant", assistantRouter);
app.use("/api/ai", aiRouter);

describe("assistant chat metering scaffold", () => {
  it("is registered in the feature-cost registry (was previously invisible to billing)", async () => {
    const res = await request(app)
      .get("/api/credits/feature-costs")
      .set("x-test-user", USER_A);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("assistant_chat");
    expect(res.body.data).toHaveProperty("ai_project_generation");
  });

  it("charges when priced via env, blocking on 402 with zero side effects", async () => {
    process.env["FEATURE_COST_ASSISTANT_CHAT"] = "4";
    try {
      await seedUser(USER_A, "1"); // below the 4-credit cost
      // Create an assistant chat row directly (chat creation route not under test here)
      const chatId = uuidv4();
      await db.insert(
        (await import("@workspace/db/schema")).assistantChatsTable,
      ).values({ id: chatId, userId: USER_A, title: "test chat" });

      const res = await request(app)
        .post(`/api/assistant/${chatId}/query`)
        .set("x-test-user", USER_A)
        .send({ query: "hello" });
      expect(res.status).toBe(402);
      expect(await balanceOf(USER_A)).toBeCloseTo(1, 2); // untouched
    } finally {
      delete process.env["FEATURE_COST_ASSISTANT_CHAT"];
    }
  });
});
