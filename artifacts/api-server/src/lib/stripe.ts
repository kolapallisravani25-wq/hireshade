/**
 * Stripe billing adapter — first-class provider alongside Razorpay.
 *
 * Deliberately SDK-free. Stripe's REST API is form-encoded, and webhook
 * authenticity is HMAC-SHA256 over (timestamp + "." + raw body) — both are
 * trivially implementable with global fetch and node:crypto. Avoiding the SDK
 * keeps the dependency surface flat (matching the Razorpay adapter) and makes
 * the whole client unit-testable without network egress.
 *
 * Modes (selected by readStripeConfig, NEVER by a request field):
 *   - "live":         STRIPE_SECRET_KEY is set. Real checkout sessions are
 *                     created by calling api.stripe.com.
 *   - "mock":         NODE_ENV=test (or STRIPE_MOCK=1 outside production) with
 *                     no secret key. Deterministic, offline adapter used by
 *                     unit/integration tests.
 *   - "unconfigured": production without keys, or a non-test environment with
 *                     no keys. Routes fail closed with 503. Mock mode is
 *                     unreachable when NODE_ENV=production.
 *
 * Server-side amount authority: the caller passes a product CODE and currency;
 * this module resolves the price from the T-12 catalog below. A client-supplied
 * amount is never read. When STRIPE_PRICE_* env overrides are configured, the
 * price id is used and the session's returned amount_total is still compared
 * against the catalog — a misconfigured Stripe price fails the request instead
 * of silently selling at the wrong price.
 *
 * Pricing evidence: docs/TARGET_VERIFIED.md T-12 and the live capture
 * docs/raw/probes/trpc-billing.getPrices.json (USD + INR, EUR null). USD cents
 * are mirrored verbatim by STRIPE_CATALOG; tests/stripe.unit.test.ts parses the
 * capture and fails on drift.
 */

import crypto from "node:crypto";

// ── Errors ────────────────────────────────────────────────────────────────────

/** No usable Stripe configuration for this environment (routes -> 503). */
export class StripeNotConfiguredError extends Error {
  constructor(message = "Stripe is not configured") {
    super(message);
    this.name = "StripeNotConfiguredError";
  }
}

/** Stripe returned a session whose amount/currency disagrees with our catalog. */
export class StripeAmountMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeAmountMismatchError";
  }
}

/** Non-2xx response from the Stripe REST API. */
export class StripeApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StripeApiError";
    this.status = status;
  }
}

/** Malformed / missing fields in a webhook event payload. */
export class StripeEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeEventValidationError";
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

export type StripeMode = "live" | "mock" | "unconfigured";

export const STRIPE_API_VERSION_DEFAULT = "2026-09-30.endive";
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
export const STRIPE_CHECKOUT_SUCCESS_URL_DEFAULT = "https://hireshade.app/billing/success";
export const STRIPE_CHECKOUT_CANCEL_URL_DEFAULT = "https://hireshade.app/billing/cancel";

export interface StripeConfig {
  mode: StripeMode;
  secretKey: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
  /** productCode -> Stripe Price id (STRIPE_PRICE_<PRODUCT_CODE> env vars). */
  priceIds: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  apiVersion: string;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Collect STRIPE_PRICE_<PRODUCT_CODE> overrides.
 * Example: STRIPE_PRICE_CREDIT_6=price_123 -> { credit_6: "price_123" }.
 * Product codes are lower-cased because T-12 codes are snake_case lowercase.
 */
export function collectStripePriceIds(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const priceIds: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^STRIPE_PRICE_(.+)$/.exec(key);
    if (!match) continue;
    const priceId = typeof value === "string" ? value.trim() : "";
    if (!priceId) continue;
    priceIds[match[1]!.toLowerCase()] = priceId;
  }
  return priceIds;
}

/**
 * Resolve Stripe mode from the environment.
 *
 * Fail-closed rules:
 *  - NODE_ENV=production NEVER resolves to "mock", even if STRIPE_MOCK=1.
 *  - A missing secret key outside test/explicit-mock is "unconfigured".
 */
