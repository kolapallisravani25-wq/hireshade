import { app } from '../../_server/app';
import { getKnex } from '../../_server/db';

type RecentPackRow = {
  id: string;
  code: string;
  name: string;
  credits: string;
  currency: string;
  amountMajor: string;
  active: boolean;
  isPopular: boolean;
};

type RecentPurchaseRow = {
  id: string;
  createdAt: string;
  confirmedAt: string | null;
  userId: string | null;
};

type RecentUsageRow = {
  id: string;
  createdAt: string;
  userId: string | null;
};

const controller = app.defineCustomController({
  getBillingSummary: async () => {
    const db = getKnex();

    const [packStats] = await db.raw(`
      SELECT
        COUNT(*)::int AS total_packs,
        COUNT(*) FILTER (WHERE active = true)::int AS active_packs,
        COALESCE(SUM(COALESCE(credits, 0)), 0)::numeric AS total_credits,
        COALESCE(SUM(CASE WHEN active = true THEN COALESCE(credits, 0) ELSE 0 END), 0)::numeric AS active_credits
      FROM credit_packs
    `);

    const [purchaseStats] = await db.raw(`
      SELECT
        COUNT(*)::int AS total_purchases,
        COUNT(*) FILTER (WHERE "confirmedAt" IS NOT NULL)::int AS confirmed_purchases,
        COUNT(*) FILTER (WHERE "confirmedAt" IS NULL)::int AS pending_purchases,
        MAX("createdAt") AS latest_purchase_at,
        MAX("confirmedAt") AS latest_confirmed_at
      FROM "CreditPurchase"
    `);

    const [usageStats] = await db.raw(`
      SELECT
        COUNT(*)::int AS total_usage,
        MAX("createdAt") AS latest_usage_at
      FROM "CreditUsage"
    `);

    const recentPacks = await db.raw<RecentPackRow[]>(`
      SELECT id, code, name, credits, currency, "amountMajor", active, "isPopular"
      FROM credit_packs
      ORDER BY "sortOrder" ASC
      LIMIT 5
    `);

    const recentPurchases = await db.raw<RecentPurchaseRow[]>(`
      SELECT id, "createdAt", "confirmedAt", "userId"
      FROM "CreditPurchase"
      ORDER BY "createdAt" DESC
      LIMIT 5
    `);

    const recentUsage = await db.raw<RecentUsageRow[]>(`
      SELECT id, "createdAt", "userId"
      FROM "CreditUsage"
      ORDER BY "createdAt" DESC
      LIMIT 5
    `);

    return {
      packs: {
        totalPacks: Number(packStats?.total_packs ?? 0),
        activePacks: Number(packStats?.active_packs ?? 0),
        totalCredits: String(packStats?.total_credits ?? '0'),
        activeCredits: String(packStats?.active_credits ?? '0'),
      },
      purchases: {
        totalPurchases: Number(purchaseStats?.total_purchases ?? 0),
        confirmedPurchases: Number(purchaseStats?.confirmed_purchases ?? 0),
        pendingPurchases: Number(purchaseStats?.pending_purchases ?? 0),
        latestPurchaseAt: purchaseStats?.latest_purchase_at ?? null,
        latestConfirmedAt: purchaseStats?.latest_confirmed_at ?? null,
      },
      usage: {
        totalUsage: Number(usageStats?.total_usage ?? 0),
        latestUsageAt: usageStats?.latest_usage_at ?? null,
      },
      recentPacks: recentPacks ?? [],
      recentPurchases: recentPurchases ?? [],
      recentUsage: recentUsage ?? [],
    };
  },
});

export default controller;
export type Procedures = typeof controller.procedures;