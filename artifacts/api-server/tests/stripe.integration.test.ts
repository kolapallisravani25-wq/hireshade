/**
 * DB-backed Stripe billing integration tests.
 *
 * Runs ONLY against a dedicated database: hireshade_stripe_test on the existing
 * hireshade-postgres container (port 5433). It is deliberately NOT the shared
 * hireshade_dev database, so it can never collide with the sessions integration
 * suite or a developer's local data.
 *
 * Setup (once):
 *   docker exec -e PGPASSWORD="$env:POSTGRES_PASSWORD" hireshade-postgres \
 *     psql -U hireshade_dev -d hireshade_dev -c "CREATE DATABASE hireshade_stripe_test"
 *   $env:DATABASE_URL="postgresql://hireshade_dev:<pw>@localhost:5433/hireshade_stripe_test"
 *   pnpm --filter @workspace/db run push-force
 *
 * Run:
 *   $env:POSTGRES_PASSWORD="<pw from `docker exec hireshade-postgres env`>"
 *   pnpm --dir artifacts/api-server exec vitest run tests/stripe.integration.test.ts
 *
 * The connection string is built from POSTGRES_* env vars (or
 * STRIPE_TEST_DATABASE_URL / TEST_DATABASE_URL); the database NAME is
 * hard-guarded to hireshade_stripe_test before @workspace/db is imported.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";

// ── Dedicated-database guard (runs before any @workspace/db import) ─────────
const TEST_DB_NAME = "hireshade_stripe_test";
const TEST_WEBHOOK_SECRET = "whsec_stripe_integration_test";

function resolveTestDatabaseUrl(): string {
  const explicit =
    process.env["STRIPE_TEST_DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"];
  if (explicit) return explicit;
  const user = process.env["POSTGRES_USER"] ?? "hireshade_dev";
  const password = process.env["POSTGRES_PASSWORD"] ?? "";
  const host = process.env["POSTGRES_HOST"] ?? "localhost";
  const port = process.env["POSTGRES_PORT"] ?? "5433";
  return (
    "postgresql://" +
    encodeURIComponent(user) +
    ":" +
    encodeURIComponent(password) +
    "@" +
    host +
    ":" +
    port +
    "/" +
    TEST_DB_NAME
  );
}

const testDatabaseUrl = resolveTestDatabaseUrl();
{
  let parsed: URL;
  try {
    parsed = new URL(testDatabaseUrl);
  } catch {
    throw new Error("Invalid test DATABASE_URL: " + testDatabaseUrl);
  }
  const databaseName = parsed.pathname.replace(/^[/]+/, "");
  if (databaseName !== TEST_DB_NAME) {
    throw new Error(
      "Refusing to run Stripe integration tests against database '" +
        databaseName +
        "'. Expected the dedicated '" +
        TEST_DB_NAME +
        "' database.",
    );
  }
}

process.env["DATABASE_URL"] = testDatabaseUrl;
process.env["NODE_ENV"] = "test"; // mock adapter mode
process.env["STRIPE_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;
delete process.env["STRIPE_SECRET_KEY"]; // never hit the network

// ── Auth mock: x-test-user header -> req.userId (same contract as the session
// integration suite; Clerk JWKS is unreachable in CI). vi.mock is hoisted. ──
vi.mock("../src/middlewares/requireAuth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "no test user" });
    req.userId = String(uid);
    next();
  },
}));

// Env is set above, so these dynamic imports see DATABASE_URL.
const { db, pool } = await import("@workspace/db");
const {
  creditsBalanceTable,
  creditsLedgerTable,
  creditsPurchasesTable,
  stripeWebhookEventsTable,
  usersTable,
} = await import("@workspace/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { default: stripeRouter } = await import("../src/routes/stripe.js");
const { buildStripeSignatureHeader, computeStripeSignature } = await import(
  "../src/lib/stripe.js"
);

const app = express();
// Mirrors app.ts: raw parser for the webhook path BEFORE express.json.
app.use("/api/stripe/webhook", express.raw({ type: () => true }));
app.use(express.json());
app.use("/api/stripe", stripeRouter);

const USER_A = "stripe-user-a";
const USER_B = "stripe-user-b";

async function seedUser(id: string) {
  await db
    .insert(usersTable)
    .values({ id, clerkUserId: "clerk_" + id, email: id + "@t.local" })
    .onConflictDoNothing();
  await db.delete(creditsBalanceTable).where(eq(creditsBalanceTable.userId, id));
  await db.insert(creditsBalanceTable).values({
    id: uuidv4(),
    userId: id,
    purchasedCredits: "0",
    earnedCredits: "0",
    heldCredits: "0",
  });
}

async function balanceOf(userId: string): Promise<{ purchased: number; earned: number }> {
  const [balance] = await db
    .select()
    .from(creditsBalanceTable)
    .where(eq(creditsBalanceTable.userId, userId))
    .limit(1);
  return {
    purchased: parseFloat(balance?.purchasedCredits ?? "0") || 0,
    earned: parseFloat(balance?.earnedCredits ?? "0") || 0,
  };
}

async function ledgerRowsFor(userId: string) {
  return db
    .select()
    .from(creditsLedgerTable)
    .where(eq(creditsLedgerTable.userId, userId))
    .orderBy(creditsLedgerTable.createdAt);
}

async function purchaseForOrder(orderId: string) {
  const [row] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.orderId, orderId))
    .limit(1);
  return row;
}

async function allEvents() {
  return db.select().from(stripeWebhookEventsTable);
}

function checkout(
  productCode: string,
  currency: string = "USD",
  user: string = USER_A,
  extra: Record<string, unknown> = {},
) {
  return request(app)
    .post("/api/stripe/checkout-session")
    .set("x-test-user", user)
    .send({ productCode, currency, ...extra });
}

function sessionEvent(
  eventId: string,
  type: string,
  sessionId: string,
  paymentIntent: string | null,
  paymentStatus: string = "paid",
) {
  return {
    id: eventId,
    object: "event",
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: paymentStatus,
        payment_intent: paymentIntent,
      },
    },
  };
}

function signedWebhookRequest(event: unknown, opts: {
  secret?: string;
  timestamp?: number;
  header?: string;
  rawOverride?: string;
} = {}) {
  const rawBody = opts.rawOverride ?? JSON.stringify(event);
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = opts.secret ?? TEST_WEBHOOK_SECRET;
  const header =
    opts.header ??
    ("t=" + timestamp + ",v1=" + computeStripeSignature(rawBody, secret, timestamp));
  const req = request(app)
    .post("/api/stripe/webhook")
    .set("Content-Type", "application/json");
  if (header.length > 0) req.set("Stripe-Signature", header);
  return req.send(rawBody);
}

/** Checkout + capture the created session id and its mock PaymentIntent. */
async function createSession(productCode = "credit_6", user = USER_A) {
  const res = await checkout(productCode, "USD", user);
  expect(res.status).toBe(200);
  const sessionId = res.body.data.sessionId as string;
  const [row] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.orderId, sessionId))
    .limit(1);
  return {
    sessionId,
    paymentIntentId: (row!.paymentId ?? "pi_test_injected") as string,
    purchase: row!,
  };
}

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
});