export function resolveStripeMode(env: NodeJS.ProcessEnv = process.env): StripeMode {
  const hasSecretKey = envValue(env, "STRIPE_SECRET_KEY") !== null;
  if (hasSecretKey) return "live";
  if (env["NODE_ENV"] === "production") return "unconfigured";
  const explicitMock = env["STRIPE_MOCK"] === "1" || env["STRIPE_MOCK"] === "true";
  if (env["NODE_ENV"] === "test" || explicitMock) return "mock";
  return "unconfigured";
}

export function readStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  return {
    mode: resolveStripeMode(env),
    secretKey: envValue(env, "STRIPE_SECRET_KEY"),
    webhookSecret: envValue(env, "STRIPE_WEBHOOK_SECRET"),
    publishableKey: envValue(env, "STRIPE_PUBLISHABLE_KEY"),
    priceIds: collectStripePriceIds(env),
    successUrl: envValue(env, "STRIPE_CHECKOUT_SUCCESS_URL") ?? STRIPE_CHECKOUT_SUCCESS_URL_DEFAULT,
    cancelUrl: envValue(env, "STRIPE_CHECKOUT_CANCEL_URL") ?? STRIPE_CHECKOUT_CANCEL_URL_DEFAULT,
    apiVersion: envValue(env, "STRIPE_API_VERSION") ?? STRIPE_API_VERSION_DEFAULT,
  };
}

// ── T-12 catalog (server-side amount authority) ──────────────────────────────
// Source of truth for Stripe prices. Mirrors the OBSERVED pricing in
// docs/TARGET_VERIFIED.md T-12 / docs/raw/probes/trpc-billing.getPrices.json.
// EUR is null in the capture, so it is not offered. One-time credit packs grant
// whole credits into the SAME credits_balance / credit ledger that
// lib/sessionCredits.ts meters (no unit redefinition); subscriptions and plan
// products are entitlements with zero credit movement.
//
// Credit unit note (cross-cutting): T-12 meters 0.5 credit per 30 minutes
// (1 credit = 60 min), while this repo's sessionCredits.ts still defaults to
// 0.5 credit per MINUTE. Aligning metering is a separate, session-metering
// change (out of this task's scope) — Stripe only grants whole credits, so it
// stays compatible either way.

export type SupportedCurrency = "USD" | "INR";
export const STRIPE_CURRENCIES: readonly SupportedCurrency[] = ["USD", "INR"];

export type StripeProductKind = "credits" | "subscription" | "plan";
export type StripeRecurringInterval = "week" | "month" | "year";

export interface StripeProduct {
  code: string;
  name: string;
  kind: StripeProductKind;
  /** Whole credits granted on settlement; 0 for subscription/plan products. */
  credits: number;
  /** Set only for kind === "subscription". */
  interval?: StripeRecurringInterval;
  amountMinor: Record<SupportedCurrency, number>;
}

export const STRIPE_CATALOG: readonly StripeProduct[] = [
  // One-time credit packs — T-12: credit_1 $25 / credit_3 $39 / credit_6 $78 / credit_9 $117.
  { code: "credit_1", name: "1 Credit", kind: "credits", credits: 1, amountMinor: { USD: 2500, INR: 236000 } },
  { code: "credit_3", name: "3 Credits", kind: "credits", credits: 3, amountMinor: { USD: 3900, INR: 369000 } },
  { code: "credit_6", name: "6 Credits", kind: "credits", credits: 6, amountMinor: { USD: 7800, INR: 738000 } },
  { code: "credit_9", name: "9 Credits", kind: "credits", credits: 9, amountMinor: { USD: 11700, INR: 1107000 } },
  // Recurring subscription tiers — T-12: weekly $52 / monthly $99.90 / yearly $399.90.
  { code: "subscription_weekly", name: "Weekly subscription", kind: "subscription", credits: 0, interval: "week", amountMinor: { USD: 5200, INR: 498000 } },
  { code: "subscription_monthly", name: "Monthly subscription", kind: "subscription", credits: 0, interval: "month", amountMinor: { USD: 9990, INR: 947000 } },
  { code: "subscription_yearly", name: "Yearly subscription", kind: "subscription", credits: 0, interval: "year", amountMinor: { USD: 39990, INR: 3790000 } },
  // One-time plan entitlements — T-12: prepaid_yearly $399.90 / lifetime $599.90.
  { code: "prepaid_yearly", name: "Prepaid yearly", kind: "plan", credits: 0, amountMinor: { USD: 39990, INR: 3790000 } },
  { code: "lifetime_plan", name: "Lifetime plan", kind: "plan", credits: 0, amountMinor: { USD: 59990, INR: 5685000 } },
] as const;

