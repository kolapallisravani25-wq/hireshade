/**
 * Razorpay webhook processing — X-Razorpay-Event-Id idempotency, exactly-once
 * settlement, mandate/subscription lifecycle, refunds and GST invoices.
 *
 * Mirrors the Stripe settlement guarantees:
 *  1. X-Razorpay-Event-Id is the PRIMARY KEY of razorpay_webhook_events; the
 *     first delivery claims the row and only the claimer processes. Replays and
 *     concurrent duplicates short-circuit with a 200. A delivery that failed is
 *     marked "failed" and may be reclaimed by a retry.
 *  2. Settlement is exactly-once even across DIFFERENT event ids for the same
 *     order (payment.authorized -> payment.captured -> order.paid): a
 *     conditional pending/failed -> completed purchase claim plus a UNIQUE
 *     ledger idempotency key (razorpay:purchase:<orderId>).
 *  3. Credits move only by appending to credits_ledger; credits_balance is a
 *     projection advanced in the same transaction.
 *  4. Refunds (created via the refund API) reverse the grant with compensating
 *     ledger rows: refund.processed claims the purchase exactly once for a full
 *     refund; partial refunds append a proportional negative row per refund id.
 *  5. Subscription/mandate events upsert a gateway-neutral billing_subscriptions
 *     row. halted/paused pauses entitlement WITHOUT deleting it; resumed
 *     restores it. Terminal states are immutable against stale retries.
 */

import { db } from "@workspace/db";
import {
  billingInvoicesTable,
  billingSubscriptionsTable,
  creditsBalanceTable,
  creditsLedgerTable,
  creditsPurchasesTable,
  razorpayWebhookEventsTable,
} from "@workspace/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger.js";
import { SIGNUP_CREDITS } from "./signupGrant.js";
import { MANDATE_PRE_DEBIT_WINDOW_HOURS, computePreDebitNotificationAt } from "./razorpay.js";
import {
  BILLING_PLANS,
  canApplySubscriptionTransition,
  entitlementStateForStatus,
  normalizeMandateMethod,
  resolveRazorpayPlanId,
  subscriptionStatusForEvent,
  type SubscriptionStatus,
} from "./razorpayPlans.js";
import { computeGst, configuredGstInclusive, configuredGstRateBps, configuredSupplierStateCode } from "./razorpayGst.js";

// ── Payload helpers ─────────────────────────────────────────────────────────

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