beforeEach(async () => {
  // stripe_webhook_events has no FK; delete it first, then users cascade to
  // balance / purchases / ledger.
  await db.delete(stripeWebhookEventsTable);
  await db.delete(usersTable).where(inArray(usersTable.id, [USER_A, USER_B]));
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterAll(async () => {
  await pool.end();
});

describe("dedicated test database", () => {
  it("is hireshade_stripe_test, never the shared dev database", () => {
    const parsed = new URL(process.env["DATABASE_URL"]!);
    const databaseName = parsed.pathname.replace(/^[/]+/, "");
    expect(databaseName).toBe(TEST_DB_NAME);
    expect(databaseName).not.toBe("hireshade_dev");
  });

  it("has the Stripe ledger and webhook-event tables", async () => {
    await expect(db.select().from(creditsLedgerTable).limit(1)).resolves.toBeDefined();
    await expect(db.select().from(stripeWebhookEventsTable).limit(1)).resolves.toBeDefined();
  });
});

describe("POST /api/stripe/checkout-session", () => {
  it("creates a pending stripe purchase priced from the T-12 catalog (USD)", async () => {
    const res = await checkout("credit_6", "USD");
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.productCode).toBe("credit_6");
    expect(data.productKind).toBe("credits");
    expect(data.amountMinor).toBe(7800);
    expect(data.currency).toBe("USD");
    expect(data.credits).toBe(6);
    expect(data.mode).toBe("mock");
    expect(data.sessionId).toMatch(/^cs_test_mock_[0-9a-f]{24}$/);
    expect(data.url).toContain(data.sessionId);

    const row = await purchaseForOrder(data.sessionId);
    expect(row).toBeTruthy();
    expect((row!.metadata as any).provider).toBe("stripe");
    expect(row!.status).toBe("pending");
    expect(row!.creditsPurchased).toBe("6");
    expect(row!.amount).toBe("78.00");
    expect(row!.currency).toBe("USD");
    expect(row!.paymentId).toMatch(/^pi_test_mock_/);
    expect((row!.metadata as any).productCode).toBe("credit_6");
  });

  it("uses the INR catalog amount for INR checkouts", async () => {
    const res = await checkout("credit_6", "INR");
    expect(res.status).toBe(200);
    expect(res.body.data.amountMinor).toBe(738000);
    expect(res.body.data.currency).toBe("INR");
    const row = await purchaseForOrder(res.body.data.sessionId);
    expect(row!.amount).toBe("7380.00");
    expect(row!.currency).toBe("INR");
  });

  it("ignores client-supplied amounts/credits and prices server-side", async () => {
    const res = await checkout("credit_9", "USD", USER_A, {
      amountMinor: 1,
      amount: "0.01",
      credits: 9999,
      price: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.amountMinor).toBe(11700);
    expect(res.body.data.credits).toBe(9);
    const row = await purchaseForOrder(res.body.data.sessionId);
    expect(row!.amount).toBe("117.00");
    expect(row!.creditsPurchased).toBe("9");
  });

  it("rejects unknown product codes with the shared client-contract string", async () => {
    for (const code of ["quick_5", "credit_10", ""]) {
      const res = await checkout(code, "USD");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid packCode");
    }
  });

  it("supports subscription tiers as subscription-mode checkout with zero credits", async () => {
    const res = await checkout("subscription_monthly", "USD");
    expect(res.status).toBe(200);
    expect(res.body.data.productKind).toBe("subscription");
    expect(res.body.data.credits).toBe(0);
    expect(res.body.data.amountMinor).toBe(9990);
    const row = await purchaseForOrder(res.body.data.sessionId);
    expect(row!.creditsPurchased).toBe("0");
    expect(row!.paymentId).toBeNull(); // subscription, not a PaymentIntent
    expect((row!.metadata as any).productKind).toBe("subscription");
  });

  it("fails closed with 503 in production when Stripe is unconfigured", async () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const res = await checkout("credit_6", "USD");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Stripe is not configured");
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });

  it("reports provider config without leaking secrets", async () => {
    const res = await request(app).get("/api/stripe/config").set("x-test-user", USER_A);
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("stripe");
    expect(res.body.data.mode).toBe("mock");
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.hasWebhookSecret).toBe(true);
    expect(Array.isArray(res.body.data.priceOverrides)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TEST_WEBHOOK_SECRET);
  });
});

