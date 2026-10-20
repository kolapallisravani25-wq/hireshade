/**
 * Stripe webhook settlement — event-id idempotency, exactly-once credit
 * settlement, refund reversal, and the append-only credit ledger.
 *
 * Guarantees:
 *  1. A Stripe event id (evt_...) is processed at most once. stripe_webhook_events
 *     uses the event id as PRIMARY KEY; the first delivery claims the row and
 *     only the claimer settles. Replays short-circuit to a 200.
 *  2. Even if two DIFFERENT events reference the same checkout session (Stripe
 *     sends checkout.session.completed and async_payment_succeeded for async
 *     payment methods), settlement is still exactly-once: the purchase row is
 *     claimed with a conditional pending/failed -> completed UPDATE inside the
 *     settlement transaction, and the ledger insert carries a UNIQUE
 *     idempotency key (stripe:purchase:<checkout session id>).
 *  3. Credits move ONLY by appending to credits_ledger. credits_balance is a
 *     projection updated in the SAME transaction as the ledger append; it is
 *     never advanced by itself. Ledger rows are never updated or deleted.
 *  4. Refunds reverse a grant exactly once: the purchase row is claimed
 *     completed -> refunded and a negative ledger row is appended under the
 *     same transaction. Replays (charge.refunded + refund.created for the same
 *     refund) observe refunded and are no-ops.
 */

