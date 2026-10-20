/**
 * Razorpay billing client — Orders, Customers, Subscriptions (mandates) and
 * Refunds, plus the TWO DISTINCT signature verifications and gateway config.
 *
 * SDK-free: global fetch + node:crypto, matching the Stripe adapter's approach.
 *
 * Signature separation (the #1 Razorpay billing footgun):
 *  - Checkout callback: HMAC-SHA256(key_secret, "<order_id>|<payment_id>")
 *    compared against checkout's signature / razorpay_signature field.
 *  - Webhook: HMAC-SHA256(webhook_secret, RAW request body) compared against
 *    the X-Razorpay-Signature header. The webhook secret is a DIFFERENT secret,
 *    configured on the Razorpay dashboard — it is never the API key secret.
 * Both comparisons are constant-time. Test and live webhook secrets are
 * selected separately (RAZORPAY_WEBHOOK_SECRET_TEST / _LIVE), falling back to
 * RAZORPAY_WEBHOOK_SECRET for single-environment setups.
 *
 * Modes (selected from env only, never from a request field):
 *  - "live"/"test": RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET present. Real REST.
 *  - "mock": NODE_ENV=test (or RAZORPAY_MOCK=1 outside production) and no keys.
 *    Deterministic ids, zero network. Used by unit + DB integration tests.
 *  - "unconfigured": production without keys (routes fail closed with 503).
 *    Mock mode is unreachable when NODE_ENV=production.
 */

import crypto from "node:crypto";

// ── Errors ────────────────────────────────────────────────────────────────────

export class RazorpayNotConfiguredError extends Error {
  constructor(message = "Razorpay is not configured") {
    super(message);
    this.name = "RazorpayNotConfiguredError";
  }
}

export class RazorpayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RazorpayValidationError";
  }
}

export class RazorpayApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RazorpayApiError";
    this.status = status;
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

export type RazorpayMode = "live" | "test" | "mock" | "unconfigured";

export const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
/**
 * Fixed verification secret used ONLY in mock mode (NODE_ENV=test / keyless
 * dev). It exists so the checkout-verify code path can be exercised end-to-end
 * offline; mock mode is unreachable when NODE_ENV=production.
 */
export const RAZORPAY_MOCK_KEY_SECRET = "mock_razorpay_key_secret_not_for_production";
/** Mandate pre-debit notification must go out this long before a charge. */
export const MANDATE_PRE_DEBIT_WINDOW_HOURS = 24;

export interface RazorpayConfig {
  mode: RazorpayMode;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  /** Which env var supplied the webhook secret (for docs/ops diagnostics). */
  webhookSecretSource: string | null;
  apiBase: string;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveRazorpayMode(env: NodeJS.ProcessEnv = process.env): RazorpayMode {
  const keyId = envValue(env, "RAZORPAY_KEY_ID");
  const keySecret = envValue(env, "RAZORPAY_KEY_SECRET");
  if (keyId && keySecret) {
    if (keyId.startsWith("rzp_live_")) return "live";
    if (keyId.startsWith("rzp_test_")) return "test";
    return env["RAZORPAY_MODE"] === "live" ? "live" : "test";
  }
  if (env["NODE_ENV"] === "production") return "unconfigured";
  const explicitMock = env["RAZORPAY_MOCK"] === "1" || env["RAZORPAY_MOCK"] === "true";
  if (env["NODE_ENV"] === "test" || explicitMock) return "mock";
  return "unconfigured";
}

/**
 * Test/live webhook secrets are distinct. In live mode prefer
 * RAZORPAY_WEBHOOK_SECRET_LIVE; in test/mock prefer RAZORPAY_WEBHOOK_SECRET_TEST;
 * both fall back to RAZORPAY_WEBHOOK_SECRET.
 */
export function selectRazorpayWebhookSecret(
  env: NodeJS.ProcessEnv,
  mode: RazorpayMode,
): { secret: string | null; source: string | null } {
  const candidates =
    mode === "live"
      ? ["RAZORPAY_WEBHOOK_SECRET_LIVE", "RAZORPAY_WEBHOOK_SECRET"]
      : ["RAZORPAY_WEBHOOK_SECRET_TEST", "RAZORPAY_WEBHOOK_SECRET"];
  for (const name of candidates) {
    const value = envValue(env, name);
    if (value) return { secret: value, source: name };
  }
  return { secret: null, source: null };
}

export function readRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig {
  const mode = resolveRazorpayMode(env);
  const webhook = selectRazorpayWebhookSecret(env, mode);
  return {
    mode,
    keyId: envValue(env, "RAZORPAY_KEY_ID"),
    keySecret: envValue(env, "RAZORPAY_KEY_SECRET"),
    webhookSecret: webhook.secret,
    webhookSecretSource: webhook.source,
    apiBase: envValue(env, "RAZORPAY_API_BASE") ?? RAZORPAY_API_BASE,
  };
}

/** Public key id (safe to hand to Razorpay Checkout JS). Secret never leaves. */
export function getRazorpayKeyId(): string | undefined {
  return envValue(process.env, "RAZORPAY_KEY_ID") ?? undefined;
}

// ── Amount validation (paise, integer) ───────────────────────────────────────

/** Razorpay amounts are integer minor units (paise for INR). */
export function assertRazorpayAmount(amountMinor: number, currency: string): void {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new RazorpayValidationError(
      "amount must be a positive integer in minor units (paise), got " + String(amountMinor),
    );
  }
  if (amountMinor > 99_999_999_99) {
    throw new RazorpayValidationError("amount exceeds Razorpay maximum");
  }
  if (typeof currency !== "string" || currency.length !== 3) {
    throw new RazorpayValidationError("currency must be a 3-letter code");
  }
}