describe("POST /api/stripe/webhook — signature verification", () => {
  it("credits exactly once for a valid checkout.session.completed", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_paid_1", "checkout.session.completed", sessionId, paymentIntentId);

    const res = await signedWebhookRequest(event);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, status: "processed", action: "settled", credits: 6 });

    const purchase = await purchaseForOrder(sessionId);
    expect(purchase!.status).toBe("completed");
    expect(purchase!.paymentId).toBe(paymentIntentId);
    expect((await balanceOf(USER_A)).purchased).toBe(6);

    const ledger = await ledgerRowsFor(USER_A);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.entryType).toBe("purchase");
    expect(ledger[0]!.provider).toBe("stripe");
    expect(ledger[0]!.deltaCredits).toBe("6");
    expect(ledger[0]!.idempotencyKey).toBe("stripe:purchase:" + sessionId);
    expect(ledger[0]!.amountMinor).toBe(7800);
    expect(ledger[0]!.currency).toBe("USD");

    const events = await allEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe("evt_paid_1");
    expect(events[0]!.status).toBe("processed");
  });

  it("rejects a bad signature without touching credits", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_bad_sig", "checkout.session.completed", sessionId, paymentIntentId);
    const res = await signedWebhookRequest(event, { secret: "whsec_wrong" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid Stripe signature");
    expect(res.body.reason).toBe("signature_mismatch");
    expect((await purchaseForOrder(sessionId))!.status).toBe("pending");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);
    expect(await allEvents()).toHaveLength(0);
  });

  it("rejects a tampered body even when the header value is well formed", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const original = JSON.stringify(
      sessionEvent("evt_tamper", "checkout.session.completed", sessionId, paymentIntentId),
    );
    const header = buildStripeSignatureHeader(original, TEST_WEBHOOK_SECRET);
    const tampered = original.replace("checkout.session.completed", "checkout.session.completed ");

    const res = await signedWebhookRequest(null, {
      header,
      rawOverride: tampered,
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("signature_mismatch");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });

  it("rejects replayed timestamps outside the tolerance window", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_stale", "checkout.session.completed", sessionId, paymentIntentId);
    const staleTimestamp = Math.floor(Date.now() / 1000) - 1000;

    const res = await signedWebhookRequest(event, { timestamp: staleTimestamp });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("timestamp_out_of_tolerance");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });

  it("rejects requests without a Stripe-Signature header", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_no_header", "checkout.session.completed", sessionId, paymentIntentId);
    const res = await signedWebhookRequest(event, { header: "" });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("missing_header");
  });

  it("fails closed with 503 when STRIPE_WEBHOOK_SECRET is unset", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_no_secret", "checkout.session.completed", sessionId, paymentIntentId);
    const raw = JSON.stringify(event);
    const header = buildStripeSignatureHeader(raw, TEST_WEBHOOK_SECRET);
    const previous = process.env["STRIPE_WEBHOOK_SECRET"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    try {
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", header)
        .send(raw);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Webhook not configured");
    } finally {
      process.env["STRIPE_WEBHOOK_SECRET"] = previous;
    }
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });

  it("fails closed with 503 in production when Stripe is unconfigured", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_prod", "checkout.session.completed", sessionId, paymentIntentId);
    const raw = JSON.stringify(event);
    const header = buildStripeSignatureHeader(raw, TEST_WEBHOOK_SECRET);
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", header)
        .send(raw);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Stripe is not configured");
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });
});