function amountMinorFromMajor(amount: string | null): number | null {
  if (amount === null) return null;
  const parsed = parseFloat(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function dateFromUnix(value: unknown): Date | null {
  const seconds = numberValue(value);
  if (seconds === null || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

// Sourced from the DB-free plan module so it is unit-testable.
import { classifyPurchaseGateway as purchaseGateway } from "./razorpayPlans.js";
export { purchaseGateway };

function planCodeFromPurchase(purchase: { metadata: unknown }): string | null {
  const metadata = purchase.metadata as Record<string, unknown> | null;
  return stringValue(metadata?.["planCode"]) ?? stringValue(metadata?.["packCode"]);
}

// ── Credit-pack settlement (exactly once) ───────────────────────────────────

export type RazorpaySettleOutcome =
  | { outcome: "settled"; purchaseId: string; credits: number }
  | { outcome: "activated"; purchaseId: string }
  | { outcome: "already_completed"; purchaseId: string }
  | { outcome: "already_refunded"; purchaseId: string }
  | { outcome: "not_found" };

export async function settleRazorpayPurchase(opts: {
  orderId: string;
  paymentId?: string | null;
  eventId?: string | null;
}): Promise<RazorpaySettleOutcome> {
  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.orderId, opts.orderId))
    .limit(1);

  if (!purchase || purchaseGateway(purchase) !== "razorpay") {
    return { outcome: "not_found" };
  }

  const credits = parseCredits(purchase.creditsPurchased);
  const ledgerIdempotencyKey = "razorpay:purchase:" + opts.orderId;
  const planCode = planCodeFromPurchase(purchase);

  const result = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(creditsPurchasesTable)
      .set({
        status: "completed",
        paymentId: opts.paymentId ?? purchase.paymentId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditsPurchasesTable.id, purchase.id),
          inArray(creditsPurchasesTable.status, ["pending", "failed"]),
        ),
      )
      .returning({ id: creditsPurchasesTable.id });

    if (claimed.length === 0) return "already" as const;

    if (credits > 0) {
      const ledgerRows = await tx
        .insert(creditsLedgerTable)
        .values({
          id: uuidv4(),
          userId: purchase.userId,
          entryType: "purchase",
          provider: "razorpay",
          providerRef: opts.orderId,
          deltaCredits: String(credits),
          currency: "INR",
          amountMinor: amountMinorFromMajor(purchase.amount),
          idempotencyKey: ledgerIdempotencyKey,
          metadata: {
            razorpayEventId: opts.eventId ?? null,
            paymentId: opts.paymentId ?? null,
            planCode,
          },
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: creditsLedgerTable.id });

      if (ledgerRows.length === 0) {
        throw new Error(
          "[razorpay] ledger idempotency key already present for order " + opts.orderId,
        );
      }

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
        await tx.insert(creditsBalanceTable).values({
          id: uuidv4(),
          userId: purchase.userId,
          purchasedCredits: String(credits),
          earnedCredits: String(SIGNUP_CREDITS),
          heldCredits: "0",
          updatedAt: new Date(),
        });
      }
    }

    // Invoice becomes paid in the same transaction as the credit movement.
    await tx
      .update(billingInvoicesTable)
      .set({
        providerPaymentId: opts.paymentId ?? null,
        status: "paid",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(billingInvoicesTable.gateway, "razorpay"),
          eq(billingInvoicesTable.providerOrderId, opts.orderId),
        ),
      );

    return "settled" as const;
  });

  if (result === "already") {
    const [current] = await db
      .select({ status: creditsPurchasesTable.status })
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.id, purchase.id))
      .limit(1);
    if (current?.status === "refunded") {
      return { outcome: "already_refunded", purchaseId: purchase.id };
    }
    return { outcome: "already_completed", purchaseId: purchase.id };
  }

  logger.info(
    { purchaseId: purchase.id, credits, orderId: opts.orderId },
    "[razorpay] purchase settled",
  );
  if (credits <= 0) return { outcome: "activated", purchaseId: purchase.id };
  return { outcome: "settled", purchaseId: purchase.id, credits };
}

// ── Failure path ────────────────────────────────────────────────────────────

export type RazorpayFailureOutcome =
  | { outcome: "marked_failed"; purchaseId: string }
  | { outcome: "already_final"; purchaseId: string; status: string }
  | { outcome: "not_found" };

export async function markRazorpayPurchaseFailed(opts: {
  orderId?: string | null;
  paymentId?: string | null;
  reason?: string | null;
}): Promise<RazorpayFailureOutcome> {
  let condition;
  if (opts.orderId) {
    condition = eq(creditsPurchasesTable.orderId, opts.orderId);
  } else if (opts.paymentId) {
    condition = eq(creditsPurchasesTable.paymentId, opts.paymentId);
  } else {
    return { outcome: "not_found" };
  }

  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(condition)
    .limit(1);
  if (!purchase || purchaseGateway(purchase) !== "razorpay") {
    return { outcome: "not_found" };
  }

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
      "[razorpay] purchase marked failed (no credits granted)",
    );
    return { outcome: "marked_failed", purchaseId: purchase.id };
  }
  return { outcome: "already_final", purchaseId: purchase.id, status: purchase.status };
}

// ── Refund reversal (compensating ledger entries) ───────────────────────────

export type RazorpayReverseOutcome =
  | { outcome: "reversed"; purchaseId: string; creditsReversed: number; partial: boolean }
  | { outcome: "blocked"; purchaseId: string }
  | { outcome: "already_refunded"; purchaseId: string }
  | { outcome: "not_found" };

