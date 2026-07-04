import { Router, type IRouter } from "express";
import crypto from "crypto";
import { createRazorpayOrder, getRazorpayKeyId, RazorpayNotConfiguredError } from "../lib/razorpay.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import {
  creditsBalanceTable,
  creditsUsageTable,
  creditsPurchasesTable,
} from "@workspace/db/schema";
import { eq, and, desc, ilike } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  CREDITS_PER_MINUTE,
  GRACE_ZONE_MINUTES,
} from "../lib/sessionCredits.js";
import { allFeatureCosts } from "../lib/featureCredits.js";
import { applyPurchaseCreditByOrderId } from "../lib/purchaseCredit.js";
import { SIGNUP_CREDITS } from "../lib/signupGrant.js";

const router: IRouter = Router();

// The client reads brackets[0].graceZoneMinutes and .creditsPerMinute for the
// live-session billing UX — these MUST be present or the client silently falls
// back to hardcoded defaults that can drift from server-side settlement.
const CREDIT_BRACKETS = [
  {
    min: 0,
    max: 50,
    label: "Starter",
    graceZoneMinutes: GRACE_ZONE_MINUTES,
    creditsPerMinute: String(CREDITS_PER_MINUTE),
  },
  { min: 51, max: 200, label: "Basic", graceZoneMinutes: GRACE_ZONE_MINUTES, creditsPerMinute: String(CREDITS_PER_MINUTE) },
  { min: 201, max: 500, label: "Pro", graceZoneMinutes: GRACE_ZONE_MINUTES, creditsPerMinute: String(CREDITS_PER_MINUTE) },
  { min: 501, max: Infinity, label: "Enterprise", graceZoneMinutes: GRACE_ZONE_MINUTES, creditsPerMinute: String(CREDITS_PER_MINUTE) },
];

