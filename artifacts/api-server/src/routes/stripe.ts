/**
 * Stripe billing routes — checkout-session creation and the webhook endpoint.
 *
 * Mounted at /api/stripe (see routes/index.ts). Deliberately a separate module
 * from routes/credits.ts (Razorpay): the two providers share the credit ledger
 * but not their order/verification flows, so neither route file has to know
 * about the other provider's secrets or signature scheme.
 *
 * Security posture:
 *  - /checkout-session is authenticated; the product CODE (not an amount) comes
 *    from the client and the amount is resolved server-side from the T-12
 *    catalog in lib/stripe.ts. Client amount fields are ignored.
 *  - /webhook is NOT authenticated by bearer token (Stripe is the caller). It
 *    verifies Stripe-Signature over the RAW request bytes and fails closed with
 *    503 when unconfigured (STRIPE_WEBHOOK_SECRET missing or, in production,
 *    no STRIPE_SECRET_KEY). Credits only move after a valid signature and only
 *    from server-priced purchase rows.
 */

import { Router, type IRouter } from "express";
import { v4 as uuidv4 } from "uuid";
import { db } from "@workspace/db";
import { creditsPurchasesTable } from "@workspace/db/schema";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  createStripeCheckoutSession,
  parseStripeEvent,
  readStripeConfig,
  resolveStripeProduct,
  StripeAmountMismatchError,
  StripeApiError,
  StripeEventValidationError,
  StripeNotConfiguredError,
  verifyStripeSignature,
} from "../lib/stripe.js";
import { processStripeWebhookEvent } from "../lib/stripeWebhook.js";

const router: IRouter = Router();

/** Public-ish provider config for the billing UI (no secrets). */
router.get("/config", requireAuth, (_req, res) => {
  const config = readStripeConfig();
  res.json({
    data: {
      provider: "stripe",
      mode: config.mode,
      configured: config.mode !== "unconfigured",
      publishableKey: config.publishableKey,
      hasWebhookSecret: config.webhookSecret !== null,
      priceOverrides: Object.keys(config.priceIds),
    },
  });
});

/**
 * POST /api/stripe/checkout-session
 * Body: { productCode, currency? } (packCode/planId accepted as aliases).
 * Amounts are NEVER accepted from the client. Creates a Stripe Checkout
 * Session in payment or subscription mode, plus a local pending purchase row
 * keyed by the session id (orderId). Settlement happens only via the webhook.
 */
router.post("/checkout-session", requireAuth, async (req, res) => {
  try {
    const config = readStripeConfig();
    if (config.mode === "unconfigured") {
      // Fail closed in production / unconfigured environments.
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }

    const body = (req.body ?? {}) as {
      productCode?: unknown;
      packCode?: unknown;
      planId?: unknown;
      currency?: unknown;
    };
    const code =
      typeof body.productCode === "string"
        ? body.productCode
        : typeof body.packCode === "string"
          ? body.packCode
          : typeof body.planId === "string"
            ? body.planId
            : "";
    const resolved = resolveStripeProduct(code, body.currency);
    if (!resolved) {
      // Exact string is a client contract (BuyCreditsDialog maps it to copy),
      // shared with POST /api/credits/purchase/order.
      res.status(400).json({ error: "Invalid packCode" });
      return;
    }

    const userId = req.userId!;
    const idempotencyKey = "hs_" + userId.slice(0, 24) + "_" + uuidv4();

    const session = await createStripeCheckoutSession({
      userId,
      resolved,
      config,
      idempotencyKey,
    });

    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId,
      orderId: session.id,
      paymentId: session.paymentIntentId,
      amount: (session.amountMinor / 100).toFixed(2),
      currency: session.currency,
      creditsPurchased: String(session.credits),
      status: "pending",
      metadata: {
        provider: "stripe",
        productCode: session.productCode,
        productKind: session.productKind,
        checkoutUrl: session.url,
        mode: session.mode,
      },
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
        publishableKey: config.publishableKey,
        productCode: session.productCode,
        productKind: session.productKind,
        amountMinor: session.amountMinor,
        currency: session.currency,
        credits: session.credits,
        mode: session.mode,
      },
    });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }
    if (err instanceof StripeAmountMismatchError) {
      logger.error({ err }, "[stripe] checkout amount/currency mismatch");
      res.status(502).json({ error: "Stripe checkout amount validation failed" });
      return;
    }
    if (err instanceof StripeApiError) {
      logger.error({ err, status: err.status }, "[stripe] checkout session API error");
      res.status(502).json({ error: "Stripe checkout unavailable" });
      return;
    }
    logger.error({ err }, "[stripe] checkout session error");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/stripe/webhook
 *
 * The raw body is preserved by the express.raw() mount for this exact path in
 * app.ts (mounted BEFORE express.json), because parsing and re-serializing the
 * JSON would break byte-exact signature verification.
 */
router.post("/webhook", async (req, res) => {
  try {
    const config = readStripeConfig();
    if (config.mode === "unconfigured") {
      logger.error("[stripe] webhook received but Stripe is not configured");
      res.status(503).json({ error: "Stripe is not configured" });
      return;
    }
    if (!config.webhookSecret) {
      logger.error("[stripe] webhook received but STRIPE_WEBHOOK_SECRET is unset");
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    const rawBody: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : undefined;
    if (!rawBody) {
      res.status(400).json({ error: "Missing raw request body" });
      return;
    }

    const signatureHeader = req.headers["stripe-signature"];
    const verification = verifyStripeSignature({
      rawBody,
      signatureHeader: typeof signatureHeader === "string" ? signatureHeader : undefined,
      secret: config.webhookSecret,
    });
    if (!verification.ok) {
      logger.warn({ reason: verification.reason }, "[stripe] webhook signature rejected");
      res.status(400).json({ error: "Invalid Stripe signature", reason: verification.reason });
      return;
    }

    let event;
    try {
      event = parseStripeEvent(rawBody);
    } catch (err) {
      if (err instanceof StripeEventValidationError) {
        res.status(400).json({ error: "Invalid Stripe event payload" });
        return;
      }
      throw err;
    }

    const result = await processStripeWebhookEvent(event);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[stripe] webhook processing failed");
    // 500 -> Stripe retries, which is what we want for transient DB failures.
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