export async function reverseRazorpayPurchase(opts: {
  paymentId: string | null | undefined;
  refundId?: string | null;
  eventId?: string | null;
  /** Refund amount in paise. Undefined/null => full refund. */
  refundAmountMinor?: number | null;
}): Promise<RazorpayReverseOutcome> {
  if (!opts.paymentId) return { outcome: "not_found" };

  const [purchase] = await db
    .select()
    .from(creditsPurchasesTable)
    .where(eq(creditsPurchasesTable.paymentId, opts.paymentId))
    .limit(1);
  if (!purchase || purchaseGateway(purchase) !== "razorpay") {
    return { outcome: "not_found" };
  }

  const credits = parseCredits(purchase.creditsPurchased);
  const purchaseMinor = amountMinorFromMajor(purchase.amount);
  const refundMinor = opts.refundAmountMinor ?? null;
  const isFullRefund =
    refundMinor === null || purchaseMinor === null || refundMinor >= purchaseMinor;
  const refundCredits = isFullRefund
    ? credits
    : round4((credits * (refundMinor ?? 0)) / Math.max(1, purchaseMinor ?? 0));
  const ledgerIdempotencyKey = "razorpay:refund:" + (opts.refundId ?? opts.eventId ?? opts.paymentId);

  const txResult = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(creditsPurchasesTable)
      .where(eq(creditsPurchasesTable.id, purchase.id))
      .for("update")
      .limit(1);

    if (!locked) return "none" as const;

    if (locked.status === "pending" || locked.status === "failed") {
      // Refund observed before settlement: durably mark refunded so a late
      // capture event cannot grant credits for returned money.
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
    if (locked.status !== "completed") return "none" as const;

    if (refundCredits > 0) {
      const ledgerRows = await tx
        .insert(creditsLedgerTable)
        .values({
          id: uuidv4(),
          userId: purchase.userId,
          entryType: "refunded",
          provider: "razorpay",
          providerRef: opts.refundId ?? opts.paymentId,
          deltaCredits: String(-refundCredits),
          currency: "INR",
          amountMinor: refundMinor,
          idempotencyKey: ledgerIdempotencyKey,
          metadata: {
            razorpayEventId: opts.eventId ?? null,
            paymentId: opts.paymentId,
            refundId: opts.refundId ?? null,
            partial: !isFullRefund,
            refundDecision: "automated",
          },
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: creditsLedgerTable.id });

      if (ledgerRows.length === 0) return "already" as const;

      const [balance] = await tx
        .select()
        .from(creditsBalanceTable)
        .where(eq(creditsBalanceTable.userId, purchase.userId))
        .for("update")
        .limit(1);
      if (balance) {
        const nextPurchased = Math.max(
          0,
          (parseFloat(balance.purchasedCredits) || 0) - refundCredits,
        );
        await tx
          .update(creditsBalanceTable)
          .set({ purchasedCredits: String(nextPurchased), updatedAt: new Date() })
          .where(eq(creditsBalanceTable.userId, purchase.userId));
      }
    }

    if (isFullRefund) {
      await tx
        .update(creditsPurchasesTable)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(eq(creditsPurchasesTable.id, purchase.id));
      await tx
        .update(billingInvoicesTable)
        .set({ status: "refunded", updatedAt: new Date() })
        .where(
          and(
            eq(billingInvoicesTable.gateway, "razorpay"),
            eq(billingInvoicesTable.providerOrderId, purchase.orderId ?? ""),
          ),
        );
    }

    return "reversed" as const;
  });

  if (txResult === "blocked") {
    return { outcome: "blocked", purchaseId: purchase.id };
  }
  if (txResult === "already") {
    return { outcome: "already_refunded", purchaseId: purchase.id };
  }
  if (txResult === "none") {
    return { outcome: "already_refunded", purchaseId: purchase.id };
  }
  logger.info(
    { purchaseId: purchase.id, refundCredits, partial: !isFullRefund },
    "[razorpay] purchase refund compensated in ledger",
  );
  return {
    outcome: "reversed",
    purchaseId: purchase.id,
    creditsReversed: refundCredits,
    partial: !isFullRefund,
  };
}

// ── Subscription / mandate lifecycle ────────────────────────────────────────

