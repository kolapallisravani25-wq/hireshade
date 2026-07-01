import { Router, type IRouter } from "express";
import crypto from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db } from "@workspace/db";
import {
  creditsBalanceTable,
  creditsUsageTable,
  creditsPurchasesTable,
} from "@workspace/db/schema";
import { eq, and, desc, ilike } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const router: IRouter = Router();

const FEATURE_COSTS: Record<string, number> = {
  ai_answer: 2,
  ai_answer_cached: 0,
  analyze_screen: 3,
  resume_ats: 5,
  resume_cover_letter: 8,
  resume_generate: 10,
  resume_enhance_section: 3,
  project_generate: 10,
  session_minute: 1,
};

const CREDIT_BRACKETS = [
  { min: 0, max: 50, label: "Starter" },
  { min: 51, max: 200, label: "Basic" },
  { min: 201, max: 500, label: "Pro" },
  { min: 501, max: Infinity, label: "Enterprise" },
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

router.get("/plans", requireAuth, async (req, res) => {
  const currency = (req.query["currency"] as string) ?? "INR";
  const plans = [
    {
      id: "plan_100",
      name: "Starter Pack",
      credits: 100,
      price: currency === "USD" ? 4.99 : 399,
      currency,
      popular: false,
    },
    {
      id: "plan_500",
      name: "Pro Pack",
      credits: 500,
      price: currency === "USD" ? 19.99 : 1599,
      currency,
      popular: true,
    },
    {
      id: "plan_1000",
      name: "Power Pack",
      credits: 1000,
      price: currency === "USD" ? 34.99 : 2799,
      currency,
      popular: false,
    },
    {
      id: "plan_5000",
      name: "Enterprise Pack",
      credits: 5000,
      price: currency === "USD" ? 149.99 : 11999,
      currency,
      popular: false,
    },
  ];
  res.json({ data: plans });
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
  res.json({ data: FEATURE_COSTS });
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
    const body = req.body as { planId?: string; currency?: string };

    const planId = body.planId ?? "plan_100";
    const currency = body.currency ?? "INR";

    const planAmounts: Record<string, { amount: number; credits: number }> = {
      plan_100: { amount: currency === "USD" ? 499 : 39900, credits: 100 },
      plan_500: { amount: currency === "USD" ? 1999 : 159900, credits: 500 },
      plan_1000: { amount: currency === "USD" ? 3499 : 279900, credits: 1000 },
      plan_5000: { amount: currency === "USD" ? 14999 : 1199900, credits: 5000 },
    };

    const plan = planAmounts[planId] ?? planAmounts["plan_100"]!;
    const orderId = `order_${uuidv4().replace(/-/g, "").slice(0, 16)}`;

    const purchaseId = uuidv4();
    await db.insert(creditsPurchasesTable).values({
      id: purchaseId,
      userId,
      orderId,
      amount: String(plan.amount / 100),
      currency,
      creditsPurchased: String(plan.credits),
      status: "pending",
    });

    res.json({
      success: true,
      data: {
        orderId,
        amount: plan.amount,
        currency,
        credits: plan.credits,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create order" });
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

    if (expectedSig !== signature) {
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

    await db
      .update(creditsPurchasesTable)
      .set({
        status: "completed",
        paymentId: paymentId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(creditsPurchasesTable.id, purchase.id));

    const [balance] = await db
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, userId))
      .limit(1);

    if (balance) {
      const newPurchased =
        parseFloat(balance.purchasedCredits) +
        parseFloat(purchase.creditsPurchased ?? "0");
      await db
        .update(creditsBalanceTable)
        .set({
          purchasedCredits: String(newPurchased),
          updatedAt: new Date(),
        })
        .where(eq(creditsBalanceTable.userId, userId));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify purchase" });
  }
});

export default router;
