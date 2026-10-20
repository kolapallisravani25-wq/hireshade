/**
 * Canonical billing plan mapping — ONE table shared by every gateway.
 *
 * The Stripe adapter sells the T-12 catalog (see lib/stripe.ts STRIPE_CATALOG);
 * this module maps the same canonical plan codes to Razorpay plan ids and to the
 * entitlement each plan grants. Because the entitlement lives here and not in a
 * gateway adapter, a Razorpay subscription and the equivalent Stripe
 * subscription grant IDENTICAL entitlements by construction.
 *
 * One-time credit packs map to Razorpay Orders (paise). Subscription plans map
 * to Razorpay Subscriptions backed by a dashboard plan id supplied through
 * RAZORPAY_PLAN_<CODE> env vars (plans are created in the Razorpay dashboard and
 * cannot be created by the checkout call). The mapping is validated against the
 * Stripe catalog by tests/razorpay.unit.test.ts.
 *
 * Entitlement state machine (mandates):
 *   halted/paused -> entitlementState "paused" (row retained, history intact)
 *   resumed       -> "active"
 *   cancelled     -> "cancelled"
 *   completed     -> "completed"
 * Terminal states are never overwritten by stale/out-of-order webhook retries.
 */

export type BillingPlanKind = "credits" | "subscription" | "plan";
export type BillingInterval = "week" | "month" | "year";
export type SupportedCurrency = "USD" | "INR";

export interface BillingPlan {
  /** Canonical code; equals the Stripe product code and the Razorpay plan code. */
  code: string;
  name: string;
  kind: BillingPlanKind;
  /** Whole credits granted on settlement (0 for subscription/plan products). */
  credits: number;
  interval?: BillingInterval;
  amountMinor: Record<SupportedCurrency, number>;
  /** Stable entitlement flags shared by both gateways. */
  features: string[];
  /** Env var holding the Razorpay dashboard plan id (subscription plans only). */
  razorpayPlanEnvKey?: string;
}

export const PREMIUM_FEATURES = [
  "premium_sessions",
  "all_models",
  "priority_support",
] as const;

export const BILLING_PLANS: readonly BillingPlan[] = [
  { code: "credit_1", name: "1 Credit", kind: "credits", credits: 1, amountMinor: { USD: 2500, INR: 236000 }, features: ["credit_pack"] },
  { code: "credit_3", name: "3 Credits", kind: "credits", credits: 3, amountMinor: { USD: 3900, INR: 369000 }, features: ["credit_pack"] },
  { code: "credit_6", name: "6 Credits", kind: "credits", credits: 6, amountMinor: { USD: 7800, INR: 738000 }, features: ["credit_pack"] },
  { code: "credit_9", name: "9 Credits", kind: "credits", credits: 9, amountMinor: { USD: 11700, INR: 1107000 }, features: ["credit_pack"] },
  { code: "subscription_weekly", name: "Weekly subscription", kind: "subscription", credits: 0, interval: "week", amountMinor: { USD: 5200, INR: 498000 }, features: [...PREMIUM_FEATURES], razorpayPlanEnvKey: "RAZORPAY_PLAN_SUBSCRIPTION_WEEKLY" },
  { code: "subscription_monthly", name: "Monthly subscription", kind: "subscription", credits: 0, interval: "month", amountMinor: { USD: 9990, INR: 947000 }, features: [...PREMIUM_FEATURES], razorpayPlanEnvKey: "RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY" },
  { code: "subscription_yearly", name: "Yearly subscription", kind: "subscription", credits: 0, interval: "year", amountMinor: { USD: 39990, INR: 3790000 }, features: [...PREMIUM_FEATURES], razorpayPlanEnvKey: "RAZORPAY_PLAN_SUBSCRIPTION_YEARLY" },
  { code: "prepaid_yearly", name: "Prepaid yearly", kind: "plan", credits: 0, amountMinor: { USD: 39990, INR: 3790000 }, features: [...PREMIUM_FEATURES, "prepaid"] },
  { code: "lifetime_plan", name: "Lifetime plan", kind: "plan", credits: 0, amountMinor: { USD: 59990, INR: 5685000 }, features: [...PREMIUM_FEATURES, "lifetime"] },
] as const;

/** Razorpay subscription total_count (cycles) for a one-year commitment. */
export const DEFAULT_SUBSCRIPTION_TOTAL_COUNT: Record<BillingInterval, number> = {
  week: 52,
  month: 12,
  year: 5,
};

export function resolveBillingPlan(planCode: unknown): BillingPlan | null {
  if (typeof planCode !== "string" || planCode.length === 0) return null;
  return BILLING_PLANS.find((plan) => plan.code === planCode) ?? null;
}