export interface SubscriptionUpsertResult {
  outcome: "applied" | "stale_transition" | "unknown_plan" | "unknown_user" | "ignored";
  subscriptionId?: string;
  status?: string;
  entitlementState?: string;
}

function resolvePlanCodeForSubscription(entity: Record<string, unknown>): string | null {
  const notes = asRecord(entity["notes"]);
  const fromNotes = stringValue(notes?.["planCode"]);
  if (fromNotes && BILLING_PLANS.some((plan) => plan.code === fromNotes)) return fromNotes;
  const planId = stringValue(entity["plan_id"]);
  if (planId) {
    const match = BILLING_PLANS.find(
      (plan) => plan.kind === "subscription" && resolveRazorpayPlanId(plan) === planId,
    );
    if (match) return match.code;
  }
  return null;
}

function resolveUserIdForSubscription(
  entity: Record<string, unknown>,
  existing: { userId: string } | undefined,
): string | null {
  if (existing) return existing.userId;
  const notes = asRecord(entity["notes"]);
  return stringValue(notes?.["userId"]);
}

export async function applyRazorpaySubscriptionEvent(opts: {
  eventType: string;
  eventId: string;
  entity: Record<string, unknown>;
  payment?: Record<string, unknown> | null;
  now?: Date;
}): Promise<SubscriptionUpsertResult> {
  const now = opts.now ?? new Date();
  const subscriptionId = stringValue(opts.entity["id"]);
  if (!subscriptionId) return { outcome: "ignored" };
  const nextStatus = subscriptionStatusForEvent(opts.eventType);
  if (!nextStatus) return { outcome: "ignored" };

  const [existing] = await db
    .select()
    .from(billingSubscriptionsTable)
    .where(
      and(
        eq(billingSubscriptionsTable.gateway, "razorpay"),
        eq(billingSubscriptionsTable.providerSubscriptionId, subscriptionId),
      ),
    )
    .limit(1);

  const planCode = resolvePlanCodeForSubscription(opts.entity) ?? existing?.planCode ?? null;
  if (!planCode) return { outcome: "unknown_plan" };
  const userId = resolveUserIdForSubscription(opts.entity, existing);
  if (!userId) return { outcome: "unknown_user" };

  const currentStatus = (existing?.status ?? "created") as SubscriptionStatus;
  if (!canApplySubscriptionTransition(currentStatus, nextStatus)) {
    return {
      outcome: "stale_transition",
      subscriptionId,
      status: currentStatus,
      entitlementState: existing?.entitlementState,
    };
  }

  const entitlementState = entitlementStateForStatus(nextStatus);
  const payment = opts.payment ?? null;
  const mandateMethod = normalizeMandateMethod(
    opts.entity["payment_method"] ?? payment?.["method"] ?? existing?.mandateMethod,
  );
  const currentStart = dateFromUnix(opts.entity["current_start"]);
  const currentEnd = dateFromUnix(opts.entity["current_end"]);
  const chargeAt = dateFromUnix(opts.entity["charge_at"]);
  const preDebitNotifyAt =
    chargeAt && (nextStatus === "pending" || nextStatus === "active")
      ? computePreDebitNotificationAt({
          chargeAt,
          windowHours: existing?.preDebitWindowHours ?? MANDATE_PRE_DEBIT_WINDOW_HOURS,
          now,
        })
      : existing?.preDebitNotifyAt ?? null;

  const updates: Record<string, unknown> = {
    planCode,
    status: nextStatus,
    entitlementState,
    providerPlanId: stringValue(opts.entity["plan_id"]) ?? existing?.providerPlanId ?? null,
    providerCustomerId: stringValue(opts.entity["customer_id"]) ?? existing?.providerCustomerId ?? null,
    mandateId:
      stringValue(opts.entity["mandate_id"]) ??
      stringValue(opts.entity["token_id"]) ??
      existing?.mandateId ??
      null,
    mandateMethod,
    paidCount: numberValue(opts.entity["paid_count"]) ?? existing?.paidCount ?? null,
    totalCount: numberValue(opts.entity["total_count"]) ?? existing?.totalCount ?? null,
    currentPeriodStart: currentStart ?? existing?.currentPeriodStart ?? null,
    currentPeriodEnd: currentEnd ?? existing?.currentPeriodEnd ?? null,
    nextChargeAt: chargeAt ?? existing?.nextChargeAt ?? null,
    preDebitNotifyAt,
    updatedAt: now,
  };

  if (nextStatus === "halted") {
    updates["haltedAt"] = existing?.haltedAt ?? now;
  }
  if (
    nextStatus === "active" &&
    (currentStatus === "halted" || currentStatus === "paused")
  ) {
    updates["resumedAt"] = now;
  }
  if (nextStatus === "cancelled") updates["cancelledAt"] = now;
  if (nextStatus === "completed") updates["completedAt"] = now;

  if (existing) {
    await db
      .update(billingSubscriptionsTable)
      .set(updates)
      .where(eq(billingSubscriptionsTable.id, existing.id));
    logger.info(
      { subscriptionId, from: currentStatus, to: nextStatus, entitlementState },
      "[razorpay] subscription transition applied",
    );
    return { outcome: "applied", subscriptionId, status: nextStatus, entitlementState };
  }

  const plan = BILLING_PLANS.find((candidate) => candidate.code === planCode)!;
  const currency = stringValue(asRecord(opts.entity["notes"])?.["currency"]) ?? "INR";
  await db.insert(billingSubscriptionsTable).values({
    id: uuidv4(),
    userId,
    gateway: "razorpay",
    planCode,
    providerSubscriptionId: subscriptionId,
    providerPlanId: stringValue(opts.entity["plan_id"]),
    providerCustomerId: stringValue(opts.entity["customer_id"]),
    status: nextStatus,
    entitlementState,
    mandateId: stringValue(opts.entity["mandate_id"]) ?? stringValue(opts.entity["token_id"]),
    mandateMethod,
    currency,
    amountMinor: plan.amountMinor["INR"],
    interval: plan.interval ?? null,
    totalCount: numberValue(opts.entity["total_count"]),
    paidCount: numberValue(opts.entity["paid_count"]),
    currentPeriodStart: currentStart,
    currentPeriodEnd: currentEnd,
    nextChargeAt: chargeAt,
    preDebitNotifyAt,
    preDebitWindowHours: MANDATE_PRE_DEBIT_WINDOW_HOURS,
    haltedAt: nextStatus === "halted" ? now : null,
    resumedAt: null,
    cancelledAt: nextStatus === "cancelled" ? now : null,
    completedAt: nextStatus === "completed" ? now : null,
    metadata: { createdByWebhookEventId: opts.eventId },
    createdAt: now,
    updatedAt: now,
  });

  logger.info(
    { subscriptionId, status: nextStatus, entitlementState, planCode },
    "[razorpay] subscription provisioned",
  );
  return { outcome: "applied", subscriptionId, status: nextStatus, entitlementState };
}

