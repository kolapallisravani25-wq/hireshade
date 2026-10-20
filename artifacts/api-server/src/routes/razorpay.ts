/**
 * Razorpay billing routes — first-class alongside the Stripe routes.
 *
 * Mounted at /api/razorpay. The legacy Razorpay order/webhook endpoints in
 * routes/credits.ts remain for backward compatibility; THESE are the
 * full-featured endpoints (subscriptions, mandates, GST invoices, refunds).
 * Both settlement paths share the same purchase-row claim + ledger idempotency
 * keys, so a purchase can never be credited twice regardless of which endpoint
 * sees the event first.
 *
 * Secret handling: responses carry the PUBLIC key_id (Razorpay Checkout JS
 * needs it) and never the key secret or webhook secret. All gateway calls are
 * server-side only.
 */

import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "@workspace/db";
import {
  billingInvoicesTable,
  billingSubscriptionsTable,
  creditsPurchasesTable,
  usersTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  cancelRazorpaySubscription,
  computePreDebitNotificationAt,
  createRazorpayOrder,
  createRazorpayRefund,
  createRazorpaySubscription,
  findOrCreateRazorpayCustomer,
  getRazorpayKeyId,
  MANDATE_PRE_DEBIT_WINDOW_HOURS,
  readRazorpayConfig,
  RazorpayApiError,
  RazorpayNotConfiguredError,
  RazorpayValidationError,
  RAZORPAY_MOCK_KEY_SECRET,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "../lib/razorpay.js";
import {
  BILLING_PLANS,
  DEFAULT_SUBSCRIPTION_TOTAL_COUNT,
  resolveBillingPlan,
  resolveRazorpayPlanId,
} from "../lib/razorpayPlans.js";
import {
  computeGst,
  configuredGstInclusive,
  configuredGstRateBps,
  configuredSupplierStateCode,
  RazorpayGstError,
} from "../lib/razorpayGst.js";
import {
  processRazorpayWebhookEvent,
  purchaseGateway,
  reverseRazorpayPurchase,
  settleRazorpayPurchase,
} from "../lib/razorpayWebhook.js";

const router: IRouter = Router();

/** Public provider config for the billing UI (no secrets). */
router.get("/config", (_req, res) => {
  const config = readRazorpayConfig();
  res.json({
    data: {
      provider: "razorpay",
      mode: config.mode,
      configured: config.mode !== "unconfigured",
      keyId: config.keyId,
      hasWebhookSecret: config.webhookSecret !== null,
      webhookSecretSource: config.webhookSecretSource,
      preDebitWindowHours: MANDATE_PRE_DEBIT_WINDOW_HOURS,
      gst: {
        inclusive: configuredGstInclusive(),
        rateBps: configuredGstRateBps(),
        supplierStateCode: configuredSupplierStateCode(),
      },
    },
  });
});

/** Canonical plan mapping table made visible to clients (both gateways). */
router.get("/plans", (_req, res) => {
  res.json({
    data: BILLING_PLANS.map((plan) => ({
      code: plan.code,
      name: plan.name,
      kind: plan.kind,
      credits: plan.credits,
      interval: plan.interval ?? null,
      amountMinor: { INR: plan.amountMinor.INR, USD: plan.amountMinor.USD },
      features: plan.features,
      // Whether this deployment has a Razorpay dashboard plan id configured.
      razorpayReady: plan.kind !== "subscription" || resolveRazorpayPlanId(plan) !== null,
    })),
  });
});

function gstFor(amountMinor: number, body: { gstin?: unknown; placeOfSupplyStateCode?: unknown }) {
  return computeGst({
    amountMinor,
    taxInclusive: configuredGstInclusive(),
    taxRateBps: configuredGstRateBps(),
    supplierStateCode: configuredSupplierStateCode(),
    gstin: typeof body.gstin === "string" ? body.gstin : null,
    placeOfSupplyStateCode:
      typeof body.placeOfSupplyStateCode === "string" ? body.placeOfSupplyStateCode : undefined,
  });
}

function invoiceResponse(gst: ReturnType<typeof computeGst>) {
  return {
    totalMinor: gst.totalMinor,
    subtotalMinor: gst.subtotalMinor,
    taxMinor: gst.taxMinor,
    cgstMinor: gst.cgstMinor,
    sgstMinor: gst.sgstMinor,
    igstMinor: gst.igstMinor,
    taxType: gst.taxType,
    taxRateBps: gst.taxRateBps,
    taxInclusive: gst.taxInclusive,
    gstin: gst.gstin,
    placeOfSupplyStateCode: gst.placeOfSupplyStateCode,
    supplierStateCode: gst.supplierStateCode,
    currency: "INR",
  };
}

/**
 * POST /api/razorpay/order
 * Body: { productCode|planCode|packCode, gstin?, placeOfSupplyStateCode? }
 * One-time purchase (credit pack or prepaid/lifetime plan). Amount is resolved
 * server-side from the plan map in PAISE (integer minor units, INR only).
 */
router.post("/order", requireAuth, async (req, res) => {
  try {
    const config = readRazorpayConfig();
    if (config.mode === "unconfigured") {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code =
      typeof body["productCode"] === "string"
        ? body["productCode"]
        : typeof body["planCode"] === "string"
          ? body["planCode"]
          : typeof body["packCode"] === "string"
            ? body["packCode"]
            : "";
    const plan = resolveBillingPlan(code);
    if (!plan || plan.kind === "subscription") {
      res.status(400).json({ error: "Invalid planCode" });
      return;
    }

    const amountMinor = plan.amountMinor.INR;
    const gst = gstFor(amountMinor, body);
    const userId = req.userId!;

    const order = await createRazorpayOrder({
      amountMinor: gst.totalMinor,
      currency: "INR",
      receipt: ("hs_" + userId.slice(0, 12) + "_" + Date.now() + "_" + uuidv4().slice(0, 8)).slice(0, 40),
      notes: { userId, planCode: plan.code, gstin: gst.gstin ?? "" },
    });

    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId,
      orderId: order.id,
      amount: (gst.totalMinor / 100).toFixed(2),
      currency: "INR",
      creditsPurchased: String(plan.credits),
      status: "pending",
      metadata: {
        provider: "razorpay",
        planCode: plan.code,
        planKind: plan.kind,
        gstin: gst.gstin,
        placeOfSupplyStateCode: gst.placeOfSupplyStateCode,
        taxType: gst.taxType,
        totalMinor: gst.totalMinor,
        taxMinor: gst.taxMinor,
      },
    });

    await db
      .insert(billingInvoicesTable)
      .values({
        id: uuidv4(),
        userId,
        gateway: "razorpay",
        planCode: plan.code,
        providerOrderId: order.id,
        gstin: gst.gstin,
        placeOfSupplyStateCode: gst.placeOfSupplyStateCode,
        taxType: gst.taxType,
        taxRateBps: gst.taxRateBps,
        subtotalMinor: gst.subtotalMinor,
        taxMinor: gst.taxMinor,
        cgstMinor: gst.cgstMinor,
        sgstMinor: gst.sgstMinor,
        igstMinor: gst.igstMinor,
        totalMinor: gst.totalMinor,
        currency: "INR",
        status: "pending",
      })
      .onConflictDoNothing();

    res.json({
      success: true,
      data: {
        orderId: order.id,
        keyId: config.keyId ?? getRazorpayKeyId() ?? null,
        amountMinor: gst.totalMinor,
        currency: "INR",
        planCode: plan.code,
        credits: plan.credits,
        mode: config.mode,
        invoice: invoiceResponse(gst),
      },
    });
  } catch (err) {
    if (err instanceof RazorpayNotConfiguredError) {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    if (err instanceof RazorpayGstError || err instanceof RazorpayValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof RazorpayApiError) {
      logger.error({ err, status: err.status }, "[razorpay] order API error");
      res.status(502).json({ error: "Razorpay order unavailable" });
      return;
    }
    logger.error({ err }, "[razorpay] order error");
    res.status(500).json({ error: "Failed to create order" });
  }
});

/**
 * POST /api/razorpay/subscription
 * Body: { planCode, gstin?, placeOfSupplyStateCode?, totalCount? }
 * Recurring mandate (UPI Autopay / card e-mandate). Requires the Razorpay
 * dashboard plan id for the plan (RAZORPAY_PLAN_<CODE>); fails closed with 503
 * when that mapping is missing.
 */
router.post("/subscription", requireAuth, async (req, res) => {
  try {
    const config = readRazorpayConfig();
    if (config.mode === "unconfigured") {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const plan = resolveBillingPlan(body["planCode"]);
    if (!plan || plan.kind !== "subscription") {
      res.status(400).json({ error: "Invalid planCode" });
      return;
    }
    const planId = resolveRazorpayPlanId(plan);
    if (!planId) {
      logger.error({ planCode: plan.code }, "[razorpay] subscription plan id not configured");
      res.status(503).json({ error: "Razorpay subscription plan not configured" });
      return;
    }

    const amountMinor = plan.amountMinor.INR;
    const gst = gstFor(amountMinor, body);
    const userId = req.userId!;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const email = user?.email ?? userId + "@users.hireshade.app";

    const customer = await findOrCreateRazorpayCustomer({
      email,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
      notes: { userId },
    });

    const totalCount =
      typeof body["totalCount"] === "number" &&
      Number.isInteger(body["totalCount"]) &&
      body["totalCount"] > 0
        ? body["totalCount"]
        : DEFAULT_SUBSCRIPTION_TOTAL_COUNT[plan.interval ?? "month"];

    const subscription = await createRazorpaySubscription({
      planId,
      customerId: customer.id,
      totalCount,
      notes: {
        userId,
        planCode: plan.code,
        currency: "INR",
        gstin: gst.gstin ?? "",
        placeOfSupplyStateCode: gst.placeOfSupplyStateCode,
      },
      notifyInfo: { notify_email: email },
    });

    const now = new Date();
    await db
      .insert(billingSubscriptionsTable)
      .values({
        id: uuidv4(),
        userId,
        gateway: "razorpay",
        planCode: plan.code,
        providerSubscriptionId: subscription.id,
        providerPlanId: planId,
        providerCustomerId: customer.id,
        status: subscription.status ?? "created",
        entitlementState: "active",
        mandateMethod: "unknown",
        currency: "INR",
        amountMinor,
        interval: plan.interval ?? null,
        totalCount,
        paidCount: 0,
        currentPeriodStart: subscription.current_start
          ? new Date(subscription.current_start * 1000)
          : null,
        currentPeriodEnd: subscription.current_end
          ? new Date(subscription.current_end * 1000)
          : null,
        nextChargeAt: subscription.charge_at
          ? new Date(subscription.charge_at * 1000)
          : subscription.current_end
            ? new Date(subscription.current_end * 1000)
            : null,
        preDebitNotifyAt: subscription.charge_at
          ? computePreDebitNotificationAt({
              chargeAt: new Date(subscription.charge_at * 1000),
              now,
            })
          : null,
        preDebitWindowHours: MANDATE_PRE_DEBIT_WINDOW_HOURS,
        metadata: { gstin: gst.gstin, placeOfSupplyStateCode: gst.placeOfSupplyStateCode },
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    res.json({
      success: true,
      data: {
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url ?? null,
        planCode: plan.code,
        planId,
        keyId: config.keyId ?? getRazorpayKeyId() ?? null,
        status: subscription.status ?? "created",
        totalCount,
        mode: config.mode,
        invoice: invoiceResponse(gst),
      },
    });
  } catch (err) {
    if (err instanceof RazorpayNotConfiguredError) {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    if (err instanceof RazorpayGstError || err instanceof RazorpayValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof RazorpayApiError) {
      logger.error({ err, status: err.status }, "[razorpay] subscription API error");
      res.status(502).json({ error: "Razorpay subscription unavailable" });
      return;
    }
    logger.error({ err }, "[razorpay] subscription error");
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

/**
 * POST /api/razorpay/checkout/verify
 * Distinct verification #1: HMAC-SHA256(key_secret, orderId + "|" + paymentId),
 * compared against the checkout signature. Never confuses with the webhook's
 * raw-body/event signature.
 */
router.post("/checkout/verify", requireAuth, async (req, res) => {
  try {
    const config = readRazorpayConfig();
    if (config.mode === "unconfigured") {
      res.status(503).json({ error: "Payment verification not configured" });
      return;
    }
    // Mock mode is keyless by design; use the fixed fake verification secret.
    const keySecret =
      config.keySecret ?? (config.mode === "mock" ? RAZORPAY_MOCK_KEY_SECRET : null);
    if (!keySecret) {
      res.status(503).json({ error: "Payment verification not configured" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const orderId = typeof body["orderId"] === "string" ? body["orderId"] : "";
    const paymentId = typeof body["paymentId"] === "string" ? body["paymentId"] : "";
    const signature = typeof body["signature"] === "string" ? body["signature"] : "";
    if (!orderId || !paymentId || !signature) {
      res.status(400).json({ error: "Missing payment verification parameters" });
      return;
    }

    const verification = verifyRazorpayCheckoutSignature({
      orderId,
      paymentId,
      signature,
      keySecret,
    });
    if (!verification.ok) {
      res.status(400).json({ error: "Invalid payment signature", reason: verification.reason });
      return;
    }

    const [purchase] = await db
      .select()
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.orderId, orderId))
      .limit(1);
    if (!purchase || purchase.userId !== req.userId || purchaseGateway(purchase) !== "razorpay") {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const settled = await settleRazorpayPurchase({
      orderId,
      paymentId,
      eventId: null,
    });
    if (settled.outcome === "not_found") {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ success: true, outcome: settled.outcome });
  } catch (err) {
    logger.error({ err }, "[razorpay] checkout verify error");
    res.status(500).json({ error: "Failed to verify purchase" });
  }
});

/** Authenticated entitlement snapshot (gateway-neutral, incl. paused mandates). */
router.get("/entitlement", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(billingSubscriptionsTable)
      .where(eq(billingSubscriptionsTable.userId, req.userId!))
      .orderBy(desc(billingSubscriptionsTable.updatedAt))
      .limit(10);
    res.json({
      data: rows.map((row) => {
        const plan = resolveBillingPlan(row.planCode);
        return {
          id: row.id,
          gateway: row.gateway,
          planCode: row.planCode,
          status: row.status,
          entitlementState: row.entitlementState,
          // Paused/halted keeps the row + history: entitlement is suspended,
          // not deleted. Features are withheld by the client from entitlementState.
          features: row.entitlementState === "active" ? (plan?.features ?? []) : [],
          interval: row.interval,
          mandateMethod: row.mandateMethod,
          currentPeriodEnd: row.currentPeriodEnd,
          nextChargeAt: row.nextChargeAt,
          preDebitNotifyAt: row.preDebitNotifyAt,
          preDebitWindowHours: row.preDebitWindowHours,
          haltedAt: row.haltedAt,
          resumedAt: row.resumedAt,
          cancelledAt: row.cancelledAt,
          completedAt: row.completedAt,
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[razorpay] entitlement error");
    res.status(500).json({ error: "Failed to load entitlement" });
  }
});

/**
 * POST /api/razorpay/subscription/cancel
 * Routes management/cancel to the ISSUING gateway stored on the subscription.
 */
router.post("/subscription/cancel", requireAuth, async (req, res) => {
  try {
    const config = readRazorpayConfig();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const subscriptionId =
      typeof body["subscriptionId"] === "string" ? body["subscriptionId"] : "";

    const rows = await db
      .select()
      .from(billingSubscriptionsTable)
      .where(
        subscriptionId
          ? and(
              eq(billingSubscriptionsTable.userId, req.userId!),
              eq(billingSubscriptionsTable.id, subscriptionId),
            )
          : eq(billingSubscriptionsTable.userId, req.userId!),
      )
      .orderBy(desc(billingSubscriptionsTable.updatedAt))
      .limit(1);
    const subscription = rows[0];
    if (!subscription) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    if (subscription.gateway === "stripe") {
      // Do not simulate cross-gateway cancellation: Stripe subscriptions are
      // managed through Stripe's billing portal so proration/tax stay correct.
      res.status(409).json({
        error: "Managed by Stripe",
        code: "GATEWAY_MANAGED_ELSEWHERE",
        gateway: "stripe",
        planCode: subscription.planCode,
      });
      return;
    }
    if (config.mode === "unconfigured") {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }

    const cancelAtCycleEnd = body["cancelAtCycleEnd"] !== false;
    const provider = await cancelRazorpaySubscription({
      subscriptionId: subscription.providerSubscriptionId,
      cancelAtCycleEnd,
    });
    await db
      .update(billingSubscriptionsTable)
      .set({
        status: provider.status === "cancelled" ? "cancelled" : subscription.status,
        entitlementState:
          provider.status === "cancelled" ? "cancelled" : subscription.entitlementState,
        cancelledAt: provider.status === "cancelled" ? new Date() : subscription.cancelledAt,
        updatedAt: new Date(),
      })
      .where(eq(billingSubscriptionsTable.id, subscription.id));

    res.json({
      success: true,
      data: {
        gateway: "razorpay",
        planCode: subscription.planCode,
        cancelAtCycleEnd,
        providerStatus: provider.status,
      },
    });
  } catch (err) {
    if (err instanceof RazorpayNotConfiguredError) {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    logger.error({ err }, "[razorpay] subscription cancel error");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

/**
 * POST /api/razorpay/refund
 * Refunds are created through the Razorpay Refunds API (never by editing
 * balances). The compensating ledger entry is appended by refund.processed
 * (webhook) or immediately here when the provider already reports "processed".
 * Protected by an internal token: refunds are an ops action, not a user action.
 */
router.post("/refund", async (req, res) => {
  try {
    const internalToken = process.env["RAZORPAY_INTERNAL_TOKEN"]?.trim();
    if (!internalToken) {
      res.status(503).json({ error: "Refund endpoint not configured" });
      return;
    }
    if (req.headers["x-internal-token"] !== internalToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const config = readRazorpayConfig();
    if (config.mode === "unconfigured") {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const orderId = typeof body["orderId"] === "string" ? body["orderId"] : "";
    const paymentIdInput = typeof body["paymentId"] === "string" ? body["paymentId"] : "";
    const amountMinor =
      typeof body["amountMinor"] === "number" && Number.isInteger(body["amountMinor"])
        ? body["amountMinor"]
        : undefined;

    const [purchase] = await db
      .select()
      .from(creditsPurchasesTable)
      .where(
        orderId
          ? eq(creditsPurchasesTable.orderId, orderId)
          : paymentIdInput
            ? eq(creditsPurchasesTable.paymentId, paymentIdInput)
            : eq(creditsPurchasesTable.id, ""),
      )
      .limit(1);
    if (!purchase || purchaseGateway(purchase) !== "razorpay") {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    const paymentId = paymentIdInput || purchase.paymentId;
    if (!paymentId) {
      res.status(409).json({ error: "Payment has not been captured" });
      return;
    }

    const refund = await createRazorpayRefund({
      paymentId,
      ...(amountMinor === undefined ? {} : { amountMinor }),
      notes: { reason: typeof body["reason"] === "string" ? body["reason"] : "ops_refund" },
    });

    let reversal: Awaited<ReturnType<typeof reverseRazorpayPurchase>> | null = null;
    if (refund.status === "processed") {
      reversal = await reverseRazorpayPurchase({
        paymentId,
        refundId: refund.id,
        // A zero/absent amount means the provider refunded the full charge.
        refundAmountMinor:
          typeof refund.amount === "number" && refund.amount > 0 ? refund.amount : undefined,
      });
    }

    res.json({
      success: true,
      data: {
        refundId: refund.id,
        paymentId,
        amountMinor: refund.amount,
        status: refund.status,
        compensation: reversal?.outcome ?? "pending_webhook",
        creditsReversed:
          reversal && reversal.outcome === "reversed" ? reversal.creditsReversed : 0,
      },
    });
  } catch (err) {
    if (err instanceof RazorpayNotConfiguredError) {
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    if (err instanceof RazorpayValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error({ err }, "[razorpay] refund error");
    res.status(500).json({ error: "Failed to create refund" });
  }
});

/**
 * POST /api/razorpay/webhook
 * Distinct verification #2: HMAC-SHA256(webhook_secret, RAW body) from the
 * X-Razorpay-Signature header. Idempotency uses X-Razorpay-Event-Id. The raw
 * body is preserved by the express.raw() mount in app.ts before express.json().
 */
router.post("/webhook", async (req, res) => {
  try {
    const config = readRazorpayConfig();
    if (config.mode === "unconfigured") {
      logger.error("[razorpay] webhook received but Razorpay is not configured");
      res.status(503).json({ error: "Razorpay is not configured" });
      return;
    }
    if (!config.webhookSecret) {
      logger.error("[razorpay] webhook received but no webhook secret is configured");
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    const rawBody: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!rawBody) {
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    const signatureHeader = req.headers["x-razorpay-signature"];
    const verification = verifyRazorpayWebhookSignature({
      rawBody,
      signatureHeader: typeof signatureHeader === "string" ? signatureHeader : undefined,
      webhookSecret: config.webhookSecret,
    });
    if (!verification.ok) {
      logger.warn({ reason: verification.reason }, "[razorpay] webhook signature rejected");
      res.status(400).json({ error: "Invalid webhook signature", reason: verification.reason });
      return;
    }

    const eventIdHeader = req.headers["x-razorpay-event-id"];
    const eventId = typeof eventIdHeader === "string" ? eventIdHeader.trim() : "";
    if (!eventId) {
      res.status(400).json({ error: "Missing X-Razorpay-Event-Id" });
      return;
    }

    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      event = parsed as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: "Invalid webhook JSON" });
      return;
    }

    const result = await processRazorpayWebhookEvent(event, eventId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[razorpay] webhook processing failed");
    // 500 -> Razorpay retries, which is what we want for transient DB failures.
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
