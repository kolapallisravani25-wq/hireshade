// Integration tests against real Postgres for Loop 1 fixes.
// Run with: DATABASE_URL=... node --import tsx it-loop1.mts
import { db, pool } from "@workspace/db";
import {
  usersTable,
  sessionsTable,
  creditsBalanceTable,
  creditsPurchasesTable,
  creditsUsageTable,
} from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { applyPurchaseCreditByOrderId } from "../artifacts/api-server/src/lib/purchaseCredit.ts";

let pass = 0, fail = 0;

// Clean slate — runs must be idempotent.
await db.execute(sql`TRUNCATE credits_usage, credits_purchases, credits_balance, sessions, users CASCADE`);
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`, detail ?? ""); }
}

async function mkUser(): Promise<string> {
  const id = uuidv4();
  await db.insert(usersTable).values({
    id, clerkUserId: `clerk_${id}`, email: `${id}@t.local`,
  });
  await db.insert(creditsBalanceTable).values({
    id: uuidv4(), userId: id, purchasedCredits: "0", earnedCredits: "100", heldCredits: "0",
  });
  return id;
}

async function balanceOf(userId: string) {
  const [b] = await db.select().from(creditsBalanceTable).where(eq(creditsBalanceTable.userId, userId));
  return { purchased: parseFloat(b!.purchasedCredits), earned: parseFloat(b!.earnedCredits) };
}

// ─── Test 1: exactly-once crediting under concurrent verify+webhook ───
console.log("T1: concurrent settle (verify race webhook) credits exactly once");
{
  const userId = await mkUser();
  await db.insert(creditsPurchasesTable).values({
    id: uuidv4(), userId, orderId: "order_race", amount: "399",
    currency: "INR", creditsPurchased: "100", status: "pending",
  });
  const results = await Promise.all([
    applyPurchaseCreditByOrderId({ orderId: "order_race", paymentId: "pay_1", expectedUserId: userId }),
    applyPurchaseCreditByOrderId({ orderId: "order_race", paymentId: "pay_1", claimableFrom: ["pending", "failed"] }),
    applyPurchaseCreditByOrderId({ orderId: "order_race", paymentId: "pay_1", expectedUserId: userId }),
  ]);
  const credited = results.filter(r => r.outcome === "credited").length;
  const replays = results.filter(r => r.outcome === "already_completed").length;
  check("exactly one credited", credited === 1, results);
  check("others are replays", replays === 2, results);
  const bal = await balanceOf(userId);
  check("balance +100 exactly once", bal.purchased === 100, bal);
}

// ─── Test 2: webhook overrides client-reported failure ───
console.log("T2: captured webhook credits a purchase the client marked failed");
{
  const userId = await mkUser();
  await db.insert(creditsPurchasesTable).values({
    id: uuidv4(), userId, orderId: "order_failed", amount: "399",
    currency: "INR", creditsPurchased: "50", status: "failed",
  });
  const verifyResult = await applyPurchaseCreditByOrderId({
    orderId: "order_failed", expectedUserId: userId, // pending-only claim
  });
  check("verify (pending-only) does NOT credit failed row", verifyResult.outcome === "already_completed", verifyResult);
  const webhookResult = await applyPurchaseCreditByOrderId({
    orderId: "order_failed", paymentId: "pay_2", claimableFrom: ["pending", "failed"],
  });
  check("webhook credits it", webhookResult.outcome === "credited", webhookResult);
  const bal = await balanceOf(userId);
  check("balance +50", bal.purchased === 50, bal);
  const again = await applyPurchaseCreditByOrderId({
    orderId: "order_failed", claimableFrom: ["pending", "failed"],
  });
  check("webhook replay is a no-op", again.outcome === "already_completed", again);
}

// ─── Test 3: order binding — verify with wrong user finds nothing ───
console.log("T3: verify path cannot claim another user's order");
{
  const owner = await mkUser();
  const attacker = await mkUser();
  await db.insert(creditsPurchasesTable).values({
    id: uuidv4(), userId: owner, orderId: "order_bind", amount: "399",
    currency: "INR", creditsPurchased: "100", status: "pending",
  });
  const r = await applyPurchaseCreditByOrderId({ orderId: "order_bind", expectedUserId: attacker });
  check("attacker gets not_found", r.outcome === "not_found", r);
  const bal = await balanceOf(attacker);
  check("attacker balance unchanged", bal.purchased === 0, bal);
}

// ─── Test 4: atomic activation — the exact SQL used in the route ───
console.log("T4: concurrent activation of two sessions -> only one goes ACTIVE");
{
  const userId = await mkUser();
  const mk = async () => {
    const id = uuidv4();
    await db.insert(sessionsTable).values({
      id, userId, companyName: "T", status: "PRE_CHECK", free: false,
    });
    return id;
  };
  const s1 = await mk(); const s2 = await mk();
  const activate = async (sessionId: string): Promise<number> => {
    try {
      const rows = await db
        .update(sessionsTable)
        .set({ status: "ACTIVE", startedAt: new Date(), updatedAt: new Date() })
        .where(
          sql`${sessionsTable.id} = ${sessionId}
            AND ${sessionsTable.userId} = ${userId}
            AND NOT EXISTS (
              SELECT 1 FROM ${sessionsTable} AS blocking
              WHERE blocking.user_id = ${userId}
                AND blocking.status IN ('ACTIVE', 'COMPLETING')
                AND blocking.id <> ${sessionId}
            )`,
        )
        .returning({ id: sessionsTable.id });
      return rows.length; // 1 = won, 0 = blocked by pre-filter
    } catch (err) {
      const code =
        (err as { code?: string })?.code ??
        ((err as { cause?: { code?: string } })?.cause?.code);
      if (code === "23505") return 0; // lost race at index
      throw err;
    }
  };

  // Fire many racing pairs to shake out the race.
  let bothWonEver = false;
  for (let i = 0; i < 20; i++) {
    await db.update(sessionsTable).set({ status: "PRE_CHECK", startedAt: null })
      .where(inArray(sessionsTable.id, [s1, s2]));
    const [r1, r2] = await Promise.all([activate(s1), activate(s2)]);
    if (r1 === 1 && r2 === 1) bothWonEver = true;
  }
  check("no iteration let both sessions go ACTIVE", !bothWonEver);

  // Re-activating the SAME already-active session stays allowed (rejoin).
  await db.update(sessionsTable).set({ status: "PRE_CHECK", startedAt: null })
    .where(inArray(sessionsTable.id, [s1, s2]));
  const first = await activate(s1);
  const rejoin = await activate(s1);
  check("first activation wins", first === 1);
  check("rejoin of same session allowed", rejoin === 1);
  const blockedOther = await activate(s2);
  check("other session blocked while s1 ACTIVE", blockedOther === 0);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
