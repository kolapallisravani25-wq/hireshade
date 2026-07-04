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
        earnedCredits: "100",
        heldCredits: "0",
        totalAvailable: "100",
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
 * Shape matches the client's CreditPlan (useCreditPlans.ts): code,
 * amountMajor/amountMinor, isPopular, valuePct. The previous handler returned
 * { id, price, popular } — none of which the client reads — so the billing
 * page rendered undefined prices and sent packCode: undefined.
 */
const CREDIT_PACKS: {
  code: string;
  name: string;
  credits: number;
  amountMinor: Record<string, number>; // currency → minor units
  isPopular: boolean;
}[] = [
  { code: "plan_100", name: "Starter Pack", credits: 100, amountMinor: { INR: 39900, USD: 499 }, isPopular: false },
  { code: "plan_500", name: "Pro Pack", credits: 500, amountMinor: { INR: 159900, USD: 1999 }, isPopular: true },
  { code: "plan_1000", name: "Power Pack", credits: 1000, amountMinor: { INR: 279900, USD: 3499 }, isPopular: false },
  { code: "plan_5000", name: "Enterprise Pack", credits: 5000, amountMinor: { INR: 1199900, USD: 14999 }, isPopular: false },
];

function packsForCurrency(currency: string) {
  const cur = currency === "USD" ? "USD" : "INR";
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
    const currency = body.currency === "USD" ? "USD" : "INR";
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

    const [purchase] = await db
      .select()
      .from(creditsPurchasesTable)
      .where(
        and(
          eq(creditsPurchasesTable.userId, userId),
          eq(creditsPurchasesTable.orderId, orderId),
        ),
      )
      .limit(1);

    if (!purchase) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // IDEMPOTENCY: a valid signature can be replayed. Without this guard,
    // re-posting the same verification credited the balance AGAIN on every
    // call — an unlimited free-credits exploit. Claim the purchase row
    // transactionally; only the claimer credits the balance.
    const credited = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(creditsPurchasesTable)
        .set({
          status: "completed",
          paymentId: paymentId ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(creditsPurchasesTable.id, purchase.id),
            eq(creditsPurchasesTable.status, "pending"),
          ),
        )
        .returning({ id: creditsPurchasesTable.id });

      if (claimed.length === 0) return false; // already completed — no re-credit

      const creditsToAdd = parseFloat(purchase.creditsPurchased ?? "0") || 0;

      const [balance] = await tx
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, userId))
        .for("update")
        .limit(1);

      if (balance) {
        const newPurchased =
          (parseFloat(balance.purchasedCredits) || 0) + creditsToAdd;
        await tx
          .update(creditsBalanceTable)
          .set({
            purchasedCredits: String(newPurchased),
            updatedAt: new Date(),
          })
          .where(eq(creditsBalanceTable.userId, userId));
      } else {
        // Previously a missing balance row meant the purchase was marked
        // completed but the credits were silently dropped. Seed the row.
        await tx.insert(creditsBalanceTable).values({
          id: uuidv4(),
          userId,
          purchasedCredits: String(creditsToAdd),
          earnedCredits: "100",
          heldCredits: "0",
          updatedAt: new Date(),
        });
      }
      return true;
    });

    if (!credited) {
      console.warn("[credits] purchase verify replay ignored", purchase.id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify purchase" });
  }
});

export default router;