/** Unknown/unsupported currencies fall back to USD (T-12 headline currency). */
export function normalizeCurrency(currency: unknown): SupportedCurrency {
  return currency === "INR" ? "INR" : "USD";
}

export interface ResolvedStripeProduct {
  product: StripeProduct;
  currency: SupportedCurrency;
  amountMinor: number;
}

export function resolveStripeProduct(
  productCode: unknown,
  currency: unknown,
): ResolvedStripeProduct | null {
  if (typeof productCode !== "string" || productCode.length === 0) return null;
  const product = STRIPE_CATALOG.find((candidate) => candidate.code === productCode);
  if (!product) return null;
  const normalized = normalizeCurrency(currency);
  return { product, currency: normalized, amountMinor: product.amountMinor[normalized] };
}

// ── Checkout line items ───────────────────────────────────────────────────────

export type StripeLineItem =
  | { price: string; quantity: 1 }
  | {
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string };
        recurring?: { interval: StripeRecurringInterval };
      };
      quantity: 1;
    };

/**
 * One line item per product. When a STRIPE_PRICE_<PRODUCT> id is configured it
 * is used (Dashboard-managed pricing); otherwise inline price_data is built
 * from the T-12 catalog. Currency is always lower-cased per Stripe's contract.
 * Subscription products emit price_data.recurring.interval (Stripe rejects
 * subscription-mode sessions without it on inline prices).
 */
export function buildCheckoutLineItems(
  resolved: ResolvedStripeProduct,
  priceIds: Record<string, string> = {},
): StripeLineItem[] {
  const priceId = priceIds[resolved.product.code];
  if (priceId) {
    return [{ price: priceId, quantity: 1 }];
  }
  const priceData: {
    currency: string;
    unit_amount: number;
    product_data: { name: string };
    recurring?: { interval: StripeRecurringInterval };
  } = {
    currency: resolved.currency.toLowerCase(),
    unit_amount: resolved.amountMinor,
    product_data: {
      name: "HireShade " + resolved.product.name,
    },
  };
  if (resolved.product.kind === "subscription" && resolved.product.interval) {
    priceData.recurring = { interval: resolved.product.interval };
  }
  return [{ price_data: priceData, quantity: 1 }];
}

// ── Webhook signature verification (raw body, HMAC-SHA256, timestamp) ────────

export type StripeSignatureFailure =
  | "missing_header"
  | "malformed_header"
  | "no_v1_signature"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch";

export type StripeSignatureVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: StripeSignatureFailure };

/**
 * HMAC-SHA256 over (timestamp + "." + rawBody) keyed by the endpoint secret —
 * exactly what Stripe computes for the v1 signature scheme.
 */
export function computeStripeSignature(
  rawBody: Buffer | string,
  secret: string,
  timestamp: number | string,
): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return crypto
    .createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(body)
    .digest("hex");
}

/**
 * Verify a Stripe-Signature header against the RAW request bytes.
 *
 * Header shape: "t=<unix seconds>,v1=<hex>[,v1=<hex>...]". Multiple v1
 * signatures are accepted (Stripe supports secret rotation). Verification is
 * constant-time per candidate. Timestamps older/newer than the tolerance
 * (default 300s, Stripe's own default) are rejected to block replay.
 */