import { db } from "@workspace/db";
import {
  creditsBalanceTable,
  creditsLedgerTable,
  creditsPurchasesTable,
  stripeWebhookEventsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { SIGNUP_CREDITS } from "./signupGrant.js";
import type { StripeWebhookEvent } from "./stripe.js";

// ── Small payload helpers ────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCredits(value: string | null): number {
  const parsed = parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function metadataAmountMinor(amount: string | null): number | null {
  if (amount === null) return null;
  const parsed = parseFloat(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Provider tag lives in credits_purchases.metadata (no new column on the shared
 * table, see the schema comment). Rows without a provider tag are Razorpay's
 * and must never be settled/reversed by the Stripe webhook.
 */
function purchaseProvider(purchase: { metadata: unknown }): string | null {
  const metadata = purchase.metadata as Record<string, unknown> | null;
  const provider = metadata?.["provider"];
  return typeof provider === "string" ? provider : null;
}

function isStripePurchase(purchase: { metadata: unknown }): boolean {
  return purchaseProvider(purchase) === "stripe";
}

// ── Settlement: credit a paid checkout session exactly once ──────────────────

export type StripeSettleOutcome =
  | { outcome: "settled"; purchaseId: string; credits: number }
  // Subscription / plan products are entitlements with zero credit movement:
  // the purchase row is marked completed but no ledger row is appended (the
  // append-only credit ledger only records actual credit deltas).
  | { outcome: "activated"; purchaseId: string }
  | { outcome: "already_completed"; purchaseId: string }
  | { outcome: "already_refunded"; purchaseId: string }
  | { outcome: "not_found" };

export async function settleStripePurchase(opts: {
  checkoutSessionId: string;
  paymentIntentId?: string | null;
  eventId?: string | null;
}): Promise<StripeSettleOutcome> {
  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.orderId, opts.checkoutSessionId))
    .limit(1);

  if (!purchase || !isStripePurchase(purchase)) return { outcome: "not_found" };

  const credits = parseCredits(purchase.creditsPurchased);
  const ledgerIdempotencyKey = "stripe:purchase:" + opts.checkoutSessionId;

  // Entitlement-only products (subscriptions, lifetime/prepaid plans) grant no
  // credits. Claim the purchase row exactly once and record no ledger entry.
  if (credits <= 0) {
    const activated = await db
      .update(creditsPurchasesTable)
      .set({
        status: "completed",
        paymentId: opts.paymentIntentId ?? purchase.paymentId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditsPurchasesTable.id, purchase.id),
          inArray(creditsPurchasesTable.status, ["pending", "failed"]),
        ),
      )
      .returning({ id: creditsPurchasesTable.id });
    if (activated.length === 0) {
      return { outcome: "already_completed", purchaseId: purchase.id };
    }
    logger.info(
      { purchaseId: purchase.id, productKind: (purchase.metadata as Record<string, unknown> | null)?.["productKind"] ?? null },
      "[stripe] entitlement purchase activated (no credit movement)",
    );
    return { outcome: "activated", purchaseId: purchase.id };
  }

  const credited = await db.transaction(async (tx) => {
    // Atomic claim. Only ONE caller can move a pending/failed row to completed;
    // a concurrent replay blocks on the row lock, re-evaluates the WHERE clause
    // after the winner commits, matches nothing, and returns 0 rows.
    const claimed = await tx
      .update(creditsPurchasesTable)
      .set({
        status: "completed",
        paymentId: opts.paymentIntentId ?? purchase.paymentId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditsPurchasesTable.id, purchase.id),
          inArray(creditsPurchasesTable.status, ["pending", "failed"]),
        ),
      )
      .returning({ id: creditsPurchasesTable.id });

    if (claimed.length === 0) return false;

    // Append-only ledger entry. UNIQUE idempotency_key is the second line of
    // defense: if a bug ever let two claimers through, this insert conflicts
    // and the whole transaction rolls back instead of double-crediting.
    const ledgerRows = await tx
      .insert(creditsLedgerTable)
      .values({
        id: uuidv4(),
        userId: purchase.userId,
        entryType: "purchase",
        provider: "stripe",
        providerRef: opts.checkoutSessionId,
        deltaCredits: String(credits),
        currency: purchase.currency,
        amountMinor: metadataAmountMinor(purchase.amount),
        idempotencyKey: ledgerIdempotencyKey,
        metadata: {
          stripeEventId: opts.eventId ?? null,
          paymentIntentId: opts.paymentIntentId ?? null,
          productCode: (purchase.metadata as Record<string, unknown> | null)?.["productCode"] ?? null,
          productKind: (purchase.metadata as Record<string, unknown> | null)?.["productKind"] ?? null,
        },
        createdAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: creditsLedgerTable.id });

    if (ledgerRows.length === 0) {
      // The purchase claim says this is the first settlement, yet the ledger
      // already holds the grant key. That is data corruption; roll back so a
      // retry fails loudly rather than silently skipping the credit.
      throw new Error(
        "[stripe] ledger idempotency key already present for checkout session " +
          opts.checkoutSessionId,
      );
    }

    // Balance projection — only ever advanced here, next to the ledger append,
    // under a row lock so concurrent grant/reversal transactions serialize.
    const [balance] = await tx
      .select()
      .from(creditsBalanceTable)
      .where(eq(creditsBalanceTable.userId, purchase.userId))
      .for("update")
      .limit(1);

    if (balance) {
      const nextPurchased = (parseFloat(balance.purchasedCredits) || 0) + credits;
      await tx
        .update(creditsBalanceTable)
        .set({ purchasedCredits: String(nextPurchased), updatedAt: new Date() })
        .where(eq(creditsBalanceTable.userId, purchase.userId));
    } else {
      // A missing balance row must not drop paid credits — seed it (same
      // behavior as purchaseCredit.applyPurchaseCreditByOrderId).
      await tx.insert(creditsBalanceTable).values({
        id: uuidv4(),
        userId: purchase.userId,
        purchasedCredits: String(credits),
        earnedCredits: String(SIGNUP_CREDITS),
        heldCredits: "0",
        updatedAt: new Date(),
      });
    }

    return true;
  });

  if (!credited) {
    const [current] = await db
      .select({ status: creditsPurchasesTable.status })
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.id, purchase.id))
      .limit(1);
    if (current?.status === "refunded") {
      logger.info(
        { purchaseId: purchase.id, eventId: opts.eventId },
        "[stripe] settlement replay ignored (already refunded)",
      );
      return { outcome: "already_refunded", purchaseId: purchase.id };
    }
    logger.info(
      { purchaseId: purchase.id, eventId: opts.eventId },
      "[stripe] settlement replay ignored (already completed)",
    );
    return { outcome: "already_completed", purchaseId: purchase.id };
  }

  logger.info(
    { purchaseId: purchase.id, credits, checkoutSessionId: opts.checkoutSessionId },
    "[stripe] purchase credited",
  );
  return { outcome: "settled", purchaseId: purchase.id, credits };
}