describe("event-id idempotency + exactly-once settlement", () => {
  it("replayed deliveries of the same event id never double-credit", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_replay", "checkout.session.completed", sessionId, paymentIntentId);
    const raw = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const header = "t=" + timestamp + ",v1=" + computeStripeSignature(raw, TEST_WEBHOOK_SECRET, timestamp);

    const responses = [];
    for (let i = 0; i < 5; i++) {
      responses.push(
        await request(app)
          .post("/api/stripe/webhook")
          .set("Content-Type", "application/json")
          .set("Stripe-Signature", header)
          .send(raw),
      );
    }

    expect(responses[0]!.status).toBe(200);
    expect(responses[0]!.body.action).toBe("settled");
    for (const res of responses.slice(1)) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("duplicate");
      expect(res.body.priorStatus).toBe("processed");
    }

    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(1);
    expect((await purchaseForOrder(sessionId))!.status).toBe("completed");
  });

  it("concurrent duplicate deliveries (one event id) settle exactly once", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_concurrent", "checkout.session.completed", sessionId, paymentIntentId);
    const timestamp = Math.floor(Date.now() / 1000);

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => signedWebhookRequest(event, { timestamp })),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
    }
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(1);
  });

  it("concurrent DIFFERENT events for the same session settle exactly once", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const events = [
      sessionEvent("evt_a", "checkout.session.completed", sessionId, paymentIntentId),
      sessionEvent("evt_b", "checkout.session.async_payment_succeeded", sessionId, paymentIntentId),
      sessionEvent("evt_c", "checkout.session.completed", sessionId, paymentIntentId),
    ];

    const responses = await Promise.all(events.map((event) => signedWebhookRequest(event)));
    for (const res of responses) {
      expect(res.status).toBe(200);
    }

    const actions = responses.map((res) => res.body.action);
    expect(actions.filter((action) => action === "settled")).toHaveLength(1);
    expect(actions.filter((action) => action === "settle_replay")).toHaveLength(2);
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(3);
  });

  it("a new event id after settlement is a safe replay (already completed)", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    await signedWebhookRequest(
      sessionEvent("evt_first", "checkout.session.completed", sessionId, paymentIntentId),
    );
    const replay = await signedWebhookRequest(
      sessionEvent("evt_second", "checkout.session.async_payment_succeeded", sessionId, paymentIntentId),
    );
    expect(replay.status).toBe(200);
    expect(replay.body.action).toBe("settle_replay");
    expect(replay.body.reason).toBe("already_completed");
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
  });

  it("ignores unpaid checkout.session.completed then settles on async_payment_succeeded", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const unpaid = await signedWebhookRequest(
      sessionEvent("evt_unpaid", "checkout.session.completed", sessionId, paymentIntentId, "unpaid"),
    );
    expect(unpaid.status).toBe(200);
    expect(unpaid.body.status).toBe("ignored");
    expect(unpaid.body.reason).toBe("payment_status_unpaid");
    expect((await balanceOf(USER_A)).purchased).toBe(0);

    const paid = await signedWebhookRequest(
      sessionEvent("evt_async_paid", "checkout.session.async_payment_succeeded", sessionId, paymentIntentId),
    );
    expect(paid.status).toBe(200);
    expect(paid.body.action).toBe("settled");
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
  });

  it("immutably appends replay evidence (no duplicate ledger rows on event replay)", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const event = sessionEvent("evt_append_only", "checkout.session.completed", sessionId, paymentIntentId);
    await signedWebhookRequest(event);
    const before = await ledgerRowsFor(USER_A);
    await signedWebhookRequest(event);
    const after = await ledgerRowsFor(USER_A);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expect(after.map((row) => row.deltaCredits)).toEqual(["6"]);
  });
});