// ── Signature verification (two DISTINCT schemes) ───────────────────────────

export type RazorpaySignatureFailure =
  | "missing_signature"
  | "missing_secret"
  | "signature_mismatch";

export type RazorpaySignatureVerification =
  | { ok: true }
  | { ok: false; reason: RazorpaySignatureFailure };

const HEX_PATTERN = /^[0-9a-f]+$/i;

function timingSafeHexEqual(expectedHex: string, actualHex: string): boolean {
  if (!HEX_PATTERN.test(actualHex) || actualHex.length !== expectedHex.length) return false;
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(actualHex.toLowerCase(), "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Checkout callback: HMAC-SHA256(key_secret, orderId + "|" + paymentId). */
export function computeRazorpayCheckoutSignature(
  orderId: string,
  paymentId: string,
  keySecret: string,
): string {
  return crypto
    .createHmac("sha256", keySecret)
    .update(orderId + "|" + paymentId)
    .digest("hex");
}

export function verifyRazorpayCheckoutSignature(opts: {
  orderId: string;
  paymentId: string;
  signature: string | null | undefined;
  keySecret: string | null | undefined;
}): RazorpaySignatureVerification {
  if (!opts.keySecret) return { ok: false, reason: "missing_secret" };
  if (typeof opts.signature !== "string" || opts.signature.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }
  const expected = computeRazorpayCheckoutSignature(opts.orderId, opts.paymentId, opts.keySecret);
  return timingSafeHexEqual(expected, opts.signature)
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

/** Webhook: HMAC-SHA256(webhook_secret, RAW request body bytes). */
export function computeRazorpayWebhookSignature(
  rawBody: Buffer | string,
  webhookSecret: string,
): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
}

export function verifyRazorpayWebhookSignature(opts: {
  rawBody: Buffer | string;
  signatureHeader: string | null | undefined;
  webhookSecret: string | null | undefined;
}): RazorpaySignatureVerification {
  if (!opts.webhookSecret) return { ok: false, reason: "missing_secret" };
  const signature =
    typeof opts.signatureHeader === "string" ? opts.signatureHeader.trim() : "";
  if (signature.length === 0) return { ok: false, reason: "missing_signature" };
  const expected = computeRazorpayWebhookSignature(opts.rawBody, opts.webhookSecret);
  return timingSafeHexEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

// ── Pre-debit notification window (mandates) ────────────────────────────────

/**
 * Razorpay mandates (UPI Autopay / card e-mandate) require the merchant to
 * notify the customer before each debit. Returns the instant the notification
 * is due: chargeAt - windowHours (never in the past relative to now, clamped to
 * now so an overdue notification is still visible rather than silently lost).
 */
export function computePreDebitNotificationAt(opts: {
  chargeAt: Date;
  windowHours?: number;
  now?: Date;
}): Date {
  const windowHours = opts.windowHours ?? MANDATE_PRE_DEBIT_WINDOW_HOURS;
  const now = opts.now ?? new Date();
  const due = new Date(opts.chargeAt.getTime() - windowHours * 3_600_000);
  return due.getTime() < now.getTime() ? now : due;
}

// ── Deterministic mock ids ──────────────────────────────────────────────────

function mockId(prefix: string, parts: Array<string | number | null | undefined>): string {
  const digest = crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 24);
  return prefix + digest;
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

async function razorpayRequest<T>(opts: {
  config: RazorpayConfig;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const { config } = opts;
  if (config.mode === "unconfigured" || !config.keyId || !config.keySecret) {
    throw new RazorpayNotConfiguredError();
  }
  const auth = Buffer.from(config.keyId + ":" + config.keySecret).toString("base64");
  const response = await (opts.fetchImpl ?? fetch)(config.apiBase + opts.path, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + auth,
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new RazorpayApiError(
      response.status,
      "Razorpay " + opts.path + " failed (" + response.status + "): " + text.slice(0, 300),
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RazorpayApiError(response.status, "Razorpay returned non-JSON for " + opts.path);
  }
}

// ── Orders ──────────────────────────────────────────────────────────────────

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export async function createRazorpayOrder(opts: {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<RazorpayOrder> {
  assertRazorpayAmount(opts.amountMinor, opts.currency);
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    return {
      id: mockId("order_mock_", [opts.amountMinor, opts.currency, opts.receipt, JSON.stringify(opts.notes ?? {})]),
      amount: opts.amountMinor,
      currency: opts.currency,
      status: "created",
      receipt: opts.receipt.slice(0, 40),
    };
  }
  return razorpayRequest<RazorpayOrder>({
    config,
    path: "/orders",
    method: "POST",
    body: {
      amount: opts.amountMinor,
      currency: opts.currency,
      receipt: opts.receipt.slice(0, 40),
      payment_capture: 1,
      notes: opts.notes ?? {},
    },
    fetchImpl: opts.fetchImpl,
  });
}

// ── Customers (subscriptions need a stable customer id) ─────────────────────

export interface RazorpayCustomer {
  id: string;
  email?: string;
  name?: string;
}

export async function findOrCreateRazorpayCustomer(opts: {
  email: string;
  name?: string;
  contact?: string;
  notes?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<RazorpayCustomer> {
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    return { id: mockId("cust_mock_", [opts.email]), email: opts.email, name: opts.name };
  }
  const existing = await razorpayRequest<{ items?: RazorpayCustomer[] }>({
    config,
    path: "/customers?email=" + encodeURIComponent(opts.email),
    method: "GET",
    fetchImpl: opts.fetchImpl,
  });
  if (existing.items && existing.items.length > 0) return existing.items[0]!;
  return razorpayRequest<RazorpayCustomer>({
    config,
    path: "/customers",
    method: "POST",
    body: {
      email: opts.email,
      name: opts.name,
      contact: opts.contact,
      notes: opts.notes ?? {},
      fail_existing: 0,
    },
    fetchImpl: opts.fetchImpl,
  });
}

// ── Subscriptions (recurring mandates: UPI Autopay / card e-mandate) ────────

export interface RazorpaySubscription {
  id: string;
  plan_id?: string;
  customer_id?: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  charge_at?: number | null;
  paid_count?: number;
  total_count?: number;
  short_url?: string;
  payment_method?: string;
  notes?: Record<string, string>;
}

export async function createRazorpaySubscription(opts: {
  planId: string;
  customerId: string;
  totalCount: number;
  quantity?: number;
  startAt?: number;
  expireBy?: number;
  notes?: Record<string, string>;
  notifyInfo?: { notify_email?: string; notify_phone?: string };
  fetchImpl?: typeof fetch;
}): Promise<RazorpaySubscription> {
  if (!opts.planId || !opts.customerId) {
    throw new RazorpayValidationError("planId and customerId are required");
  }
  if (!Number.isInteger(opts.totalCount) || opts.totalCount <= 0) {
    throw new RazorpayValidationError("totalCount must be a positive integer cycle count");
  }
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: mockId("sub_mock_", [opts.planId, opts.customerId, opts.totalCount, JSON.stringify(opts.notes ?? {})]),
      plan_id: opts.planId,
      customer_id: opts.customerId,
      status: "created",
      current_start: now,
      current_end: now + 30 * 86_400,
      charge_at: now + 30 * 86_400,
      paid_count: 0,
      total_count: opts.totalCount,
      short_url: "https://rzp.io/i/mock",
      notes: opts.notes,
    };
  }
  return razorpayRequest<RazorpaySubscription>({
    config,
    path: "/subscriptions",
    method: "POST",
    body: {
      plan_id: opts.planId,
      customer_id: opts.customerId,
      total_count: opts.totalCount,
      quantity: opts.quantity ?? 1,
      ...(opts.startAt === undefined ? {} : { start_at: opts.startAt }),
      ...(opts.expireBy === undefined ? {} : { expire_by: opts.expireBy }),
      ...(opts.notifyInfo === undefined ? {} : { notify_info: opts.notifyInfo }),
      notes: opts.notes ?? {},
    },
    fetchImpl: opts.fetchImpl,
  });
}

export async function cancelRazorpaySubscription(opts: {
  subscriptionId: string;
  cancelAtCycleEnd?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<RazorpaySubscription> {
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: opts.subscriptionId,
      status: "cancelled",
      current_end: now,
      paid_count: 0,
    };
  }
  return razorpayRequest<RazorpaySubscription>({
    config,
    path: "/subscriptions/" + encodeURIComponent(opts.subscriptionId) + "/cancel",
    method: "POST",
    body: { cancel_at_cycle_end: opts.cancelAtCycleEnd === false ? 0 : 1 },
    fetchImpl: opts.fetchImpl,
  });
}

export async function pauseRazorpaySubscription(opts: {
  subscriptionId: string;
  pauseAtCycleEnd?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<RazorpaySubscription> {
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    return { id: opts.subscriptionId, status: "paused", paid_count: 0 };
  }
  return razorpayRequest<RazorpaySubscription>({
    config,
    path: "/subscriptions/" + encodeURIComponent(opts.subscriptionId) + "/pause",
    method: "POST",
    body: { pause_at_cycle_end: opts.pauseAtCycleEnd === false ? 0 : 1 },
    fetchImpl: opts.fetchImpl,
  });
}

export async function resumeRazorpaySubscription(opts: {
  subscriptionId: string;
  resumeAtCycleEnd?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<RazorpaySubscription> {
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    return { id: opts.subscriptionId, status: "active", paid_count: 0 };
  }
  return razorpayRequest<RazorpaySubscription>({
    config,
    path: "/subscriptions/" + encodeURIComponent(opts.subscriptionId) + "/resume",
    method: "POST",
    body: { resume_at_cycle_end: opts.resumeAtCycleEnd === false ? 0 : 1 },
    fetchImpl: opts.fetchImpl,
  });
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  speed_processed?: string;
  notes?: Record<string, string>;
}

export async function createRazorpayRefund(opts: {
  paymentId: string;
  amountMinor?: number;
  speed?: "normal" | "optimum";
  notes?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<RazorpayRefund> {
  if (opts.amountMinor !== undefined) {
    assertRazorpayAmount(opts.amountMinor, "INR");
  }
  const config = readRazorpayConfig();
  if (config.mode === "unconfigured") throw new RazorpayNotConfiguredError();
  if (config.mode === "mock") {
    return {
      id: mockId("rfnd_mock_", [opts.paymentId, opts.amountMinor ?? "full", opts.speed ?? "normal"]),
      payment_id: opts.paymentId,
      amount: opts.amountMinor ?? 0,
      currency: "INR",
      status: "processed",
      speed_processed: "normal",
      notes: opts.notes,
    };
  }
  return razorpayRequest<RazorpayRefund>({
    config,
    path: "/payments/" + encodeURIComponent(opts.paymentId) + "/refund",
    method: "POST",
    body: {
      ...(opts.amountMinor === undefined ? {} : { amount: opts.amountMinor }),
      speed: opts.speed ?? "normal",
      notes: opts.notes ?? {},
    },
    fetchImpl: opts.fetchImpl,
  });
}