// ── Refund: reverse a grant exactly once ─────────────────────────────────────

export type StripeReverseOutcome =
  | { outcome: "reversed"; purchaseId: string; creditsReversed: number }
  // Refund observed BEFORE the paid event. The row is durably marked refunded so
  // a later checkout.session.completed can never grant credits for money that
  // was already returned (out-of-order Stripe delivery).
  | { outcome: "blocked"; purchaseId: string }
  | { outcome: "already_refunded"; purchaseId: string }
  | { outcome: "not_found" };

export async function reverseStripePurchase(opts: {
  paymentIntentId?: string | null;
  chargeId?: string | null;
  refundId?: string | null;
  eventId?: string | null;
}): Promise<StripeReverseOutcome> {
  if (!opts.paymentIntentId) return { outcome: "not_found" };

  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.paymentId, opts.paymentIntentId))
    .limit(1);

  if (!purchase || !isStripePurchase(purchase)) return { outcome: "not_found" };

  const credits = parseCredits(purchase.creditsPurchased);
  const ledgerIdempotencyKey =
    "stripe:refund:" + (opts.refundId ?? opts.eventId ?? opts.paymentIntentId);

  const txResult = await db.transaction(async (tx) => {
    // Exactly-once gate: only a completed purchase may be reversed, and the
    // conditional UPDATE lets exactly one caller win under concurrency.
    const claimed = await tx
      .update(creditsPurchasesTable)
      .set({ status: "refunded", updatedAt: new Date() })
      .where(
        and(
          eq(creditsPurchasesTable.id, purchase.id),
          eq(creditsPurchasesTable.status, "completed"),
        ),
      )
      .returning({ id: creditsPurchasesTable.id });

    if (claimed.length === 0) {
      // Not settled (yet). Refund-before-settlement is an out-of-order Stripe
      // delivery: mark the row refunded so the later paid event cannot grant
      // credits for money that was already returned. Only pending/failed rows
      // are claimable here, so an already-refunded row stays a no-op.
      const blocked = await tx
        .update(creditsPurchasesTable)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(
          and(
            eq(creditsPurchasesTable.id, purchase.id),
            inArray(creditsPurchasesTable.status, ["pending", "failed"]),
          ),
        )
        .returning({ id: creditsPurchasesTable.id });
      return blocked.length > 0 ? ("blocked" as const) : ("none" as const);
    }

    // Entitlement-only products (subscriptions / plans) move no credits, so no
    // ledger entry is appended for them.
    if (credits > 0) {
      const ledgerRows = await tx
        .insert(creditsLedgerTable)
        .values({
          id: uuidv4(),
          userId: purchase.userId,
          entryType: "refunded",
          provider: "stripe",
          providerRef: opts.refundId ?? opts.chargeId ?? opts.paymentIntentId,
          deltaCredits: String(-credits),
          currency: purchase.currency,
          amountMinor: metadataAmountMinor(purchase.amount),
          idempotencyKey: ledgerIdempotencyKey,
          metadata: {
            stripeEventId: opts.eventId ?? null,
            chargeId: opts.chargeId ?? null,
            refundId: opts.refundId ?? null,
            paymentIntentId: opts.paymentIntentId,
            // T-12 refund-queue vocabulary: this reversal was safe to run
            // automatically (unused/fully refunded entitlement).
            refundDecision: "automated",
          },
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: creditsLedgerTable.id });

      if (ledgerRows.length === 0) {
        throw new Error(
          "[stripe] refund ledger idempotency key already present for payment intent " +
            opts.paymentIntentId,
        );
      }

      const [balance] = await tx
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, purchase.userId))
        .for("update")
        .limit(1);

      if (balance) {
        // Clamp at zero: if the buyer already consumed the credits the ledger
        // still records the full negative reversal (append-only truth), while
        // the projection cannot go negative.
        const nextPurchased = Math.max(0, (parseFloat(balance.purchasedCredits) || 0) - credits);
        await tx
          .update(creditsBalanceTable)
          .set({ purchasedCredits: String(nextPurchased), updatedAt: new Date() })
          .where(eq(creditsBalanceTable.userId, purchase.userId));
      }
    }

    return "reversed" as const;
  });

  if (txResult === "blocked") {
    logger.info(
      { purchaseId: purchase.id, eventId: opts.eventId },
      "[stripe] refund observed before settlement — purchase marked refunded (no credit)",
    );
    return { outcome: "blocked", purchaseId: purchase.id };
  }
  if (txResult === "none") {
    logger.info(
      { purchaseId: purchase.id, eventId: opts.eventId },
      "[stripe] refund replay ignored (already refunded)",
    );
    return { outcome: "already_refunded", purchaseId: purchase.id };
  }

  logger.info(
    { purchaseId: purchase.id, credits, refundId: opts.refundId },
    "[stripe] purchase refund reversed",
  );
  return { outcome: "reversed", purchaseId: purchase.id, creditsReversed: credits };
}

