import { db } from "@workspace/db";
import {
  creditsBalanceTable,
  creditsPurchasesTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { SIGNUP_CREDITS } from "./signupGrant.js";

export type ApplyPurchaseResult =
  | { outcome: "credited"; purchaseId: string; credits: number }
  | { outcome: "already_completed"; purchaseId: string }
  | { outcome: "not_found" };

/**
 * Idempotently mark a pending purchase completed and credit the buyer's
 * balance. Shared by BOTH settlement paths:
 *
 *  - POST /credits/purchase/verify  — the browser's success callback
 *  - POST /credits/webhook/razorpay — Razorpay's server-to-server webhook
 *
 * Either may fire first (or both, or the same one twice on retry). The
 * pending→completed claim inside the transaction guarantees exactly-once
 * crediting no matter the order or multiplicity of calls.
 *
 * `expectedUserId` (when known, i.e. the authed verify path) binds the order
 * to the caller; the webhook path omits it and trusts the order row, since
 * the order id itself came from Razorpay's signed payload.
 */
export async function applyPurchaseCreditByOrderId(opts: {
  orderId: string;
  paymentId?: string | null;
  expectedUserId?: string;
  /**
   * Statuses the claim may transition from. Defaults to pending-only.
   * The webhook passes ["pending", "failed"]: /purchase/fail records the
   * CLIENT's view (checkout dismissed/errored), but Razorpay's captured event
   * is authoritative — money moved — and must credit even if the client
   * wrongly marked the row failed first. "completed" is never claimable, so
   * exactly-once crediting is preserved.
   */
  claimableFrom?: ("pending" | "failed")[];
}): Promise<ApplyPurchaseResult> {
  const conditions = [eq(creditsPurchasesTable.orderId, opts.orderId)];
  if (opts.expectedUserId) {
    conditions.push(eq(creditsPurchasesTable.userId, opts.expectedUserId));
  }

  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(and(...conditions))
    .limit(1);

  if (!purchase) return { outcome: "not_found" };

  const credited = await db.transaction(async (tx) => {
    // Claim the purchase row: only ONE caller transitions pending→completed.
    const claimed = await tx
      .update(creditsPurchasesTable)
      .set({
        status: "completed",
        paymentId: opts.paymentId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditsPurchasesTable.id, purchase.id),
          inArray(creditsPurchasesTable.status, opts.claimableFrom ?? ["pending"]),
        ),
      )
      .returning({ id: creditsPurchasesTable.id });

    if (claimed.length === 0) return false; // already completed — no re-credit

    const creditsToAdd = parseFloat(purchase.creditsPurchased ?? "0") || 0;

    const [balance] = await tx
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, purchase.userId))
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
        .where(eq(creditsBalanceTable.userId, purchase.userId));
    } else {
      // A missing balance row must not drop paid credits — seed it.
      await tx.insert(creditsBalanceTable).values({
        id: uuidv4(),
        userId: purchase.userId,
        purchasedCredits: String(creditsToAdd),
        earnedCredits: String(SIGNUP_CREDITS),
        heldCredits: "0",
        updatedAt: new Date(),
      });
    }
    return true;
  });

  if (!credited) {
    logger.info(
      { purchaseId: purchase.id },
      "[credits] purchase settlement replay ignored (already completed)",
    );
    return { outcome: "already_completed", purchaseId: purchase.id };
  }

  logger.info(
    {
      purchaseId: purchase.id,
      credits: purchase.creditsPurchased,
    },
    "[credits] purchase credited",
  );
  return {
    outcome: "credited",
    purchaseId: purchase.id,
    credits: parseFloat(purchase.creditsPurchased ?? "0") || 0,
  };
}