describe("failure path", () => {
  it("marks an expired checkout failed without granting credits", async () => {
    const { sessionId } = await createSession();
    const res = await signedWebhookRequest({
      id: "evt_expired",
      type: "checkout.session.expired",
      data: { object: { id: sessionId, object: "checkout.session", payment_status: "unpaid" } },
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("marked_failed");
    expect((await purchaseForOrder(sessionId))!.status).toBe("failed");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);

    // Replay is harmless.
    await signedWebhookRequest({
      id: "evt_expired_2",
      type: "checkout.session.expired",
      data: { object: { id: sessionId, object: "checkout.session" } },
    });
    expect((await purchaseForOrder(sessionId))!.status).toBe("failed");
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);
  });

  it("credits once when a failed purchase is later paid (processor is authoritative)", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    await signedWebhookRequest({
      id: "evt_failed",
      type: "checkout.session.expired",
      data: { object: { id: sessionId, object: "checkout.session" } },
    });
    expect((await purchaseForOrder(sessionId))!.status).toBe("failed");

    const paid = await signedWebhookRequest(
      sessionEvent("evt_late_paid", "checkout.session.completed", sessionId, paymentIntentId),
    );
    expect(paid.status).toBe(200);
    expect(paid.body.action).toBe("settled");
    expect((await purchaseForOrder(sessionId))!.status).toBe("completed");
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
  });

  it("marks the purchase failed on payment_intent.payment_failed", async () => {
    const { sessionId, paymentIntentId } = await createSession();
    const res = await signedWebhookRequest({
      id: "evt_pi_failed",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: paymentIntentId,
          object: "payment_intent",
          last_payment_error: { message: "card_declined" },
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("marked_failed");
    expect((await purchaseForOrder(sessionId))!.status).toBe("failed");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });

  it("acknowledges unknown checkout sessions and unknown event types with 200", async () => {
    const unknown = await signedWebhookRequest(
      sessionEvent("evt_unknown_session", "checkout.session.completed", "cs_unknown_123", "pi_unknown"),
    );
    expect(unknown.status).toBe(200);
    expect(unknown.body.status).toBe("ignored");
    expect(unknown.body.reason).toBe("unknown_checkout_session");

    const other = await signedWebhookRequest({
      id: "evt_other_type",
      type: "customer.created",
      data: { object: { id: "cus_1", object: "customer" } },
    });
    expect(other.status).toBe(200);
    expect(other.body.status).toBe("ignored");
    expect(other.body.reason).toContain("unhandled_event_type");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });

  it("does not settle a non-Stripe purchase row with the same order id", async () => {
    const orderId = "cs_razorpay_shared_account";
    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId: USER_A,
      orderId,
      creditsPurchased: "5",
      status: "pending",
      metadata: { provider: "razorpay" },
    });
    const res = await signedWebhookRequest(
      sessionEvent("evt_cross_provider", "checkout.session.completed", orderId, "pi_x"),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    const [row] = await db
      .select()
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.orderId, orderId));
    expect(row!.status).toBe("pending");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });
});