// ── Failure path: mark a pending purchase failed (never credits) ─────────────

export type StripeFailureOutcome =
  | { outcome: "marked_failed"; purchaseId: string }
  | { outcome: "already_final"; purchaseId: string; status: string }
  | { outcome: "not_found" };

export async function markStripePurchaseFailed(opts: {
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  reason?: string | null;
}): Promise<StripeFailureOutcome> {
  let condition;
  if (opts.checkoutSessionId) {
    condition = eq(creditsPurchasesTable.orderId, opts.checkoutSessionId);
  } else if (opts.paymentIntentId) {
    condition = eq(creditsPurchasesTable.paymentId, opts.paymentIntentId);
  } else {
    return { outcome: "not_found" };
  }

  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(condition)
    .limit(1);
  if (!purchase || !isStripePurchase(purchase)) return { outcome: "not_found" };

  const updated = await db
    .update(creditsPurchasesTable)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(creditsPurchasesTable.id, purchase.id),
        eq(creditsPurchasesTable.status, "pending"),
      ),
    )
    .returning({ id: creditsPurchasesTable.id });

  if (updated.length > 0) {
    logger.info(
      { purchaseId: purchase.id, reason: opts.reason ?? null },
      "[stripe] purchase marked failed (no credits granted)",
    );
    return { outcome: "marked_failed", purchaseId: purchase.id };
  }

  return { outcome: "already_final", purchaseId: purchase.id, status: purchase.status };
}

// ── Event dispatch ──────────────────────────────────────────────────────────

type StripeEventAction =
  | { kind: "settled"; purchaseId: string; credits: number }
  | { kind: "activated"; purchaseId: string }
  | { kind: "settle_replay"; purchaseId: string; reason: string }
  | { kind: "reversed"; purchaseId: string; credits: number }
  | { kind: "refund_replay"; purchaseId: string }
  | { kind: "marked_failed"; purchaseId: string }
  | { kind: "ignored"; reason: string };