export function verifyStripeSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined | null;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): StripeSignatureVerification {
  const header = opts.signatureHeader;
  if (typeof header !== "string" || header.trim().length === 0) {
    return { ok: false, reason: "missing_header" };
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const segment of header.split(",")) {
    const part = segment.trim();
    if (part.length === 0) continue;
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, reason: "malformed_header" };
      }
      timestamp = parsed;
    } else if (key === "v1") {
      if (value.length > 0) signatures.push(value);
    }
  }

  if (timestamp === null) return { ok: false, reason: "malformed_header" };
  if (signatures.length === 0) return { ok: false, reason: "no_v1_signature" };

  const tolerance = opts.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: "timestamp_out_of_tolerance" };
  }

  const expected = Buffer.from(
    computeStripeSignature(opts.rawBody, opts.secret, timestamp),
    "utf8",
  );
  const matched = signatures.some((candidate) => {
    const actual = Buffer.from(candidate, "utf8");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });

  return matched ? { ok: true, timestamp } : { ok: false, reason: "signature_mismatch" };
}

/** Format a valid Stripe-Signature header (used by tests and mock tooling). */
export function buildStripeSignatureHeader(
  rawBody: Buffer | string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  return "t=" + timestamp + ",v1=" + computeStripeSignature(rawBody, secret, timestamp);
}

// ── Webhook event parsing ────────────────────────────────────────────────────

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  [key: string]: unknown;
}

export function parseStripeEvent(rawBody: Buffer | string): StripeWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
  } catch {
    throw new StripeEventValidationError("Webhook body is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new StripeEventValidationError("Webhook body is not an object");
  }
  const event = parsed as Record<string, unknown>;
  if (typeof event["id"] !== "string" || event["id"].length === 0) {
    throw new StripeEventValidationError("Webhook event is missing id");
  }
  if (typeof event["type"] !== "string" || event["type"].length === 0) {
    throw new StripeEventValidationError("Webhook event is missing type");
  }
  const data = event["data"];
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>)["object"] !== "object"
  ) {
    throw new StripeEventValidationError("Webhook event is missing data.object");
  }
  return parsed as StripeWebhookEvent;
}

// ── Checkout session adapter ─────────────────────────────────────────────────

export interface StripeCheckoutSessionResult {
  id: string;
  url: string;
  amountMinor: number;
  currency: SupportedCurrency;
  productCode: string;
  productKind: StripeProductKind;
  credits: number;
  paymentIntentId: string | null;
  mode: "live" | "mock";
}