/** invoice.paid frees the next period and records the GST invoice row. */
export async function applyRazorpayInvoicePaid(opts: {
  eventId: string;
  entity: Record<string, unknown>;
  now?: Date;
}): Promise<{ outcome: "applied" | "ignored"; invoiceId?: string; subscriptionId?: string }> {
  const now = opts.now ?? new Date();
  const invoiceId = stringValue(opts.entity["id"]);
  const subscriptionId = stringValue(opts.entity["subscription_id"]);
  if (!invoiceId) return { outcome: "ignored" };

  const [subscription] = subscriptionId
    ? await db
        .select()
        .from(billingSubscriptionsTable)
        .where(
          and(
            eq(billingSubscriptionsTable.gateway, "razorpay"),
            eq(billingSubscriptionsTable.providerSubscriptionId, subscriptionId),
          ),
        )
        .limit(1)
    : [];

  if (subscriptionId) {
    const periodStart =
      dateFromUnix(opts.entity["period_start"]) ?? dateFromUnix(opts.entity["billing_start"]);
    const periodEnd =
      dateFromUnix(opts.entity["period_end"]) ?? dateFromUnix(opts.entity["billing_end"]);
    if (subscription) {
      await db
        .update(billingSubscriptionsTable)
        .set({
          paidCount: numberValue(opts.entity["paid_count"]) ?? subscription.paidCount,
          currentPeriodStart: periodStart ?? subscription.currentPeriodStart,
          currentPeriodEnd: periodEnd ?? subscription.currentPeriodEnd,
          nextChargeAt: periodEnd ?? subscription.nextChargeAt,
          preDebitNotifyAt: periodEnd
            ? computePreDebitNotificationAt({
                chargeAt: periodEnd,
                windowHours: subscription.preDebitWindowHours,
                now,
              })
            : subscription.preDebitNotifyAt,
          updatedAt: now,
        })
        .where(eq(billingSubscriptionsTable.id, subscription.id));
    }
  }

  const planCode = subscription?.planCode ?? null;
  if (!planCode) return { outcome: "ignored" };

  const amountPaid = numberValue(opts.entity["amount_paid"]);
  const totalMinor = amountPaid ?? 0;
  const invoiceNotes = asRecord(opts.entity["notes"]);
  const subscriptionMetadata = asRecord(subscription?.metadata ?? null);
  const gst = computeGst({
    amountMinor: totalMinor,
    taxInclusive: configuredGstInclusive(),
    taxRateBps: configuredGstRateBps(),
    supplierStateCode: configuredSupplierStateCode(),
    gstin:
      stringValue(invoiceNotes?.["gstin"]) ??
      stringValue(subscriptionMetadata?.["gstin"]),
    placeOfSupplyStateCode:
      stringValue(invoiceNotes?.["placeOfSupplyStateCode"]) ??
      stringValue(subscriptionMetadata?.["placeOfSupplyStateCode"]) ??
      undefined,
  });

  const invoiceRowId = uuidv4();
  const inserted = await db
    .insert(billingInvoicesTable)
    .values({
      id: invoiceRowId,
      userId: subscription!.userId,
      gateway: "razorpay",
      planCode,
      providerPaymentId: stringValue(opts.entity["payment_id"]),
      providerInvoiceId: invoiceId,
      providerSubscriptionId: subscriptionId,
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
      status: "paid",
      metadata: { createdByWebhookEventId: opts.eventId },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: billingInvoicesTable.id });

  return {
    outcome: "applied",
    invoiceId: inserted[0]?.id ?? invoiceRowId,
    subscriptionId: subscriptionId ?? undefined,
  };
}