async function handleStripeEvent(event: StripeWebhookEvent): Promise<StripeEventAction> {
  const object = asRecord(event.data.object) ?? {};
  const objectId = stringValue(object["id"]);

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (!objectId) return { kind: "ignored", reason: "missing_checkout_session_id" };
      const paymentStatus = stringValue(object["payment_status"]);
      // Fulfillment must be gated on payment_status: for async payment methods
      // checkout.session.completed can arrive while still unpaid; the
      // async_payment_succeeded event later carries payment_status=paid.
      if (paymentStatus !== "paid") {
        return { kind: "ignored", reason: "payment_status_" + (paymentStatus ?? "missing") };
      }
      const settled = await settleStripePurchase({
        checkoutSessionId: objectId,
        paymentIntentId: stringValue(object["payment_intent"]),
        eventId: event.id,
      });
      if (settled.outcome === "settled") {
        return { kind: "settled", purchaseId: settled.purchaseId, credits: settled.credits };
      }
      if (settled.outcome === "activated") {
        return { kind: "activated", purchaseId: settled.purchaseId };
      }
      if (settled.outcome === "already_completed") {
        return { kind: "settle_replay", purchaseId: settled.purchaseId, reason: "already_completed" };
      }
      if (settled.outcome === "already_refunded") {
        return { kind: "settle_replay", purchaseId: settled.purchaseId, reason: "already_refunded" };
      }
      return { kind: "ignored", reason: "unknown_checkout_session" };
    }

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const marked = await markStripePurchaseFailed({
        checkoutSessionId: objectId,
        paymentIntentId: stringValue(object["payment_intent"]),
        reason: event.type,
      });
      if (marked.outcome === "marked_failed") {
        return { kind: "marked_failed", purchaseId: marked.purchaseId };
      }
      if (marked.outcome === "already_final") {
        return { kind: "ignored", reason: "purchase_already_" + marked.status };
      }
      return { kind: "ignored", reason: "unknown_checkout_session" };
    }

    case "payment_intent.payment_failed": {
      const marked = await markStripePurchaseFailed({
        paymentIntentId: objectId,
        reason: "payment_intent.payment_failed",
      });
      if (marked.outcome === "marked_failed") {
        return { kind: "marked_failed", purchaseId: marked.purchaseId };
      }
      if (marked.outcome === "already_final") {
        return { kind: "ignored", reason: "purchase_already_" + marked.status };
      }
      return { kind: "ignored", reason: "unknown_payment_intent" };
    }

    case "charge.refunded": {
      const refunded = object["refunded"] === true;
      const amount = numberValue(object["amount"]);
      const amountRefunded = numberValue(object["amount_refunded"]);
      const fullyRefunded =
        refunded || (amount !== null && amountRefunded !== null && amountRefunded >= amount);
      if (!fullyRefunded) {
        // Partial refunds do not reverse a full credit grant; a human decides.
        return { kind: "ignored", reason: "partial_refund_requires_manual_review" };
      }
      let refundId: string | null = null;
      const refunds = asRecord(object["refunds"]);
      const refundData = refunds?.["data"];
      if (Array.isArray(refundData) && refundData.length > 0) {
        refundId = stringValue(asRecord(refundData[0])?.["id"]);
      }
      const reversed = await reverseStripePurchase({
        paymentIntentId: stringValue(object["payment_intent"]),
        chargeId: objectId,
        refundId,
        eventId: event.id,
      });
      if (reversed.outcome === "reversed") {
        return { kind: "reversed", purchaseId: reversed.purchaseId, credits: reversed.creditsReversed };
      }
      if (reversed.outcome === "already_refunded") {
        return { kind: "refund_replay", purchaseId: reversed.purchaseId };
      }
      if (reversed.outcome === "blocked") {
        // T-12 refund queue: out-of-order refunds are "blocked"; the purchase
        // row is durably refunded so a later paid event cannot credit.
        return { kind: "ignored", reason: "refund_blocked_purchase_not_completed" };
      }
      return { kind: "ignored", reason: "refund_queue_failed_unknown_payment_intent" };
    }

    case "refund.created": {
      const status = stringValue(object["status"]);
      if (status !== null && status !== "succeeded") {
        return { kind: "ignored", reason: "refund_status_" + status };
      }
      const reversed = await reverseStripePurchase({
        paymentIntentId: stringValue(object["payment_intent"]),
        chargeId: stringValue(object["charge"]),
        refundId: objectId,
        eventId: event.id,
      });
      if (reversed.outcome === "reversed") {
        return { kind: "reversed", purchaseId: reversed.purchaseId, credits: reversed.creditsReversed };
      }
      if (reversed.outcome === "already_refunded") {
        return { kind: "refund_replay", purchaseId: reversed.purchaseId };
      }
      if (reversed.outcome === "blocked") {
        return { kind: "ignored", reason: "refund_blocked_purchase_not_completed" };
      }
      return { kind: "ignored", reason: "refund_queue_failed_unknown_payment_intent" };
    }

    default:
      return { kind: "ignored", reason: "unhandled_event_type_" + event.type };
  }
}

