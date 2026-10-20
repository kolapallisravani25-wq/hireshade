/**
 * DB-backed Razorpay billing integration tests.
 *
 * Runs ONLY against the dedicated database hireshade_razorpay_test on the
 * existing hireshade-postgres container (port 5433). Never touches
 * hireshade_dev (hard guard before @workspace/db is imported), so it cannot
 * collide with the sessions or Stripe integration suites.
 *
 * Setup (once):
 *   docker exec hireshade-postgres psql -U hireshade_dev -d hireshade_dev \
 *     -c "CREATE DATABASE hireshade_razorpay_test"
 *   DATABASE_URL=postgresql://hireshade_dev:PW@localhost:5433/hireshade_razorpay_test
 *   pnpm --filter @workspace/db run push-force
 *
 * Run:
 *   $env:POSTGRES_PASSWORD="<pw>"
 *   pnpm --dir artifacts/api-server exec vitest run tests/razorpay.integration.test.ts
 *
 * Mock gateway mode (no Razorpay keys) makes orders/subscriptions/refunds
 * deterministic and offline; signatures are still real HMACs computed over the
 * raw bytes with the configured webhook test secret.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { v4 as uuidv4 } from "uuid";

// ── Dedicated-database guard (before any @workspace/db import) ─────────────
const TEST_DB_NAME = "hireshade_razorpay_test";
const WEBHOOK_SECRET = "whsec_razorpay_integration_test";
const INTERNAL_TOKEN = "internal_refund_token_test";
const MOCK_PLAN_MONTHLY = "plan_test_monthly";
const MOCK_PLAN_WEEKLY = "plan_test_weekly";
const MOCK_PLAN_YEARLY = "plan_test_yearly";

function resolveTestDatabaseUrl(): string {
  const explicit =
    process.env["STRIPE_TEST_DATABASE_URL"] ??
    process.env["RAZORPAY_TEST_DATABASE_URL"] ??
    process.env["TEST_DATABASE_URL"];
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
      "Refusing to run Razorpay integration tests against database '" +
        databaseName +
        "'. Expected the dedicated '" +
        TEST_DB_NAME +
        "' database.",
    );
  }
}

process.env["DATABASE_URL"] = testDatabaseUrl;
process.env["NODE_ENV"] = "test"; // mock gateway mode
process.env["RAZORPAY_WEBHOOK_SECRET_TEST"] = WEBHOOK_SECRET;
process.env["RAZORPAY_INTERNAL_TOKEN"] = INTERNAL_TOKEN;
process.env["RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY"] = MOCK_PLAN_MONTHLY;
process.env["RAZORPAY_PLAN_SUBSCRIPTION_WEEKLY"] = MOCK_PLAN_WEEKLY;
process.env["RAZORPAY_PLAN_SUBSCRIPTION_YEARLY"] = MOCK_PLAN_YEARLY;
delete process.env["RAZORPAY_KEY_ID"];
delete process.env["RAZORPAY_KEY_SECRET"];
delete process.env["RAZORPAY_WEBHOOK_SECRET"];

vi.mock("../src/middlewares/requireAuth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ error: "no test user" });
    req.userId = String(uid);
    next();
  },
}));

const { db, pool } = await import("@workspace/db");
const {
  billingInvoicesTable,
  billingSubscriptionsTable,
  creditsBalanceTable,
  creditsLedgerTable,
  creditsPurchasesTable,
  razorpayWebhookEventsTable,
  usersTable,
} = await import("@workspace/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { default: razorpayRouter } = await import("../src/routes/razorpay.js");
const rzp = await import("../src/lib/razorpay.js");
const gstMod = await import("../src/lib/razorpayGst.js");

const app = express();
app.use("/api/razorpay/webhook", express.raw({ type: () => true }));
app.use(express.json());
app.use("/api/razorpay", razorpayRouter);

const USER_A = "rzp-user-a";
const USER_B = "rzp-user-b";

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

async function balanceOf(userId: string): Promise<number> {
  const [balance] = await db
    .select()
    .from(creditsBalanceTable)
    .where(eq(creditsBalanceTable.userId, userId))
    .limit(1);
  return parseFloat(balance?.purchasedCredits ?? "0") || 0;
}

async function ledgerRows(userId: string) {
  return db
    .select()
    .from(creditsLedgerTable)
    .where(eq(creditsLedgerTable.userId, userId))
    .orderBy(creditsLedgerTable.createdAt);
}

async function purchaseByOrder(orderId: string) {
  const [row] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.orderId, orderId))
    .limit(1);
  return row;
}

async function invoiceByOrder(orderId: string) {
  const [row] = await db
    .select()
    .from(billingInvoicesTable)
    .where(eq(billingInvoicesTable.providerOrderId, orderId))
    .limit(1);
  return row;
}

async function subscriptionByProviderId(providerSubscriptionId: string) {
  const [row] = await db
    .select()
    .from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.providerSubscriptionId, providerSubscriptionId))
    .limit(1);
  return row;
}

async function allEvents() {
  return db.select().from(razorpayWebhookEventsTable);
}

function auth(req: any, user: string = USER_A) {
  return req.set("x-test-user", user);
}

function createOrder(planCode = "credit_6", body: Record<string, unknown> = {}, user = USER_A) {
  return auth(
    request(app).post("/api/razorpay/order").send({ planCode, ...body }),
    user,
  );
}

function createSubscription(planCode = "subscription_monthly", body: Record<string, unknown> = {}) {
  return auth(request(app).post("/api/razorpay/subscription").send({ planCode, ...body }));
}

function rzpEvent(
  type: string,
  section: "payment" | "order" | "subscription" | "refund" | "invoice",
  entity: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    entity: "event",
    account_id: "acc_test",
    event: type,
    contains: [section],
    payload: { [section]: { entity } },
    created_at: Math.floor(Date.now() / 1000),
    ...extra,
  };
}

function postWebhook(
  event: Record<string, unknown>,
  eventId: string,
  opts: {
    secret?: string;
    header?: string;
    rawOverride?: string;
    eventIdHeader?: string | null;
  } = {},
) {
  const rawBody = opts.rawOverride ?? JSON.stringify(event);
  const secret = opts.secret ?? WEBHOOK_SECRET;
  const signature =
    opts.header ?? rzp.computeRazorpayWebhookSignature(rawBody, secret);
  const req = request(app)
    .post("/api/razorpay/webhook")
    .set("Content-Type", "application/json");
  const eventIdHeader = opts.eventIdHeader === undefined ? eventId : opts.eventIdHeader;
  if (eventIdHeader !== null) req.set("X-Razorpay-Event-Id", eventIdHeader);
  if (signature.length > 0) req.set("X-Razorpay-Signature", signature);
  return req.send(rawBody);
}

function paymentEntity(orderId: string, paymentId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: paymentId,
    entity: "payment",
    order_id: orderId,
    amount: 738000,
    currency: "INR",
    status: "captured",
    method: "upi",
    ...overrides,
  };
}

function subscriptionEntity(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "sub_int_1",
    entity: "subscription",
    plan_id: MOCK_PLAN_MONTHLY,
    customer_id: "cust_int_1",
    status: "active",
    current_start: now,
    current_end: now + 30 * 86_400,
    charge_at: now + 30 * 86_400,
    paid_count: 0,
    total_count: 12,
    payment_method: "upi",
    notes: { userId: USER_A, planCode: "subscription_monthly", currency: "INR" },
    ...overrides,
  };
}

beforeAll(async () => {
  await seedUser(USER_A);
  await seedUser(USER_B);
});

beforeEach(async () => {
  await db.delete(razorpayWebhookEventsTable);
  await db.delete(usersTable).where(inArray(usersTable.id, [USER_A, USER_B]));
  await seedUser(USER_A);
  await seedUser(USER_B);
});

afterAll(async () => {
  await pool.end();
});

// ── Dedicated DB guard ──────────────────────────────────────────────────────

describe("dedicated test database", () => {
  it("is hireshade_razorpay_test, never the shared dev database", () => {
    const parsed = new URL(process.env["DATABASE_URL"]!);
    const databaseName = parsed.pathname.replace(/^[/]+/, "");
    expect(databaseName).toBe(TEST_DB_NAME);
    expect(databaseName).not.toBe("hireshade_dev");
  });

  it("has the Razorpay webhook, subscription and invoice tables", async () => {
    await expect(db.select().from(razorpayWebhookEventsTable).limit(1)).resolves.toBeDefined();
    await expect(db.select().from(billingSubscriptionsTable).limit(1)).resolves.toBeDefined();
    await expect(db.select().from(billingInvoicesTable).limit(1)).resolves.toBeDefined();
  });
});

// ── Orders: paise/INR, server-priced, GST invoice ──────────────────────────

describe("POST /api/razorpay/order — paise orders + GST invoice", () => {
  it("creates a server-priced order in integer paise with a GST invoice", async () => {
    const res = await createOrder("credit_6");
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.planCode).toBe("credit_6");
    expect(data.amountMinor).toBe(738000); // INR catalog, integer paise
    expect(Number.isInteger(data.amountMinor)).toBe(true);
    expect(data.currency).toBe("INR");
    expect(data.credits).toBe(6);
    expect(data.orderId).toMatch(/^order_mock_/);
    expect(data.keyId).toBeNull(); // mock mode has no public key id
    expect(data.invoice).toMatchObject({
      totalMinor: 738000,
      taxInclusive: true,
      taxRateBps: 1800,
      taxType: "CGST_SGST",
    });
    expect(data.invoice.subtotalMinor + data.invoice.taxMinor).toBe(data.invoice.totalMinor);

    const purchase = await purchaseByOrder(data.orderId);
    expect(purchase!.status).toBe("pending");
    expect(purchase!.currency).toBe("INR");
    expect(purchase!.creditsPurchased).toBe("6");
    expect((purchase!.metadata as any).provider).toBe("razorpay");
    expect((purchase!.metadata as any).planCode).toBe("credit_6");

    const invoice = await invoiceByOrder(data.orderId);
    expect(invoice!.status).toBe("pending");
    expect(invoice!.totalMinor).toBe(738000);
    expect(invoice!.taxType).toBe("CGST_SGST");
    expect(invoice!.cgstMinor + invoice!.sgstMinor).toBe(invoice!.taxMinor);
  });

  it("ignores client-supplied amounts/credits/currency", async () => {
    const res = await createOrder("credit_9", {
      amountMinor: 1,
      amount: "0.01",
      credits: 9999,
      currency: "USD",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.amountMinor).toBe(1107000);
    expect(res.body.data.credits).toBe(9);
    expect(res.body.data.currency).toBe("INR");
  });

  it("computes IGST for an inter-state buyer GSTIN and persists it", async () => {
    const res = await createOrder("credit_6", { gstin: "29AAGCB7383J1Z4" });
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.taxType).toBe("IGST");
    expect(res.body.data.invoice.igstMinor).toBe(res.body.data.invoice.taxMinor);
    expect(res.body.data.invoice.placeOfSupplyStateCode).toBe("29");
    const invoice = await invoiceByOrder(res.body.data.orderId);
    expect(invoice!.gstin).toBe("29AAGCB7383J1Z4");
    expect(invoice!.igstMinor).toBe(invoice!.taxMinor);
  });

  it("rejects an invalid GSTIN and unknown/subscription plan codes", async () => {
    const badGst = await createOrder("credit_6", { gstin: "27BADGSTIN0000Z0" });
    expect(badGst.status).toBe(400);
    expect(badGst.body.error).toContain("GSTIN");

    for (const code of ["credit_10", "", "subscription_monthly"]) {
      const res = await createOrder(code);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid planCode");
    }
  });

  it("supports one-time plan products (lifetime) with zero credits", async () => {
    const res = await createOrder("lifetime_plan");
    expect(res.status).toBe(200);
    expect(res.body.data.credits).toBe(0);
    expect(res.body.data.amountMinor).toBe(5685000);
  });

  it("fails closed with 503 in production when unconfigured", async () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const res = await createOrder("credit_6");
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Razorpay is not configured");
    } finally {
      process.env["NODE_ENV"] = previous;
    }
  });

  it("never exposes secrets through the config endpoint", async () => {
    const res = await auth(request(app).get("/api/razorpay/config"));
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe("mock");
    expect(res.body.data.hasWebhookSecret).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(res.body)).not.toContain("keySecret");
  });
});

// ── Distinct checkout verification ─────────────────────────────────────────

describe("POST /api/razorpay/checkout/verify — key-secret HMAC", () => {
  it("verifies the checkout signature and settles exactly once", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const paymentId = "pay_checkout_1";
    const signature = rzp.computeRazorpayCheckoutSignature(
      orderId,
      paymentId,
      rzp.RAZORPAY_MOCK_KEY_SECRET,
    );

    const first = await auth(
      request(app).post("/api/razorpay/checkout/verify").send({ orderId, paymentId, signature }),
    );
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
    expect((await purchaseByOrder(orderId))!.status).toBe("completed");
    expect((await invoiceByOrder(orderId))!.status).toBe("paid");

    const replay = await auth(
      request(app).post("/api/razorpay/checkout/verify").send({ orderId, paymentId, signature }),
    );
    expect(replay.status).toBe(200);
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
  });

  it("rejects a bad signature and a webhook-style signature", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const paymentId = "pay_checkout_2";

    const bad = await auth(
      request(app)
        .post("/api/razorpay/checkout/verify")
        .send({ orderId, paymentId, signature: "0".repeat(64) }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe("signature_mismatch");

    // A webhook (raw-body) signature must not pass checkout verification.
    const webhookStyle = rzp.computeRazorpayWebhookSignature(
      orderId + "|" + paymentId,
      WEBHOOK_SECRET,
    );
    const wrongScheme = await auth(
      request(app)
        .post("/api/razorpay/checkout/verify")
        .send({ orderId, paymentId, signature: webhookStyle }),
    );
    expect(wrongScheme.status).toBe(400);

    expect(await balanceOf(USER_A)).toBe(0);
  });

  it("rejects missing parameters and another user's order", async () => {
    const missing = await auth(request(app).post("/api/razorpay/checkout/verify").send({}));
    expect(missing.status).toBe(400);

    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const paymentId = "pay_checkout_3";
    const signature = rzp.computeRazorpayCheckoutSignature(
      orderId,
      paymentId,
      rzp.RAZORPAY_MOCK_KEY_SECRET,
    );
    const foreign = await auth(
      request(app).post("/api/razorpay/checkout/verify").send({ orderId, paymentId, signature }),
      USER_B,
    );
    expect(foreign.status).toBe(404);
    expect(await balanceOf(USER_B)).toBe(0);
  });
});

// ── Webhook: raw-body signature + X-Razorpay-Event-Id idempotency ─────────

describe("POST /api/razorpay/webhook — signatures + event-id idempotency", () => {
  it("settles a captured payment exactly once and marks the invoice paid", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const event = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_1"));

    const res = await postWebhook(event, "evt_captured_1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, status: "processed", action: "settled", credits: 6 });
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
    expect((await purchaseByOrder(orderId))!.status).toBe("completed");
    expect((await invoiceByOrder(orderId))!.status).toBe("paid");
    expect(await allEvents()).toHaveLength(1);
  });

  it("never double-credits replayed deliveries of the same event id", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const event = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_2"));

    const first = await postWebhook(event, "evt_replay_1");
    expect(first.body.action).toBe("settled");
    for (let attempt = 0; attempt < 4; attempt++) {
      const replay = await postWebhook(event, "evt_replay_1");
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe("duplicate");
      expect(replay.body.priorStatus).toBe("processed");
    }
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(1);
  });

  it("settles exactly once under concurrent duplicate deliveries", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const event = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_3"));

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => postWebhook(event, "evt_concurrent_1")),
    );
    for (const res of responses) expect(res.status).toBe(200);
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(1);
  });

  it("settles exactly once across different event ids for the same order", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const captured = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_4"));
    const orderPaid = rzpEvent("order.paid", "order", {
      id: orderId,
      entity: "order",
      status: "paid",
      amount: 738000,
    });

    const responses = await Promise.all([
      postWebhook(captured, "evt_captured_4"),
      postWebhook(orderPaid, "evt_order_paid_4"),
    ]);
    const actions = responses.map((res) => res.body.action);
    expect(actions.filter((action) => action === "settled")).toHaveLength(1);
    expect(actions.filter((action) => action === "settle_replay")).toHaveLength(1);
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
    expect(await allEvents()).toHaveLength(2);
  });

  it("rejects an invalid signature, a tampered body, a checkout-style signature", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const event = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_5"));

    const badSignature = await postWebhook(event, "evt_bad_sig", { secret: "whsec_wrong" });
    expect(badSignature.status).toBe(400);
    expect(badSignature.body.reason).toBe("signature_mismatch");

    const raw = JSON.stringify(event);
    const validHeader = rzp.computeRazorpayWebhookSignature(raw, WEBHOOK_SECRET);
    const tampered = await postWebhook(event, "evt_tampered", {
      header: validHeader,
      rawOverride: raw.replace("captured", "captured "),
    });
    expect(tampered.status).toBe(400);

    const checkoutStyle = rzp.computeRazorpayCheckoutSignature(
      orderId,
      "pay_wh_5",
      rzp.RAZORPAY_MOCK_KEY_SECRET,
    );
    const wrongScheme = await postWebhook(event, "evt_wrong_scheme", {
      header: checkoutStyle,
    });
    expect(wrongScheme.status).toBe(400);

    expect(await balanceOf(USER_A)).toBe(0);
    expect(await allEvents()).toHaveLength(0);
  });

  it("requires X-Razorpay-Event-Id and the webhook secret", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const event = rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_wh_6"));

    const noEventId = await postWebhook(event, "ignored", { eventIdHeader: null });
    expect(noEventId.status).toBe(400);
    expect(noEventId.body.error).toContain("X-Razorpay-Event-Id");

    const previous = process.env["RAZORPAY_WEBHOOK_SECRET_TEST"];
    delete process.env["RAZORPAY_WEBHOOK_SECRET_TEST"];
    try {
      const noSecret = await postWebhook(event, "evt_no_secret");
      expect(noSecret.status).toBe(503);
      expect(noSecret.body.error).toBe("Webhook not configured");
    } finally {
      process.env["RAZORPAY_WEBHOOK_SECRET_TEST"] = previous;
    }
    expect(await balanceOf(USER_A)).toBe(0);
  });
});

// ── Payment lifecycle events ────────────────────────────────────────────────

describe("payment lifecycle", () => {
  it("records payment.authorized without crediting; capture credits", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const authorized = await postWebhook(
      rzpEvent(
        "payment.authorized",
        "payment",
        paymentEntity(orderId, "pay_life_1", { status: "authorized" }),
      ),
      "evt_authorized_1",
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body.action).toBe("payment_recorded");
    expect(await balanceOf(USER_A)).toBe(0);
    expect((await purchaseByOrder(orderId))!.paymentId).toBe("pay_life_1");

    const captured = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_life_1")),
      "evt_captured_life_1",
    );
    expect(captured.body.action).toBe("settled");
    expect(await balanceOf(USER_A)).toBe(6);
  });

  it("marks payment.failed without credit, then credits a later capture", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const failed = await postWebhook(
      rzpEvent(
        "payment.failed",
        "payment",
        paymentEntity(orderId, "pay_life_2", { status: "failed" }),
      ),
      "evt_failed_1",
    );
    expect(failed.body.action).toBe("marked_failed");
    expect((await purchaseByOrder(orderId))!.status).toBe("failed");
    expect(await balanceOf(USER_A)).toBe(0);

    const captured = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_life_2")),
      "evt_captured_life_2",
    );
    expect(captured.body.action).toBe("settled");
    expect((await purchaseByOrder(orderId))!.status).toBe("completed");
    expect(await balanceOf(USER_A)).toBe(6);
  });

  it("settles order.paid alone, then ignores the later capture", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const first = await postWebhook(
      rzpEvent("order.paid", "order", { id: orderId, entity: "order", status: "paid" }),
      "evt_order_paid_5",
    );
    expect(first.body.action).toBe("settled");
    expect(await balanceOf(USER_A)).toBe(6);

    const later = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_life_3")),
      "evt_captured_life_3",
    );
    expect(later.body.action).toBe("settle_replay");
    expect(await balanceOf(USER_A)).toBe(6);
    expect(await ledgerRows(USER_A)).toHaveLength(1);
  });

  it("acknowledges unknown orders without crediting", async () => {
    const res = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity("order_unknown_xyz", "pay_unknown")),
      "evt_unknown_order",
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toBe("unknown_order");
    expect(await balanceOf(USER_A)).toBe(0);
  });

  it("settles a legacy credits.ts purchase (no metadata.provider)", async () => {
    const legacyOrderId = "order_legacy_123";
    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId: USER_A,
      orderId: legacyOrderId,
      amount: "7380.00",
      currency: "INR",
      creditsPurchased: "6",
      status: "pending",
    });
    const res = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(legacyOrderId, "pay_legacy")),
      "evt_legacy",
    );
    expect(res.body.action).toBe("settled");
    expect(await balanceOf(USER_A)).toBe(6);
    expect((await purchaseByOrder(legacyOrderId))!.status).toBe("completed");
  });
});

// ── Refunds: API + compensating ledger entries ─────────────────────────────

describe("refunds — refund API + compensating ledger", () => {
  async function settledOrder(planCode = "credit_6") {
    const order = await createOrder(planCode);
    const orderId = order.body.data.orderId as string;
    await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, "pay_refund_" + planCode)),
      "evt_settle_" + planCode,
    );
    return { orderId, paymentId: "pay_refund_" + planCode };
  }

  it("reverses a full refund exactly once (refund.processed)", async () => {
    const { orderId, paymentId } = await settledOrder();
    expect(await balanceOf(USER_A)).toBe(6);

    const created = await postWebhook(
      rzpEvent("refund.created", "refund", {
        id: "rfnd_full_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 738000,
        status: "created",
      }),
      "evt_refund_created_1",
    );
    expect(created.body.action).toBe("refund_recorded");
    expect(await ledgerRows(USER_A)).toHaveLength(1);

    const processed = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_full_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 738000,
        status: "processed",
      }),
      "evt_refund_processed_1",
    );
    expect(processed.body.action).toBe("refund_reversed");
    expect(processed.body.credits).toBe(6);
    expect((await purchaseByOrder(orderId))!.status).toBe("refunded");
    expect((await invoiceByOrder(orderId))!.status).toBe("refunded");
    expect(await balanceOf(USER_A)).toBe(0);
    const ledger = await ledgerRows(USER_A);
    expect(ledger.map((row) => row.deltaCredits)).toEqual(["6", "-6"]);

    const replay = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_full_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 738000,
        status: "processed",
      }),
      "evt_refund_processed_1",
    );
    expect(replay.body.status).toBe("duplicate");
    expect(await balanceOf(USER_A)).toBe(0);

    const replayNewId = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_full_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 738000,
        status: "processed",
      }),
      "evt_refund_processed_dup_id",
    );
    expect(replayNewId.body.action).toBe("refund_replay");
    expect(await balanceOf(USER_A)).toBe(0);
    expect(await ledgerRows(USER_A)).toHaveLength(2);
  });

  it("appends proportional compensating entries for partial refunds", async () => {
    const { orderId, paymentId } = await settledOrder("credit_6");
    const firstPartial = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_partial_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 369000, // half of 738000
        status: "processed",
      }),
      "evt_partial_1",
    );
    expect(firstPartial.body.action).toBe("refund_reversed");
    expect(firstPartial.body.reason).toBe("partial");
    expect(firstPartial.body.credits).toBe(3);
    expect(await balanceOf(USER_A)).toBe(3);
    // A partial refund does not mark the purchase fully refunded.
    expect((await purchaseByOrder(orderId))!.status).toBe("completed");

    const secondPartial = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_partial_2",
        entity: "refund",
        payment_id: paymentId,
        amount: 369000,
        status: "processed",
      }),
      "evt_partial_2",
    );
    expect(secondPartial.body.action).toBe("refund_reversed");
    expect(await balanceOf(USER_A)).toBe(0);
    const ledger = await ledgerRows(USER_A);
    expect(ledger.map((row) => row.deltaCredits)).toEqual(["6", "-3", "-3"]);
  });

  it("durably blocks a refund that arrives before capture", async () => {
    const order = await createOrder("credit_6");
    const orderId = order.body.data.orderId as string;
    const paymentId = "pay_before_capture";
    await postWebhook(
      rzpEvent("payment.authorized", "payment", paymentEntity(orderId, paymentId, { status: "authorized" })),
      "evt_authorized_before_refund",
    );
    const processed = await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_before_capture",
        entity: "refund",
        payment_id: paymentId,
        amount: 738000,
        status: "processed",
      }),
      "evt_refund_before_capture",
    );
    expect(processed.body.action).toBe("refund_blocked");
    expect((await purchaseByOrder(orderId))!.status).toBe("refunded");
    expect(await ledgerRows(USER_A)).toHaveLength(0);

    const lateCapture = await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, paymentId)),
      "evt_late_capture",
    );
    expect(lateCapture.body.action).toBe("settle_replay");
    expect(lateCapture.body.reason).toBe("already_refunded");
    expect(await balanceOf(USER_A)).toBe(0);
    expect(await ledgerRows(USER_A)).toHaveLength(0);
  });

  it("creates the refund via the API and compensates immediately (idempotent)", async () => {
    const { orderId, paymentId } = await settledOrder("credit_6");

    const unauthorized = await request(app)
      .post("/api/razorpay/refund")
      .set("x-internal-token", "wrong")
      .send({ orderId });
    expect(unauthorized.status).toBe(401);

    const refund = await request(app)
      .post("/api/razorpay/refund")
      .set("x-internal-token", INTERNAL_TOKEN)
      .send({ orderId, amountMinor: 738000, reason: "test_refund" });
    expect(refund.status).toBe(200);
    expect(refund.body.data.refundId).toMatch(/^rfnd_mock_/);
    expect(refund.body.data.compensation).toBe("reversed");
    expect(refund.body.data.creditsReversed).toBe(6);
    expect(await balanceOf(USER_A)).toBe(0);
    expect((await purchaseByOrder(orderId))!.status).toBe("refunded");
    expect((await ledgerRows(USER_A)).map((row) => row.deltaCredits)).toEqual(["6", "-6"]);

    // Same deterministic mock refund id => idempotent replay.
    const replay = await request(app)
      .post("/api/razorpay/refund")
      .set("x-internal-token", INTERNAL_TOKEN)
      .send({ orderId, amountMinor: 738000 });
    expect(replay.status).toBe(200);
    expect(replay.body.data.compensation).toBe("already_refunded");
    expect(await balanceOf(USER_A)).toBe(0);
    expect(await ledgerRows(USER_A)).toHaveLength(2);
  });

  it("fails closed when the internal refund token is not configured", async () => {
    const previous = process.env["RAZORPAY_INTERNAL_TOKEN"];
    delete process.env["RAZORPAY_INTERNAL_TOKEN"];
    try {
      const res = await request(app).post("/api/razorpay/refund").send({ orderId: "order_x" });
      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Refund endpoint not configured");
    } finally {
      process.env["RAZORPAY_INTERNAL_TOKEN"] = previous;
    }
  });
});

// ── Subscriptions / mandates: halt pauses entitlement, resume restores ────

describe("subscriptions + mandates", () => {
  async function provisionedSubscription() {
    const created = await createSubscription("subscription_monthly");
    expect(created.status).toBe(200);
    const subscriptionId = created.body.data.subscriptionId as string;
    await postWebhook(
      rzpEvent("subscription.authenticated", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_authenticated",
    );
    await postWebhook(
      rzpEvent("subscription.activated", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_activated",
    );
    return subscriptionId;
  }

  it("creates a subscription with the configured dashboard plan id", async () => {
    const res = await createSubscription("subscription_monthly");
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.planCode).toBe("subscription_monthly");
    expect(data.planId).toBe(MOCK_PLAN_MONTHLY);
    expect(data.totalCount).toBe(12);
    expect(data.subscriptionId).toMatch(/^sub_mock_/);
    expect(data.invoice.taxType).toBe("CGST_SGST");

    const row = await subscriptionByProviderId(data.subscriptionId);
    expect(row).toBeTruthy();
    expect(row!.gateway).toBe("razorpay");
    expect(row!.planCode).toBe("subscription_monthly");
    expect(row!.entitlementState).toBe("active");

    const entitlement = await auth(request(app).get("/api/razorpay/entitlement"));
    expect(entitlement.status).toBe(200);
    expect(entitlement.body.data[0].gateway).toBe("razorpay");
    expect(entitlement.body.data[0].features.length).toBeGreaterThan(0);
  });

  it("rejects unknown/subscription plan codes and missing dashboard plan ids", async () => {
    const bad = await createSubscription("credit_6");
    expect(bad.status).toBe(400);

    const previous = process.env["RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY"];
    delete process.env["RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY"];
    // Configure real (test-mode) keys so the route reaches plan resolution and
    // fails closed there instead of hitting the generic "not configured" 503.
    process.env["RAZORPAY_KEY_ID"] = "rzp_test_plancheck";
    process.env["RAZORPAY_KEY_SECRET"] = "secret_plancheck";
    try {
      const unconfigured = await createSubscription("subscription_monthly");
      expect(unconfigured.status).toBe(503);
      expect(unconfigured.body.error).toContain("plan not configured");
    } finally {
      process.env["RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY"] = previous;
      delete process.env["RAZORPAY_KEY_ID"];
      delete process.env["RAZORPAY_KEY_SECRET"];
    }
  });

  it("provisions out-of-order from webhook notes, then applies activation", async () => {
    const eventId = "evt_sub_provision_" + uuidv4().slice(0, 8);
    const res = await postWebhook(
      rzpEvent(
        "subscription.activated",
        "subscription",
        subscriptionEntity({ id: "sub_out_of_order_1" }),
      ),
      eventId,
    );
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("subscription_applied");
    const row = await subscriptionByProviderId("sub_out_of_order_1");
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(USER_A);
    expect(row!.status).toBe("active");
    expect(row!.entitlementState).toBe("active");
  });

  it("stores the pre-debit notification window on pending mandates", async () => {
    const subscriptionId = await provisionedSubscription();
    const chargeAt = Math.floor(Date.now() / 1000) + 3 * 86_400;
    const res = await postWebhook(
      rzpEvent(
        "subscription.pending",
        "subscription",
        subscriptionEntity({ id: subscriptionId, charge_at: chargeAt }),
      ),
      "evt_sub_pending",
    );
    expect(res.body.action).toBe("subscription_applied");
    const row = await subscriptionByProviderId(subscriptionId);
    expect(row!.status).toBe("pending");
    expect(row!.preDebitWindowHours).toBe(24);
    expect(row!.nextChargeAt!.getTime()).toBe(chargeAt * 1000);
    expect(row!.preDebitNotifyAt!.getTime()).toBe((chargeAt - 24 * 3600) * 1000);
  });

  it("halted PAUSES entitlement without deleting the row; resumed restores it", async () => {
    const subscriptionId = await provisionedSubscription();
    const halted = await postWebhook(
      rzpEvent("subscription.halted", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_halted",
    );
    expect(halted.body.action).toBe("subscription_applied");
    expect(halted.body.entitlementState).toBe("paused");

    const pausedRow = await subscriptionByProviderId(subscriptionId);
    expect(pausedRow!.status).toBe("halted");
    expect(pausedRow!.entitlementState).toBe("paused");
    expect(pausedRow!.haltedAt).toBeTruthy();
    // Not deleted: entitlement endpoint still returns the suspended subscription.
    const suspended = await auth(request(app).get("/api/razorpay/entitlement"));
    expect(suspended.body.data).toHaveLength(1);
    expect(suspended.body.data[0].entitlementState).toBe("paused");
    expect(suspended.body.data[0].features).toEqual([]);

    const resumed = await postWebhook(
      rzpEvent("subscription.resumed", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_resumed",
    );
    expect(resumed.body.entitlementState).toBe("active");
    const activeRow = await subscriptionByProviderId(subscriptionId);
    expect(activeRow!.status).toBe("active");
    expect(activeRow!.entitlementState).toBe("active");
    expect(activeRow!.resumedAt).toBeTruthy();
    const restored = await auth(request(app).get("/api/razorpay/entitlement"));
    expect(restored.body.data[0].features.length).toBeGreaterThan(0);
  });

  it("cancelled is terminal: stale activated events are ignored", async () => {
    const subscriptionId = await provisionedSubscription();
    const cancelled = await postWebhook(
      rzpEvent("subscription.cancelled", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_cancelled",
    );
    expect(cancelled.body.entitlementState).toBe("cancelled");

    const stale = await postWebhook(
      rzpEvent("subscription.activated", "subscription", subscriptionEntity({ id: subscriptionId })),
      "evt_sub_stale_activated",
    );
    expect(stale.status).toBe(200);
    expect(stale.body.status).toBe("ignored");
    expect(stale.body.reason).toBe("stale_transition");
    const row = await subscriptionByProviderId(subscriptionId);
    expect(row!.status).toBe("cancelled");
    expect(row!.entitlementState).toBe("cancelled");
  });

  it("subscription.charged and invoice.paid advance the billing period + GST invoice", async () => {
    const subscriptionId = await provisionedSubscription();
    const periodStart = Math.floor(Date.now() / 1000);
    const periodEnd = periodStart + 30 * 86_400;
    const charged = await postWebhook(
      rzpEvent(
        "subscription.charged",
        "subscription",
        subscriptionEntity({
          id: subscriptionId,
          paid_count: 1,
          current_start: periodStart,
          current_end: periodEnd,
          charge_at: periodEnd,
        }),
      ),
      "evt_sub_charged",
    );
    expect(charged.body.action).toBe("subscription_applied");
    expect((await subscriptionByProviderId(subscriptionId))!.paidCount).toBe(1);

    const invoicePaid = await postWebhook(
      rzpEvent("invoice.paid", "invoice", {
        id: "inv_int_1",
        entity: "invoice",
        subscription_id: subscriptionId,
        payment_id: "pay_inv_1",
        status: "paid",
        amount_paid: 947000,
        period_start: periodStart,
        period_end: periodEnd,
        paid_count: 1,
        notes: {},
      }),
      "evt_invoice_paid",
    );
    expect(invoicePaid.body.action).toBe("invoice_paid");
    const [invoice] = await db
      .select()
      .from(billingInvoicesTable)
      .where(eq(billingInvoicesTable.providerInvoiceId, "inv_int_1"))
      .limit(1);
    expect(invoice).toBeTruthy();
    expect(invoice!.status).toBe("paid");
    expect(invoice!.totalMinor).toBe(947000);
    expect(invoice!.taxType).toBe("CGST_SGST");
    expect(invoice!.subtotalMinor + invoice!.taxMinor).toBe(invoice!.totalMinor);
    const row = await subscriptionByProviderId(subscriptionId);
    expect(row!.currentPeriodEnd!.getTime()).toBe(periodEnd * 1000);
  });

  it("ignores subscriptions whose plan cannot be resolved", async () => {
    const res = await postWebhook(
      rzpEvent(
        "subscription.activated",
        "subscription",
        subscriptionEntity({ id: "sub_unknown_plan", plan_id: "plan_not_mapped", notes: {} }),
      ),
      "evt_unknown_plan",
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(res.body.reason).toBe("unknown_plan");
    expect(await subscriptionByProviderId("sub_unknown_plan")).toBeUndefined();
  });
});

// ── Management routes by issuing gateway ───────────────────────────────────

describe("subscription management routes by issuing gateway", () => {
  it("cancels a Razorpay-issued subscription", async () => {
    const created = await createSubscription("subscription_monthly");
    const subscriptionId = created.body.data.subscriptionId as string;
    const res = await auth(
      request(app).post("/api/razorpay/subscription/cancel").send({ cancelAtCycleEnd: true }),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.gateway).toBe("razorpay");
    expect(res.body.data.providerStatus).toBe("cancelled");
    expect((await subscriptionByProviderId(subscriptionId))!.status).toBe("cancelled");
  });

  it("routes a Stripe-issued subscription to Stripe management instead of cancelling it here", async () => {
    await db.insert(billingSubscriptionsTable).values({
      id: uuidv4(),
      userId: USER_A,
      gateway: "stripe",
      planCode: "subscription_monthly",
      providerSubscriptionId: "sub_stripe_1",
      status: "active",
      entitlementState: "active",
      currency: "USD",
      amountMinor: 9990,
    });
    const res = await auth(
      request(app).post("/api/razorpay/subscription/cancel").send({}),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GATEWAY_MANAGED_ELSEWHERE");
    expect(res.body.gateway).toBe("stripe");
    const [row] = await db
      .select()
      .from(billingSubscriptionsTable)
      .where(eq(billingSubscriptionsTable.providerSubscriptionId, "sub_stripe_1"));
    expect(row!.status).toBe("active");
  });
});

// ── Ledger invariants ──────────────────────────────────────────────────────

describe("append-only ledger invariants", () => {
  it("records grants and refunds as ledger rows with no zero deltas", async () => {
    const order = await createOrder("credit_9");
    const orderId = order.body.data.orderId as string;
    const paymentId = "pay_invariant_1";
    await postWebhook(
      rzpEvent("payment.captured", "payment", paymentEntity(orderId, paymentId)),
      "evt_invariant_capture",
    );
    await postWebhook(
      rzpEvent("refund.processed", "refund", {
        id: "rfnd_invariant_1",
        entity: "refund",
        payment_id: paymentId,
        amount: 1107000,
        status: "processed",
      }),
      "evt_invariant_refund",
    );
    const ledger = await ledgerRows(USER_A);
    expect(ledger).toHaveLength(2);
    for (const row of ledger) {
      expect(row.deltaCredits).not.toBe("0");
      expect(row.provider).toBe("razorpay");
    }
    expect(ledger.reduce((sum, row) => sum + parseFloat(row.deltaCredits), 0)).toBe(0);
    expect(await balanceOf(USER_A)).toBe(0);
  });
});