// ── Event dispatch ──────────────────────────────────────────────────────────

export type RazorpayEventAction =
  | { kind: "settled"; purchaseId: string; credits: number }
  | { kind: "activated"; purchaseId: string }
  | { kind: "settle_replay"; purchaseId: string; reason: string }
  | { kind: "marked_failed"; purchaseId: string }
  | { kind: "payment_recorded"; purchaseId: string }
  | { kind: "refund_reversed"; purchaseId: string; credits: number; partial: boolean }
  | { kind: "refund_blocked"; purchaseId: string }
  | { kind: "refund_recorded"; refundId: string | null }
  | { kind: "refund_replay"; purchaseId: string }
  | { kind: "subscription_applied"; subscriptionId: string; status: string; entitlementState: string }
  | { kind: "invoice_paid"; invoiceId: string }
  | { kind: "ignored"; reason: string };

function eventPayloadEntity(event: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const payload = asRecord(event["payload"]);
  const entry = payload ? asRecord(payload[key]) : null;
  return entry ? asRecord(entry["entity"]) : null;
}

async function handleRazorpayEvent(
  event: Record<string, unknown>,
  eventId: string,
  now: Date,
): Promise<RazorpayEventAction> {
  const type = stringValue(event["event"]);
  if (!type) return { kind: "ignored", reason: "missing_event_type" };

  if (
    type === "payment.authorized" ||
    type === "payment.captured" ||
    type === "payment.failed"
  ) {
    const payment = eventPayloadEntity(event, "payment");
    const orderId = stringValue(payment?.["order_id"]);
    const paymentId = stringValue(payment?.["id"]);

    if (type === "payment.failed") {
      const marked = await markRazorpayPurchaseFailed({
        orderId,
        paymentId,
        reason: "payment.failed",
      });
      if (marked.outcome === "marked_failed") {
        return { kind: "marked_failed", purchaseId: marked.purchaseId };
      }
      if (marked.outcome === "already_final") {
        return { kind: "ignored", reason: "purchase_already_" + marked.status };
      }
      return { kind: "ignored", reason: "unknown_order" };
    }

    if (type === "payment.authorized") {
      // Informational: remember the payment id on the pending purchase but grant
      // nothing (authorization is not capture).
      if (orderId) {
        const [purchase] = await db
          .select()
          .from(creditsPurchasesTable)
          .where(eq(creditsPurchasesTable.orderId, orderId))
          .limit(1);
        if (purchase && purchaseGateway(purchase) === "razorpay") {
          await db
            .update(creditsPurchasesTable)
            .set({ paymentId: paymentId ?? purchase.paymentId, updatedAt: now })
            .where(eq(creditsPurchasesTable.id, purchase.id));
          return { kind: "payment_recorded", purchaseId: purchase.id };
        }
      }
      return { kind: "ignored", reason: "unknown_order" };
    }

    if (orderId) {
      const settled = await settleRazorpayPurchase({
        orderId,
        paymentId,
        eventId,
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
    }
    return { kind: "ignored", reason: "unknown_order" };
  }

  if (type === "order.paid") {
    const order = eventPayloadEntity(event, "order");
    const orderId = stringValue(order?.["id"]);
    const payment = eventPayloadEntity(event, "payment");
    const paymentId = stringValue(payment?.["id"]);
    if (orderId) {
      const settled = await settleRazorpayPurchase({ orderId, paymentId, eventId });
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
    }
    return { kind: "ignored", reason: "unknown_order" };
  }

  if (type.startsWith("subscription.")) {
    const entity = eventPayloadEntity(event, "subscription");
    if (!entity) return { kind: "ignored", reason: "missing_subscription_entity" };
    const payment = eventPayloadEntity(event, "payment");
    const applied = await applyRazorpaySubscriptionEvent({
      eventType: type,
      eventId,
      entity,
      payment,
      now,
    });
    if (applied.outcome === "applied" && applied.subscriptionId && applied.status) {
      return {
        kind: "subscription_applied",
        subscriptionId: applied.subscriptionId,
        status: applied.status,
        entitlementState: applied.entitlementState ?? "active",
      };
    }
    return { kind: "ignored", reason: applied.outcome };
  }

  if (type === "refund.created") {
    const refund = eventPayloadEntity(event, "refund");
    return { kind: "refund_recorded", refundId: stringValue(refund?.["id"]) };
  }

  if (type === "refund.processed") {
    const refund = eventPayloadEntity(event, "refund");
    const refundId = stringValue(refund?.["id"]);
    const paymentId = stringValue(refund?.["payment_id"]);
    const amount = numberValue(refund?.["amount"]);
    const reversed = await reverseRazorpayPurchase({
      paymentId,
      refundId,
      eventId,
      refundAmountMinor: amount,
    });
    if (reversed.outcome === "reversed") {
      return {
        kind: "refund_reversed",
        purchaseId: reversed.purchaseId,
        credits: reversed.creditsReversed,
        partial: reversed.partial,
      };
    }
    if (reversed.outcome === "blocked") {
      return { kind: "refund_blocked", purchaseId: reversed.purchaseId };
    }
    if (reversed.outcome === "already_refunded") {
      return { kind: "refund_replay", purchaseId: reversed.purchaseId };
    }
    if (reversed.outcome === "not_found") {
      return { kind: "ignored", reason: "refund_unknown_payment" };
    }
  }

  if (type === "invoice.paid") {
    const invoice = eventPayloadEntity(event, "invoice");
    if (!invoice) return { kind: "ignored", reason: "missing_invoice_entity" };
    const applied = await applyRazorpayInvoicePaid({ eventId, entity: invoice, now });
    if (applied.outcome === "applied" && applied.invoiceId) {
      return { kind: "invoice_paid", invoiceId: applied.invoiceId };
    }
    return { kind: "ignored", reason: "invoice_unknown_subscription" };
  }

  return { kind: "ignored", reason: "unhandled_event_type_" + type };
}

// ── Public entrypoint ───────────────────────────────────────────────────────

export interface RazorpayWebhookResult {
  received: true;
  status: "processed" | "ignored" | "duplicate";
  action?: string;
  reason?: string;
  purchaseId?: string;
  credits?: number;
  subscriptionId?: string;
  entitlementState?: string;
  invoiceId?: string;
  priorStatus?: string;
}

export async function processRazorpayWebhookEvent(
  event: Record<string, unknown>,
  eventId: string,
  opts: { now?: Date } = {},
): Promise<RazorpayWebhookResult> {
  const now = opts.now ?? new Date();
  const type = stringValue(event["event"]) ?? "unknown";

  const claimed = await db
    .insert(razorpayWebhookEventsTable)
    .values({
      id: eventId,
      type,
      status: "processing",
      objectId: null,
      payload: event,
      receivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: razorpayWebhookEventsTable.id });

  if (claimed.length === 0) {
    const [existing] = await db
      .select()
      .from(razorpayWebhookEventsTable)
      .where(eq(razorpayWebhookEventsTable.id, eventId))
      .limit(1);
    if (!existing) {
      throw new Error("[razorpay] webhook event claim conflict without a visible row");
    }
    if (existing.status === "failed") {
      const reclaimed = await db
        .update(razorpayWebhookEventsTable)
        .set({ status: "processing", error: null })
        .where(
          and(
            eq(razorpayWebhookEventsTable.id, eventId),
            eq(razorpayWebhookEventsTable.status, "failed"),
          ),
        )
        .returning({ id: razorpayWebhookEventsTable.id });
      if (reclaimed.length === 0) {
        return { received: true, status: "duplicate", priorStatus: existing.status };
      }
    } else {
      return { received: true, status: "duplicate", priorStatus: existing.status };
    }
  }

  try {
    const action = await handleRazorpayEvent(event, eventId, now);
    const status: "processed" | "ignored" = action.kind === "ignored" ? "ignored" : "processed";
    await db
      .update(razorpayWebhookEventsTable)
      .set({ status, processedAt: new Date(), error: null })
      .where(eq(razorpayWebhookEventsTable.id, eventId));

    return {
      received: true,
      status,
      action: action.kind,
      ...(action.kind === "ignored" ? { reason: action.reason } : {}),
      ...(action.kind === "settled" ? { purchaseId: action.purchaseId, credits: action.credits } : {}),
      ...(action.kind === "activated" ? { purchaseId: action.purchaseId } : {}),
      ...(action.kind === "settle_replay" ? { purchaseId: action.purchaseId, reason: action.reason } : {}),
      ...(action.kind === "marked_failed" || action.kind === "payment_recorded"
        ? { purchaseId: action.purchaseId }
        : {}),
      ...(action.kind === "refund_reversed"
        ? { purchaseId: action.purchaseId, credits: action.credits, reason: action.partial ? "partial" : "full" }
        : {}),
      ...(action.kind === "refund_blocked" ? { purchaseId: action.purchaseId } : {}),
      ...(action.kind === "refund_replay" ? { purchaseId: action.purchaseId } : {}),
      ...(action.kind === "subscription_applied"
        ? {
            subscriptionId: action.subscriptionId,
            entitlementState: action.entitlementState,
          }
        : {}),
      ...(action.kind === "invoice_paid" ? { invoiceId: action.invoiceId } : {}),
    };
  } catch (err) {
    await db
      .update(razorpayWebhookEventsTable)
      .set({
        status: "failed",
        processedAt: new Date(),
        error: String(err instanceof Error ? err.message : err).slice(0, 500),
      })
      .where(eq(razorpayWebhookEventsTable.id, eventId));
    throw err;
  }
}