export function planEntitlements(planCode: string): {
  credits: number;
  features: string[];
  interval?: BillingInterval;
} {
  const plan = resolveBillingPlan(planCode);
  if (!plan) throw new Error("Unknown billing plan: " + planCode);
  return {
    credits: plan.credits,
    features: [...plan.features],
    ...(plan.interval === undefined ? {} : { interval: plan.interval }),
  };
}

/**
 * Resolve the Razorpay dashboard plan id for a subscription plan.
 * Missing config fails closed (routes -> 503) instead of inventing an id that
 * Razorpay checkout would reject. Mock mode (tests/keyless dev) returns a
 * deterministic placeholder.
 */
export function resolveRazorpayPlanId(
  plan: BillingPlan,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (plan.kind !== "subscription") return null;
  const envKey = plan.razorpayPlanEnvKey ?? "";
  const raw = envKey ? env[envKey] : undefined;
  const configured = typeof raw === "string" ? raw.trim() : "";
  if (configured.length > 0) return configured;
  // The mock placeholder exists only when the gateway itself is keyless
  // (mock mode). A keyed test/live deployment with a missing plan id must fail
  // closed instead of sending a fake plan id to Razorpay.
  const hasKeys = Boolean(env["RAZORPAY_KEY_ID"] && env["RAZORPAY_KEY_SECRET"]);
  const mockMode = !hasKeys && (env["NODE_ENV"] === "test" || env["RAZORPAY_MOCK"] === "1");
  return mockMode ? "plan_mock_" + plan.code : null;
}

// ── Subscription lifecycle state machine ────────────────────────────────────

export type SubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "paused"
  | "cancelled"
  | "completed";

export type EntitlementState = "active" | "paused" | "cancelled" | "completed";

export const TERMINAL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "cancelled",
  "completed",
];

const ALLOWED_NEXT: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  created: ["created", "authenticated", "active", "pending", "halted", "paused", "cancelled", "completed"],
  authenticated: ["authenticated", "active", "pending", "halted", "paused", "cancelled", "completed"],
  active: ["active", "pending", "halted", "paused", "cancelled", "completed"],
  pending: ["pending", "active", "halted", "paused", "cancelled", "completed"],
  // Authenticated/activated retries after a halt/pause are stale: a halted
  // mandate must not be resurrected by an out-of-order authenticated event.
  halted: ["halted", "active", "pending", "paused", "cancelled", "completed"],
  paused: ["paused", "active", "halted", "pending", "cancelled", "completed"],
  // Terminal states are immutable: only idempotent repeats are accepted.
  cancelled: ["cancelled"],
  completed: ["completed"],
};

export function canApplySubscriptionTransition(
  current: SubscriptionStatus,
  next: SubscriptionStatus,
): boolean {
  if (TERMINAL_SUBSCRIPTION_STATUSES.includes(current)) return current === next;
  return ALLOWED_NEXT[current].includes(next);
}

export function entitlementStateForStatus(status: SubscriptionStatus): EntitlementState {
  switch (status) {
    case "halted":
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      return "active";
  }
}

/** Map a Razorpay event type to the subscription status it implies. */
export function subscriptionStatusForEvent(eventType: string): SubscriptionStatus | null {
  switch (eventType) {
    case "subscription.authenticated":
      return "authenticated";
    case "subscription.activated":
      return "active";
    case "subscription.charged":
      return "active";
    case "subscription.pending":
      return "pending";
    case "subscription.halted":
      return "halted";
    case "subscription.paused":
      return "paused";
    case "subscription.resumed":
      return "active";
    case "subscription.cancelled":
      return "cancelled";
    case "subscription.completed":
      return "completed";
    default:
      return null;
  }
}

/**
 * Classify a credits_purchases row's issuing gateway. Legacy rows created by
 * routes/credits.ts have no metadata.provider; Razorpay order ids always start
 * with "order_" while Stripe uses cs_/pi_ ids, so there is no collision.
 */
export function classifyPurchaseGateway(purchase: {
  metadata: unknown;
  orderId: string | null;
}): "razorpay" | "stripe" | null {
  const metadata = purchase.metadata as Record<string, unknown> | null;
  const provider = metadata?.["provider"];
  if (provider === "razorpay" || provider === "stripe") return provider;
  if (typeof purchase.orderId === "string" && purchase.orderId.startsWith("order_")) {
    return "razorpay";
  }
  return null;
}

export type MandateMethod = "upi" | "card" | "emandate" | "unknown";

/** Normalise Razorpay's payment method hints into a mandate kind. */
export function normalizeMandateMethod(value: unknown): MandateMethod {
  if (typeof value !== "string") return "unknown";
  const method = value.toLowerCase();
  if (method.includes("upi")) return "upi";
  if (method.includes("emandate") || method.includes("e-mandate")) return "emandate";
  if (method.includes("card")) return "card";
  return "unknown";
}