// ── Public entrypoint: claim event id, process once, record outcome ─────────

export interface StripeWebhookResult {
  received: true;
  status: "processed" | "ignored" | "duplicate";
  action?: string;
  reason?: string;
  purchaseId?: string;
  credits?: number;
  priorStatus?: string;
}

/**
 * Process a verified Stripe webhook event at most once.
 *
 * Throws on transient/DB failures so the route can answer 500 and Stripe will
 * retry; the event row is marked "failed" and a retry delivery may reclaim it.
 */
export async function processStripeWebhookEvent(
  event: StripeWebhookEvent,
  opts: { now?: Date } = {},
): Promise<StripeWebhookResult> {
  const now = opts.now ?? new Date();

  const claimed = await db
    .insert(stripeWebhookEventsTable)
    .values({
      id: event.id,
      type: event.type,
      status: "processing",
      objectId: stringValue(asRecord(event.data.object)?.["id"]),
      payload: event as unknown as Record<string, unknown>,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEventsTable.id });

  if (claimed.length === 0) {
    const [existing] = await db
      .select()
      .from(stripeWebhookEventsTable)
      .where(eq(stripeWebhookEventsTable.id, event.id))
      .limit(1);

    if (!existing) {
      // Conflict without a visible row should be impossible; treat it as
      // transient so Stripe retries rather than silently dropping the event.
      throw new Error("[stripe] webhook event claim conflict without a visible row");
    }

    if (existing.status === "failed") {
      const reclaimed = await db
        .update(stripeWebhookEventsTable)
        .set({ status: "processing", error: null })
        .where(
          and(
            eq(stripeWebhookEventsTable.id, event.id),
            eq(stripeWebhookEventsTable.status, "failed"),
          ),
        )
        .returning({ id: stripeWebhookEventsTable.id });
      if (reclaimed.length === 0) {
        return {
          received: true,
          status: "duplicate",
          priorStatus: existing.status,
        };
      }
      // fall through — retry the failed delivery
    } else {
      // processed/ignored/processing: a concurrent delivery or a replay.
      return {
        received: true,
        status: "duplicate",
        priorStatus: existing.status,
      };
    }
  }

  try {
    const action = await handleStripeEvent(event);
    const status: "processed" | "ignored" = action.kind === "ignored" ? "ignored" : "processed";
    await db
      .update(stripeWebhookEventsTable)
      .set({
        status,
        processedAt: new Date(),
        error: null,
        objectId: stringValue(asRecord(event.data.object)?.["id"]),
      })
      .where(eq(stripeWebhookEventsTable.id, event.id));

    return {
      received: true,
      status,
      action: action.kind,
      ...(action.kind === "ignored" ? { reason: action.reason } : {}),
      ...(action.kind === "settled" ? { purchaseId: action.purchaseId, credits: action.credits } : {}),
      ...(action.kind === "activated" ? { purchaseId: action.purchaseId } : {}),
      ...(action.kind === "settle_replay" ? { purchaseId: action.purchaseId, reason: action.reason } : {}),
      ...(action.kind === "reversed" ? { purchaseId: action.purchaseId, credits: action.credits } : {}),
      ...(action.kind === "refund_replay" ? { purchaseId: action.purchaseId } : {}),
      ...(action.kind === "marked_failed" ? { purchaseId: action.purchaseId } : {}),
    };
  } catch (err) {
    await db
      .update(stripeWebhookEventsTable)
      .set({
        status: "failed",
        processedAt: new Date(),
        error: String(err instanceof Error ? err.message : err).slice(0, 500),
      })
      .where(eq(stripeWebhookEventsTable.id, event.id));
    throw err;
  }
}