router.get("/balance", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;

    const [balance] = await db
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, userId))
      .limit(1);

    if (!balance) {
      res.json({
        purchasedCredits: "0",
        earnedCredits: String(SIGNUP_CREDITS),
        heldCredits: "0",
        totalAvailable: String(SIGNUP_CREDITS),
      });
      return;
    }

    const total =
      parseFloat(balance.purchasedCredits) +
      parseFloat(balance.earnedCredits) -
      parseFloat(balance.heldCredits);

    res.json({
      purchasedCredits: balance.purchasedCredits,
      earnedCredits: balance.earnedCredits,
      heldCredits: balance.heldCredits,
      totalAvailable: String(Math.max(0, total)),
      data: {
        purchasedCredits: balance.purchasedCredits,
        earnedCredits: balance.earnedCredits,
        heldCredits: balance.heldCredits,
        totalAvailable: String(Math.max(0, total)),
      },
    });
  } catch (err) {
    console.error("[credits] balance error", err);
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

router.get("/brackets", requireAuth, async (_req, res) => {
  res.json({ data: CREDIT_BRACKETS });
});

/**
 * Canonical credit packs — single server-side source of truth for both the
 * /plans listing and order creation (amounts can never be client-supplied).
 * Values are verbatim from the ScribeShade Pricing & Credits document
 * (Apr 25, 2026): 7 one-time packs, INR / USD / GBP, Standard marked
 * popular, Mega best-value (client derives the badge from valuePct).
 * Shape matches the client's CreditPlan (useCreditPlans.ts): code,
 * amountMajor/amountMinor, isPopular, valuePct.
 */
const CREDIT_PACKS: {
  code: string;
  name: string;
  credits: number;
  amountMinor: Record<string, number>; // currency → minor units
  isPopular: boolean;
}[] = [
  { code: "quick_5", name: "Quick 5", credits: 5, amountMinor: { INR: 9900, USD: 299, GBP: 249 }, isPopular: false },
  { code: "starter_10", name: "Starter", credits: 10, amountMinor: { INR: 14900, USD: 399, GBP: 349 }, isPopular: false },
  { code: "basic_25", name: "Basic", credits: 25, amountMinor: { INR: 34900, USD: 999, GBP: 899 }, isPopular: false },
  { code: "standard_60", name: "Standard", credits: 60, amountMinor: { INR: 69900, USD: 1999, GBP: 1799 }, isPopular: true },
  { code: "professional_120", name: "Professional", credits: 120, amountMinor: { INR: 129900, USD: 3999, GBP: 3499 }, isPopular: false },
  { code: "power_300", name: "Power", credits: 300, amountMinor: { INR: 299900, USD: 8999, GBP: 7999 }, isPopular: false },
  { code: "mega_600", name: "Mega", credits: 600, amountMinor: { INR: 499900, USD: 14999, GBP: 12999 }, isPopular: false },
];

function packsForCurrency(currency: string) {
  // The client auto-detects and sends INR / USD / GBP (userCurrency.ts).
  // Previously GBP was silently coerced to INR — UK users saw rupee prices.
  const cur = currency === "USD" || currency === "GBP" ? currency : "INR";
  const withValue = CREDIT_PACKS.map((p) => {
    const minor = p.amountMinor[cur]!;
    return { ...p, minor, creditsPerMinor: p.credits / minor };
  });
  const base = withValue[0]!.creditsPerMinor;
  return withValue.map((p) => ({
    code: p.code,
    name: p.name,
    credits: p.credits,
    currency: cur,
    amountMinor: p.minor,
    amountMajor: (p.minor / 100).toFixed(2),
    isPopular: p.isPopular,
    // % more credits-per-money than the smallest pack.
    valuePct: Math.round((p.creditsPerMinor / base - 1) * 100),
  }));
}

router.get("/plans", requireAuth, async (req, res) => {
  const currency = (req.query["currency"] as string) ?? "INR";
  res.json({ data: packsForCurrency(currency) });
});

router.get("/ledger", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const page = parseInt((req.query["page"] as string) ?? "1", 10);
    const limit = parseInt((req.query["limit"] as string) ?? "20", 10);

    const entries = await db
      .select()
      .from(creditsUsageTable)
      .where(eq(creditsUsageTable.userId, userId))
      .orderBy(desc(creditsUsageTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: entries,
      pagination: { page, limit },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

router.get("/usage", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const page = parseInt((req.query["page"] as string) ?? "1", 10);
    const limit = parseInt((req.query["limit"] as string) ?? "20", 10);
    const operation = req.query["operation"] as string | undefined;

    const conditions = [eq(creditsUsageTable.userId, userId)];
    if (operation) {
      conditions.push(eq(creditsUsageTable.operation, operation));
    }

    const entries = await db
      .select()
      .from(creditsUsageTable)
      .where(and(...conditions))
      .orderBy(desc(creditsUsageTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: entries,
      pagination: { page, limit, total: entries.length, pages: 1 },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

router.get("/feature-costs", requireAuth, async (_req, res) => {
  // Live costs from the charging engine (single source of truth). In-session
  // AI (ai_answer / analyze_screen) is billed via the per-minute session meter,
  // so it is advertised as 0 here to avoid implying a separate per-action charge.
  res.json({
    data: {
      ...allFeatureCosts(),
      ai_answer: 0,
      analyze_screen: 0,
      session_minute: CREDITS_PER_MINUTE,
    },
  });
});

router.get("/purchases", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const page = parseInt((req.query["page"] as string) ?? "1", 10);
    const limit = parseInt((req.query["limit"] as string) ?? "20", 10);

    const purchases = await db
      .select()
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.userId, userId))
      .orderBy(desc(creditsPurchasesTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({
      success: true,
      data: purchases,
      pagination: { page, limit },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

router.post("/purchase/order", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as { packCode?: string; planId?: string; currency?: string };

    // FE sends packCode; planId kept for backward compatibility.
    const code = body.packCode ?? body.planId ?? "";
    const currency =
      body.currency === "USD" || body.currency === "GBP" ? body.currency : "INR";
    const pack = packsForCurrency(currency).find((p) => p.code === code);
    if (!pack) {
      // Exact string is a client contract (BuyCreditsDialog maps it to copy).
      res.status(400).json({ error: "Invalid packCode" });
      return;
    }

    // REAL Razorpay order — checkout rejects ids it didn't issue, which is why
    // the previous locally-fabricated order_<uuid> made purchases impossible.
    let rzpOrder;
    try {
      rzpOrder = await createRazorpayOrder({
        amountMinor: pack.amountMinor,
        currency,
        receipt: `hs_${userId.slice(0, 20)}_${Date.now()}`,
        notes: { userId, packCode: pack.code },
      });
    } catch (err) {
      if (err instanceof RazorpayNotConfiguredError) {
        // Exact string is a client contract.
        res.status(503).json({ error: "Razorpay is not configured" });
        return;
      }
      throw err;
    }

    await db.insert(creditsPurchasesTable).values({
      id: uuidv4(),
      userId,
      orderId: rzpOrder.id,
      amount: String(pack.amountMinor / 100),
      currency,
      creditsPurchased: String(pack.credits),
      status: "pending",
    });

    res.json({
      success: true,
      data: {
        orderId: rzpOrder.id,
        keyId: getRazorpayKeyId(),
        amountMinor: pack.amountMinor,
        currency,
        credits: pack.credits,
      },
    });
  } catch (err) {
    console.error("[credits] purchase order error", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

/**
 * FE calls this on checkout failure/dismiss to mark the pending purchase —
 * the endpoint previously did not exist (silent 404 on every failed payment,
 * leaving pending rows forever).
 */
router.post("/purchase/fail", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as { orderId?: string; reason?: string };
    if (!body.orderId) {
      res.status(400).json({ error: "orderId is required" });
      return;
    }
    await db
      .update(creditsPurchasesTable)
      .set({ status: "failed" })
      .where(
        and(
          eq(creditsPurchasesTable.userId, userId),
          eq(creditsPurchasesTable.orderId, body.orderId),
          eq(creditsPurchasesTable.status, "pending"),
        ),
      );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to record failure" });
  }
});

router.post("/purchase/verify", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const body = req.body as {
      orderId?: string;
      paymentId?: string;
      signature?: string;
    };

    const { orderId, paymentId, signature } = body;
    const keySecret = process.env["RAZORPAY_KEY_SECRET"];

    if (!keySecret) {
      res.status(503).json({ error: "Payment verification not configured" });
      return;
    }

    if (!orderId || !paymentId || !signature) {
      res.status(400).json({ error: "Missing payment verification parameters" });
      return;
    }

    const expectedSig = crypto
      .createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(expBuf, sigBuf)) {
      res.status(400).json({ error: "Invalid payment signature" });
      return;
    }

    // IDEMPOTENCY: a valid signature can be replayed. The shared settlement
    // helper claims the purchase row pending→completed transactionally; only
    // the claimer credits the balance. The Razorpay webhook uses the SAME
    // helper, so whichever settlement path lands first wins and the other is
    // a harmless no-op.
    const result = await applyPurchaseCreditByOrderId({
      orderId,
      paymentId,
      expectedUserId: userId,
    });

    if (result.outcome === "not_found") {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[credits] purchase verify error", err);
    res.status(500).json({ error: "Failed to verify purchase" });
  }
});

/**
 * Razorpay server-to-server webhook — closes the paid-but-uncredited dead
 * zone: if the buyer's browser dies between Razorpay checkout success and the
 * client's /purchase/verify call (tab closed, crash, network drop), the
 * payment was captured but no credits were ever granted and the purchase row
 * stayed "pending" forever. Razorpay retries this webhook until it gets a 2xx,
 * so settlement now has a client-independent path.
 *
 * Security:
 *  - NOT behind requireAuth (Razorpay is the caller).
 *  - Authenticated by the `x-razorpay-signature` header: HMAC-SHA256 of the
 *    RAW request body with RAZORPAY_WEBHOOK_SECRET (a dedicated secret,
 *    configured on the Razorpay dashboard — NOT the key secret).
 *  - Fail-closed: unset secret → 503; bad signature → 400. Credits are only
 *    ever granted after signature verification, and grant amounts come from
 *    our own purchase row (server-priced), never from the webhook payload.
 *
 * The raw body is preserved by the express.raw() mount for this exact path in
 * app.ts (JSON parsing would destroy byte-exact signature verification).
 */
router.post("/webhook/razorpay", async (req, res) => {
  try {
    const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"];
    if (!webhookSecret) {
      console.error("[credits] webhook received but RAZORPAY_WEBHOOK_SECRET is unset");
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    const signature = req.headers["x-razorpay-signature"];
    const rawBody: Buffer | undefined = Buffer.isBuffer(req.body)
      ? req.body
      : undefined;

    if (typeof signature !== "string" || !rawBody) {
      res.status(400).json({ error: "Missing signature or body" });
      return;
    }

    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(expBuf, sigBuf)) {
      console.warn("[credits] webhook signature mismatch");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    let event: {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string } };
        order?: { entity?: { id?: string } };
      };
    };
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    // Only capture events grant credits. Everything else (authorized, failed,
    // refunds…) is acknowledged so Razorpay stops retrying.
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const orderId =
        event.payload?.payment?.entity?.order_id ??
        event.payload?.order?.entity?.id;
      const paymentId = event.payload?.payment?.entity?.id ?? null;

      if (orderId) {
        const result = await applyPurchaseCreditByOrderId({
          orderId,
          paymentId,
          claimableFrom: ["pending", "failed"],
        });
        if (result.outcome === "not_found") {
          // Unknown order (e.g. another environment sharing the Razorpay
          // account). Ack with 200 — retrying will never make it known.
          console.warn("[credits] webhook for unknown order", orderId);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[credits] webhook error", err);
    // 500 → Razorpay retries, which is what we want for transient DB failures.
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