describe("refund / reversal path", () => {
  async function settledSession() {
    const created = await createSession("credit_6", USER_A);
    await signedWebhookRequest(
      sessionEvent("evt_settle_for_refund", "checkout.session.completed", created.sessionId, created.paymentIntentId),
    );
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    return created;
  }

  function fullRefundEvent(eventId: string, paymentIntentId: string, refundId: string) {
    return {
      id: eventId,
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_1",
          object: "charge",
          payment_intent: paymentIntentId,
          refunded: true,
          amount: 7800,
          amount_refunded: 7800,
          refunds: { data: [{ id: refundId, object: "refund" }] },
        },
      },
    };
  }

  it("reverses a credit grant exactly once and appends a negative ledger row", async () => {
    const { sessionId, paymentIntentId } = await settledSession();
    const res = await signedWebhookRequest(fullRefundEvent("evt_refund_1", paymentIntentId, "re_test_1"));

    expect(res.status).toBe(200);
    expect(res.body.action).toBe("reversed");
    expect(res.body.credits).toBe(6);
    expect((await purchaseForOrder(sessionId))!.status).toBe("refunded");
    expect((await balanceOf(USER_A)).purchased).toBe(0);

    const ledger = await ledgerRowsFor(USER_A);
    expect(ledger).toHaveLength(2);
    expect(ledger.map((row) => row.deltaCredits)).toEqual(["6", "-6"]);
    expect(ledger[1]!.entryType).toBe("refunded");
    expect(ledger[1]!.idempotencyKey).toBe("stripe:refund:re_test_1");
    expect((ledger[1]!.metadata as any).refundDecision).toBe("automated");
    // Append-only: the grant row is untouched.
    expect(ledger[0]!.entryType).toBe("purchase");
    expect(ledger[0]!.deltaCredits).toBe("6");
  });

  it("is idempotent on a replayed refund event", async () => {
    const { paymentIntentId } = await settledSession();
    const event = fullRefundEvent("evt_refund_replay", paymentIntentId, "re_replay");
    await signedWebhookRequest(event);
    const replay = await signedWebhookRequest(event);

    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe("duplicate");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(2);
  });

  it("is idempotent across refund.created + charge.refunded for the same refund", async () => {
    const { paymentIntentId } = await settledSession();
    await signedWebhookRequest(fullRefundEvent("evt_charge_refunded", paymentIntentId, "re_same"));
    const second = await signedWebhookRequest({
      id: "evt_refund_created",
      type: "refund.created",
      data: {
        object: {
          id: "re_same",
          object: "refund",
          status: "succeeded",
          charge: "ch_test_1",
          payment_intent: paymentIntentId,
          amount: 7800,
        },
      },
    });

    expect(second.status).toBe(200);
    expect(second.body.action).toBe("refund_replay");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(2);
  });

  it("ignores partial refunds (manual review) without reversing the grant", async () => {
    const { sessionId, paymentIntentId } = await settledSession();
    const res = await signedWebhookRequest({
      id: "evt_partial_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_partial",
          object: "charge",
          payment_intent: paymentIntentId,
          refunded: false,
          amount: 7800,
          amount_refunded: 100,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toBe("partial_refund_requires_manual_review");
    expect((await purchaseForOrder(sessionId))!.status).toBe("completed");
    expect((await balanceOf(USER_A)).purchased).toBe(6);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(1);
  });

  it("durably blocks a refund that arrives before settlement (out-of-order delivery)", async () => {
    const created = await createSession("credit_6", USER_A);
    const res = await signedWebhookRequest(
      fullRefundEvent("evt_refund_unsettled", created.paymentIntentId, "re_unsettled"),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toBe("refund_blocked_purchase_not_completed");
    // Durable: marked refunded so the late paid event cannot grant credits.
    expect((await purchaseForOrder(created.sessionId))!.status).toBe("refunded");
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);

    const latePaid = await signedWebhookRequest(
      sessionEvent("evt_unsettled_late_paid", "checkout.session.completed", created.sessionId, created.paymentIntentId),
    );
    expect(latePaid.status).toBe(200);
    expect(latePaid.body.action).toBe("settle_replay");
    expect(latePaid.body.reason).toBe("already_refunded");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);
  });

  it("clamps the balance projection at zero if credits were already spent", async () => {
    const { paymentIntentId } = await settledSession();
    // Simulate the buyer consuming the credits before the refund lands.
    await db
      .update(creditsBalanceTable)
      .set({ purchasedCredits: "0" })
      .where(eq(creditsBalanceTable.userId, USER_A));

    const res = await signedWebhookRequest(fullRefundEvent("evt_refund_spent", paymentIntentId, "re_spent"));
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("reversed");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    const ledger = await ledgerRowsFor(USER_A);
    // Ledger keeps the full append-only truth even though the projection clamped.
    expect(ledger.map((row) => row.deltaCredits)).toEqual(["6", "-6"]);
  });
});