export interface CreateStripeCheckoutSessionInput {
  userId: string;
  resolved: ResolvedStripeProduct;
  config: StripeConfig;
  /** Short, stable per-checkout key. Also sent as Stripe's Idempotency-Key. */
  idempotencyKey: string;
  /** Test seam: defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Deterministic, offline checkout session for tests (and STRIPE_MOCK=1 dev). */
export function createMockCheckoutSession(
  input: Pick<CreateStripeCheckoutSessionInput, "userId" | "resolved" | "idempotencyKey">,
): StripeCheckoutSessionResult {
  const digest = crypto
    .createHash("sha256")
    .update(
      [input.userId, input.resolved.product.code, input.resolved.currency, input.idempotencyKey].join("|"),
    )
    .digest("hex")
    .slice(0, 24);
  const id = "cs_test_mock_" + digest;
  const isSubscription = input.resolved.product.kind === "subscription";
  return {
    id,
    url: "https://checkout.stripe.mock/pay/" + id,
    amountMinor: input.resolved.amountMinor,
    currency: input.resolved.currency,
    productCode: input.resolved.product.code,
    productKind: input.resolved.product.kind,
    credits: input.resolved.product.credits,
    // Subscription sessions start a subscription, not a single PaymentIntent.
    paymentIntentId: isSubscription ? null : "pi_test_mock_" + digest,
    mode: "mock",
  };
}

/**
 * Create a real Stripe Checkout Session via the REST API.
 * No payment_method_types is sent, so Dashboard-enabled dynamic payment
 * methods apply (Stripe best practice).
 */
export async function createStripeCheckoutSession(
  input: CreateStripeCheckoutSessionInput,
): Promise<StripeCheckoutSessionResult> {
  const { config, resolved } = input;
  if (config.mode === "unconfigured") {
    throw new StripeNotConfiguredError();
  }
  // Mock first: mock mode is keyless by definition (NODE_ENV=test).
  if (config.mode === "mock") {
    return createMockCheckoutSession(input);
  }
  if (!config.secretKey) {
    throw new StripeNotConfiguredError();
  }

  const isSubscription = resolved.product.kind === "subscription";
  const lineItems = buildCheckoutLineItems(resolved, config.priceIds);

  const form = new URLSearchParams();
  form.set("mode", isSubscription ? "subscription" : "payment");
  form.set("success_url", config.successUrl);
  form.set("cancel_url", config.cancelUrl);
  form.set("client_reference_id", input.userId);
  form.set("metadata[userId]", input.userId);
  form.set("metadata[productCode]", resolved.product.code);
  form.set("metadata[productKind]", resolved.product.kind);
  form.set("metadata[credits]", String(resolved.product.credits));
  if (isSubscription) {
    // Tag the subscription too, so later lifecycle events
    // (invoice.paid / customer.subscription.*) can be tied to our user.
    form.set("subscription_data[metadata][userId]", input.userId);
    form.set("subscription_data[metadata][productCode]", resolved.product.code);
  }
  lineItems.forEach((item, index) => {
    form.set("line_items[" + index + "][quantity]", "1");
    if ("price" in item) {
      form.set("line_items[" + index + "][price]", item.price);
    } else {
      form.set("line_items[" + index + "][price_data][currency]", item.price_data.currency);
      form.set(
        "line_items[" + index + "][price_data][unit_amount]",
        String(item.price_data.unit_amount),
      );
      form.set(
        "line_items[" + index + "][price_data][product_data][name]",
        item.price_data.product_data.name,
      );
      if (item.price_data.recurring) {
        form.set(
          "line_items[" + index + "][price_data][recurring][interval]",
          item.price_data.recurring.interval,
        );
      }
    }
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.secretKey,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": config.apiVersion,
      "Idempotency-Key": input.idempotencyKey,
    },
    body: form.toString(),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new StripeApiError(
      response.status,
      "Stripe checkout session creation failed (" + response.status + "): " + bodyText.slice(0, 300),
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new StripeApiError(response.status, "Stripe returned a non-JSON checkout session response");
  }

  const id = parsed["id"];
  const url = parsed["url"];
  if (typeof id !== "string" || id.length === 0 || typeof url !== "string" || url.length === 0) {
    throw new StripeApiError(response.status, "Stripe returned a checkout session without id/url");
  }

  const amountTotal = parsed["amount_total"];
  if (typeof amountTotal === "number" && amountTotal !== resolved.amountMinor) {
    throw new StripeAmountMismatchError(
      "Stripe amount_total " +
        amountTotal +
        " != catalog " +
        resolved.amountMinor +
        " for " +
        resolved.product.code +
        "/" +
        resolved.currency,
    );
  }

  const returnedCurrency = parsed["currency"];
  if (
    typeof returnedCurrency === "string" &&
    returnedCurrency.toUpperCase() !== resolved.currency
  ) {
    throw new StripeAmountMismatchError(
      "Stripe currency " + returnedCurrency + " != requested " + resolved.currency,
    );
  }

  const paymentIntent = parsed["payment_intent"];

  return {
    id,
    url,
    amountMinor: typeof amountTotal === "number" ? amountTotal : resolved.amountMinor,
    currency: resolved.currency,
    productCode: resolved.product.code,
    productKind: resolved.product.kind,
    credits: resolved.product.credits,
    paymentIntentId: typeof paymentIntent === "string" ? paymentIntent : null,
    mode: "live",
  };
}