describe("subscription / plan entitlements", () => {
  it("activates a subscription checkout exactly once without credit movement", async () => {
    const sub = await checkout("subscription_monthly", "USD");
    expect(sub.status).toBe(200);
    const sessionId = sub.body.data.sessionId as string;
    const event = {
      id: "evt_sub_paid",
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          object: "checkout.session",
          mode: "subscription",
          payment_status: "paid",
          payment_intent: null,
          subscription: "sub_test_1",
        },
      },
    };

    const first = await signedWebhookRequest(event);
    expect(first.status).toBe(200);
    expect(first.body.action).toBe("activated");
    const replayEvent = { ...event, id: "evt_sub_replay" };
    const replay = await signedWebhookRequest(replayEvent);
    expect(replay.status).toBe(200);
    expect(replay.body.action).toBe("settle_replay");

    expect((await purchaseForOrder(sessionId))!.status).toBe("completed");
    expect((await balanceOf(USER_A)).purchased).toBe(0);
    expect(await ledgerRowsFor(USER_A)).toHaveLength(0);
  });
});

describe("ledger invariants", () => {
  it("only ever stores non-zero deltas and keeps the running sum auditable", async () => {
    const created = await createSession("credit_9", USER_A);
    await signedWebhookRequest(
      sessionEvent("evt_sum_settle", "checkout.session.completed", created.sessionId, created.paymentIntentId),
    );
    await signedWebhookRequest({
      id: "evt_sum_refund",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_sum",
          object: "charge",
          payment_intent: created.paymentIntentId,
          refunded: true,
          amount: 11700,
          amount_refunded: 11700,
          refunds: { data: [{ id: "re_sum" }] },
        },
      },
    });

    const ledger = await ledgerRowsFor(USER_A);
    expect(ledger).toHaveLength(2);
    for (const row of ledger) {
      expect(row.deltaCredits).not.toBe("0");
      expect(row.provider).toBe("stripe");
    }
    const sum = ledger.reduce((total, row) => total + parseFloat(row.deltaCredits), 0);
    expect(sum).toBe(0); // grant 9 then reversal -9
    expect((await balanceOf(USER_A)).purchased).toBe(0);
  });
});
