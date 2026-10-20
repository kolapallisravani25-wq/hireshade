/**
 * Unit tests for Razorpay billing parity — no network, no database.
 *
 * Covers: gateway config + separate test/live webhook secrets; the TWO distinct
 * signature schemes (checkout key-secret HMAC vs raw-body webhook HMAC);
 * paise-integer amount validation; real REST request shapes via injected fetch
 * (orders/customers/subscriptions/refunds); deterministic mock ids; the shared
 * Stripe/Razorpay plan mapping and entitlement state machine; mandate pre-debit
 * window; and the single-source GST computation (GSTIN checksum, inclusive /
 * exclusive, intra-state CGST+SGST vs inter-state IGST).
 */
import { describe, it, expect } from "vitest";

import {
  MANDATE_PRE_DEBIT_WINDOW_HOURS,
  RAZORPAY_MOCK_KEY_SECRET,
  RazorpayApiError,
  RazorpayNotConfiguredError,
  RazorpayValidationError,
  assertRazorpayAmount,
  cancelRazorpaySubscription,
  computePreDebitNotificationAt,
  computeRazorpayCheckoutSignature,
  computeRazorpayWebhookSignature,
  createRazorpayOrder,
  createRazorpayRefund,
  createRazorpaySubscription,
  findOrCreateRazorpayCustomer,
  getRazorpayKeyId,
  pauseRazorpaySubscription,
  readRazorpayConfig,
  resolveRazorpayMode,
  resumeRazorpaySubscription,
  selectRazorpayWebhookSecret,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "../src/lib/razorpay.js";
import {
  BILLING_PLANS,
  DEFAULT_SUBSCRIPTION_TOTAL_COUNT,
  PREMIUM_FEATURES,
  canApplySubscriptionTransition,
  classifyPurchaseGateway,
  entitlementStateForStatus,
  normalizeMandateMethod,
  planEntitlements,
  resolveBillingPlan,
  resolveRazorpayPlanId,
  subscriptionStatusForEvent,
} from "../src/lib/razorpayPlans.js";
import {
  GST_SUPPLIER_STATE_DEFAULT,
  RazorpayGstError,
  assertValidGstin,
  computeGst,
  configuredGstInclusive,
  configuredGstRateBps,
  configuredSupplierStateCode,
  gstStateCodeFromGstin,
  isValidGstin,
} from "../src/lib/razorpayGst.js";
import { STRIPE_CATALOG } from "../src/lib/stripe.js";

// ── env helpers (unit tests mutate process.env around live/mock calls) ──────

const MANAGED_ENV = [
  "NODE_ENV",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_MODE",
  "RAZORPAY_MOCK",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_WEBHOOK_SECRET_TEST",
  "RAZORPAY_WEBHOOK_SECRET_LIVE",
  "RAZORPAY_GST_SUPPLIER_STATE",
  "RAZORPAY_GST_RATE_BPS",
  "RAZORPAY_GST_INCLUSIVE",
  "RAZORPAY_PLAN_SUBSCRIPTION_WEEKLY",
  "RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY",
  "RAZORPAY_PLAN_SUBSCRIPTION_YEARLY",
] as const;

async function withEnv(
  vars: Partial<Record<(typeof MANAGED_ENV)[number], string | undefined>>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

// ── Config + separate test/live webhook secrets ─────────────────────────────

describe("Razorpay config — modes and separate test/live webhook secrets", () => {
  it("is live/test from the key id prefix", () => {
    expect(
      resolveRazorpayMode(env({ RAZORPAY_KEY_ID: "rzp_live_x", RAZORPAY_KEY_SECRET: "s" })),
    ).toBe("live");
    expect(
      resolveRazorpayMode(env({ RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s" })),
    ).toBe("test");
  });

  it("honours RAZORPAY_MODE for non-standard key ids", () => {
    expect(
      resolveRazorpayMode(
        env({ RAZORPAY_KEY_ID: "customkey", RAZORPAY_KEY_SECRET: "s", RAZORPAY_MODE: "live" }),
      ),
    ).toBe("live");
    expect(
      resolveRazorpayMode(env({ RAZORPAY_KEY_ID: "customkey", RAZORPAY_KEY_SECRET: "s" })),
    ).toBe("test");
  });

  it("is mock only outside production", () => {
    expect(resolveRazorpayMode(env({ NODE_ENV: "test" }))).toBe("mock");
    expect(resolveRazorpayMode(env({ NODE_ENV: "development", RAZORPAY_MOCK: "1" }))).toBe("mock");
  });

  it("NEVER mocks in production, even with RAZORPAY_MOCK=1", () => {
    expect(resolveRazorpayMode(env({ NODE_ENV: "production", RAZORPAY_MOCK: "1" }))).toBe(
      "unconfigured",
    );
    expect(resolveRazorpayMode(env({ NODE_ENV: "production" }))).toBe("unconfigured");
  });

  it("is unconfigured in plain development without keys", () => {
    expect(resolveRazorpayMode(env({ NODE_ENV: "development" }))).toBe("unconfigured");
  });

  it("selects RAZORPAY_WEBHOOK_SECRET_TEST for test and _LIVE for live, with fallback", () => {
    expect(
      selectRazorpayWebhookSecret(
        env({ RAZORPAY_WEBHOOK_SECRET_TEST: "whsec_test", RAZORPAY_WEBHOOK_SECRET: "whsec_any" }),
        "test",
      ),
    ).toEqual({ secret: "whsec_test", source: "RAZORPAY_WEBHOOK_SECRET_TEST" });
    expect(
      selectRazorpayWebhookSecret(
        env({ RAZORPAY_WEBHOOK_SECRET_LIVE: "whsec_live", RAZORPAY_WEBHOOK_SECRET: "whsec_any" }),
        "live",
      ),
    ).toEqual({ secret: "whsec_live", source: "RAZORPAY_WEBHOOK_SECRET_LIVE" });
    expect(
      selectRazorpayWebhookSecret(
        env({ RAZORPAY_WEBHOOK_SECRET: "whsec_any" }),
        "live",
      ),
    ).toEqual({ secret: "whsec_any", source: "RAZORPAY_WEBHOOK_SECRET" });
    expect(selectRazorpayWebhookSecret(env({}), "test")).toEqual({ secret: null, source: null });
  });

  it("never exposes the key secret through the public key id helper", () => {
    const config = readRazorpayConfig(
      env({
        RAZORPAY_KEY_ID: "rzp_test_public",
        RAZORPAY_KEY_SECRET: "super_secret_value",
        RAZORPAY_WEBHOOK_SECRET_TEST: "whsec_x",
      }),
    );
    expect(config.keyId).toBe("rzp_test_public");
    expect(config.keySecret).toBe("super_secret_value");
    expect(JSON.stringify({ keyId: config.keyId })).not.toContain("super_secret_value");
    expect(RAZORPAY_MOCK_KEY_SECRET).not.toBe(config.keySecret);
  });

  it("exposes the public key id from env only", async () => {
    await withEnv({ RAZORPAY_KEY_ID: "rzp_test_visible" }, () => {
      expect(getRazorpayKeyId()).toBe("rzp_test_visible");
    });
  });
});

// ── Amount validation (paise integers) ─────────────────────────────────────

describe("assertRazorpayAmount — paise integer minor units", () => {
  it("accepts positive integer paise", () => {
    expect(() => assertRazorpayAmount(236000, "INR")).not.toThrow();
  });

  it("rejects zero, negatives, floats, NaN and oversized amounts", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, 1e13]) {
      expect(() => assertRazorpayAmount(bad, "INR")).toThrow(RazorpayValidationError);
    }
  });

  it("rejects malformed currencies", () => {
    expect(() => assertRazorpayAmount(100, "RUPEES")).toThrow(RazorpayValidationError);
  });
});

// ── Two DISTINCT signature schemes ─────────────────────────────────────────

describe("signature verification — checkout vs webhook are distinct", () => {
  const keySecret = "key_secret_value";
  const webhookSecret = "webhook_secret_value";
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const rawBody = Buffer.from(
    JSON.stringify({ entity: "event", event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } }),
    "utf8",
  );

  it("verifies the checkout HMAC over orderId|paymentId", () => {
    const signature = computeRazorpayCheckoutSignature(orderId, paymentId, keySecret);
    expect(
      verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, keySecret }),
    ).toEqual({ ok: true });
    expect(
      verifyRazorpayCheckoutSignature({
        orderId,
        paymentId: "pay_other",
        signature,
        keySecret,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
    expect(
      verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, keySecret: "wrong" }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("verifies the webhook HMAC over the RAW body", () => {
    const signature = computeRazorpayWebhookSignature(rawBody, webhookSecret);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signatureHeader: signature,
        webhookSecret,
      }),
    ).toEqual({ ok: true });
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: Buffer.from(rawBody.toString("utf8").replace("captured", "failed")),
        signatureHeader: signature,
        webhookSecret,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("cannot be substituted for each other (different secrets AND different preimages)", () => {
    const checkoutSignature = computeRazorpayCheckoutSignature(orderId, paymentId, keySecret);
    const webhookSignature = computeRazorpayWebhookSignature(rawBody, webhookSecret);
    expect(checkoutSignature).not.toBe(webhookSignature);

    // A valid checkout signature must not pass as a webhook signature.
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signatureHeader: checkoutSignature,
        webhookSecret: keySecret,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
    // A valid webhook signature must not pass as a checkout signature.
    expect(
      verifyRazorpayCheckoutSignature({
        orderId,
        paymentId,
        signature: webhookSignature,
        keySecret: webhookSecret,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects missing signatures/secrets and non-hex payloads", () => {
    expect(
      verifyRazorpayCheckoutSignature({ orderId, paymentId, signature: null, keySecret }),
    ).toEqual({ ok: false, reason: "missing_signature" });
    expect(
      verifyRazorpayCheckoutSignature({ orderId, paymentId, signature: "abc", keySecret: null }),
    ).toEqual({ ok: false, reason: "missing_secret" });
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signatureHeader: "not-hex-zzz",
        webhookSecret,
      }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
    expect(
      verifyRazorpayWebhookSignature({ rawBody, signatureHeader: "abc", webhookSecret: null }),
    ).toEqual({ ok: false, reason: "missing_secret" });
  });

  it("proves raw-body verification: re-serialising the JSON breaks the signature", () => {
    const compact = JSON.stringify({ a: 1, b: 2 });
    const pretty = JSON.stringify({ a: 1, b: 2 }, null, 2);
    const signature = computeRazorpayWebhookSignature(compact, webhookSecret);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: compact,
        signatureHeader: signature,
        webhookSecret,
      }).ok,
    ).toBe(true);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody: pretty,
        signatureHeader: signature,
        webhookSecret,
      }).ok,
    ).toBe(false);
  });

  it("uses the environment-specific webhook secret for verification", () => {
    const testConfig = readRazorpayConfig(
      env({
        RAZORPAY_KEY_ID: "rzp_test_x",
        RAZORPAY_KEY_SECRET: "s",
        RAZORPAY_WEBHOOK_SECRET_TEST: "whsec_test_env",
        RAZORPAY_WEBHOOK_SECRET_LIVE: "whsec_live_env",
      }),
    );
    const liveConfig = readRazorpayConfig(
      env({
        RAZORPAY_KEY_ID: "rzp_live_x",
        RAZORPAY_KEY_SECRET: "s",
        RAZORPAY_WEBHOOK_SECRET_TEST: "whsec_test_env",
        RAZORPAY_WEBHOOK_SECRET_LIVE: "whsec_live_env",
      }),
    );
    const signature = computeRazorpayWebhookSignature(rawBody, "whsec_test_env");
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signatureHeader: signature,
        webhookSecret: testConfig.webhookSecret,
      }).ok,
    ).toBe(true);
    expect(
      verifyRazorpayWebhookSignature({
        rawBody,
        signatureHeader: signature,
        webhookSecret: liveConfig.webhookSecret,
      }).ok,
    ).toBe(false);
  });
});

// ── Real REST client via injected fetch ────────────────────────────────────

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(handler: (call: CapturedCall) => { status?: number; body: unknown }) {
  const calls: CapturedCall[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, impl };
}

const LIVE_ENV = {
  NODE_ENV: "test",
  RAZORPAY_KEY_ID: "rzp_test_abc",
  RAZORPAY_KEY_SECRET: "secret_xyz",
  RAZORPAY_MODE: undefined,
  RAZORPAY_MOCK: undefined,
} as const;

describe("Razorpay REST client (injected fetch)", () => {
  it("creates an order with paise amount, INR currency and Basic auth", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch(() => ({
        body: { id: "order_live_1", amount: 236000, currency: "INR", status: "created" },
      }));
      const order = await createRazorpayOrder({
        amountMinor: 236000,
        currency: "INR",
        receipt: "rcpt_1",
        notes: { userId: "u1", planCode: "credit_1" },
        fetchImpl: impl,
      });
      expect(order).toMatchObject({ id: "order_live_1", amount: 236000, currency: "INR" });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/orders");
      expect(calls[0]!.init.method).toBe("POST");
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(
        "Basic " + Buffer.from("rzp_test_abc:secret_xyz").toString("base64"),
      );
      const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
      expect(body["amount"]).toBe(236000);
      expect(body["currency"]).toBe("INR");
      expect(body["payment_capture"]).toBe(1);
      expect((body["notes"] as Record<string, string>)["planCode"]).toBe("credit_1");
    });
  });

  it("validates amounts before touching the network", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch(() => ({ body: {} }));
      await expect(
        createRazorpayOrder({
          amountMinor: 12.5,
          currency: "INR",
          receipt: "rcpt",
          fetchImpl: impl,
        }),
      ).rejects.toBeInstanceOf(RazorpayValidationError);
      expect(calls).toHaveLength(0);
    });
  });

  it("maps non-2xx responses to RazorpayApiError", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { impl } = fakeFetch(() => ({ status: 401, body: { error: { description: "bad key" } } }));
      await expect(
        createRazorpayOrder({
          amountMinor: 100,
          currency: "INR",
          receipt: "rcpt",
          fetchImpl: impl,
        }),
      ).rejects.toBeInstanceOf(RazorpayApiError);
    });
  });

  it("finds an existing customer by email before creating one", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch((call) =>
        call.url.includes("/customers?email=")
          ? { body: { items: [{ id: "cust_existing", email: "a@b.c" }] } }
          : { body: { id: "cust_new" } },
      );
      const customer = await findOrCreateRazorpayCustomer({
        email: "a@b.c",
        fetchImpl: impl,
      });
      expect(customer.id).toBe("cust_existing");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/customers?email=a%40b.c");
      expect(calls[0]!.init.method).toBe("GET");
    });
  });

  it("creates a customer when none exists", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch((call) =>
        call.url.includes("/customers?email=")
          ? { body: { items: [] } }
          : { body: { id: "cust_created", email: "a@b.c" } },
      );
      const customer = await findOrCreateRazorpayCustomer({
        email: "a@b.c",
        name: "A B",
        fetchImpl: impl,
      });
      expect(customer.id).toBe("cust_created");
      expect(calls).toHaveLength(2);
      expect(calls[1]!.url).toBe("https://api.razorpay.com/v1/customers");
      const body = JSON.parse(String(calls[1]!.init.body)) as Record<string, unknown>;
      expect(body["email"]).toBe("a@b.c");
      expect(body["fail_existing"]).toBe(0);
    });
  });

  it("creates a subscription with plan, customer, total_count and notify_info", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch(() => ({
        body: { id: "sub_1", status: "created", plan_id: "plan_M", total_count: 12 },
      }));
      const subscription = await createRazorpaySubscription({
        planId: "plan_M",
        customerId: "cust_1",
        totalCount: 12,
        notes: { userId: "u1", planCode: "subscription_monthly" },
        notifyInfo: { notify_email: "a@b.c" },
        fetchImpl: impl,
      });
      expect(subscription.id).toBe("sub_1");
      expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/subscriptions");
      const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
      expect(body["plan_id"]).toBe("plan_M");
      expect(body["customer_id"]).toBe("cust_1");
      expect(body["total_count"]).toBe(12);
      expect((body["notify_info"] as Record<string, string>)["notify_email"]).toBe("a@b.c");
    });
  });

  it("cancels/pauses/resumes subscriptions at the documented endpoints", async () => {
    await withEnv(LIVE_ENV, async () => {
      const responses = [
        { id: "sub_1", status: "cancelled" },
        { id: "sub_1", status: "paused" },
        { id: "sub_1", status: "active" },
      ];
      let index = 0;
      const { calls, impl } = fakeFetch(() => ({ body: responses[index++] }));
      await cancelRazorpaySubscription({ subscriptionId: "sub_1", fetchImpl: impl });
      await pauseRazorpaySubscription({ subscriptionId: "sub_1", fetchImpl: impl });
      await resumeRazorpaySubscription({ subscriptionId: "sub_1", fetchImpl: impl });
      expect(calls.map((call) => call.url)).toEqual([
        "https://api.razorpay.com/v1/subscriptions/sub_1/cancel",
        "https://api.razorpay.com/v1/subscriptions/sub_1/pause",
        "https://api.razorpay.com/v1/subscriptions/sub_1/resume",
      ]);
      for (const call of calls) {
        expect(call.init.method).toBe("POST");
      }
    });
  });

  it("creates a refund through the refunds API", async () => {
    await withEnv(LIVE_ENV, async () => {
      const { calls, impl } = fakeFetch(() => ({
        body: { id: "rfnd_1", payment_id: "pay_1", amount: 236000, currency: "INR", status: "processed" },
      }));
      const refund = await createRazorpayRefund({
        paymentId: "pay_1",
        amountMinor: 236000,
        fetchImpl: impl,
      });
      expect(refund.id).toBe("rfnd_1");
      expect(calls[0]!.url).toBe("https://api.razorpay.com/v1/payments/pay_1/refund");
      const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
      expect(body["amount"]).toBe(236000);
      expect(body["speed"]).toBe("normal");
    });
  });
});

// ── Deterministic mock adapter ─────────────────────────────────────────────

describe("deterministic mock adapter (keyless test/dev)", () => {
  it("returns stable ids for identical inputs and no network", async () => {
    await withEnv(
      {
        NODE_ENV: "test",
        RAZORPAY_KEY_ID: undefined,
        RAZORPAY_KEY_SECRET: undefined,
        RAZORPAY_MOCK: undefined,
      },
      async () => {
        expect(readRazorpayConfig().mode).toBe("mock");
        const first = await createRazorpayOrder({
          amountMinor: 236000,
          currency: "INR",
          receipt: "same_receipt",
        });
        const second = await createRazorpayOrder({
          amountMinor: 236000,
          currency: "INR",
          receipt: "same_receipt",
        });
        expect(first.id).toBe(second.id);
        expect(first.id).toMatch(/^order_mock_[0-9a-f]{24}$/);
        const other = await createRazorpayOrder({
          amountMinor: 237000,
          currency: "INR",
          receipt: "same_receipt",
        });
        expect(other.id).not.toBe(first.id);

        const sub = await createRazorpaySubscription({
          planId: "plan_mock_x",
          customerId: "cust_mock_y",
          totalCount: 12,
        });
        expect(sub.id).toMatch(/^sub_mock_/);
      },
    );
  });

  it("refuses to operate when unconfigured", async () => {
    await withEnv(
      { NODE_ENV: "production", RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined },
      async () => {
        await expect(
          createRazorpayOrder({ amountMinor: 100, currency: "INR", receipt: "r" }),
        ).rejects.toBeInstanceOf(RazorpayNotConfiguredError);
      },
    );
  });
});

// ── Shared plan mapping + entitlement state machine ────────────────────────

describe("plan mapping — Stripe and Razorpay equivalence", () => {
  it("maps exactly the Stripe T-12 catalog to canonical codes/amounts", () => {
    expect(BILLING_PLANS.map((plan) => plan.code)).toEqual(
      STRIPE_CATALOG.map((product) => product.code),
    );
    for (const stripeProduct of STRIPE_CATALOG) {
      const plan = resolveBillingPlan(stripeProduct.code);
      expect(plan, "missing plan " + stripeProduct.code).toBeTruthy();
      expect(plan!.kind).toBe(stripeProduct.kind);
      expect(plan!.credits).toBe(stripeProduct.credits);
      expect(plan!.interval).toBe(stripeProduct.interval);
      expect(plan!.amountMinor.USD).toBe(stripeProduct.amountMinor.USD);
      expect(plan!.amountMinor.INR).toBe(stripeProduct.amountMinor.INR);
    }
  });

  it("grants IDENTICAL entitlements regardless of gateway (single mapping table)", () => {
    for (const plan of BILLING_PLANS) {
      const entitlements = planEntitlements(plan.code);
      expect(entitlements.credits).toBe(plan.credits);
      expect(entitlements.features).toEqual(plan.features);
      if (plan.kind === "subscription") {
        for (const feature of PREMIUM_FEATURES) {
          expect(entitlements.features).toContain(feature);
        }
      }
    }
    expect(() => planEntitlements("does_not_exist")).toThrow();
  });

  it("resolves Razorpay dashboard plan ids from env, failing closed when missing", () => {
    const monthly = resolveBillingPlan("subscription_monthly")!;
    expect(
      resolveRazorpayPlanId(monthly, env({ RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY: "plan_M" })),
    ).toBe("plan_M");
    expect(resolveRazorpayPlanId(monthly, env({ NODE_ENV: "production" }))).toBeNull();
    expect(resolveRazorpayPlanId(monthly, env({ NODE_ENV: "test" }))).toBe(
      "plan_mock_subscription_monthly",
    );
    expect(resolveRazorpayPlanId(resolveBillingPlan("credit_6")!, env({}))).toBeNull();
  });

  it("defines one-year total counts per interval", () => {
    expect(DEFAULT_SUBSCRIPTION_TOTAL_COUNT).toEqual({ week: 52, month: 12, year: 5 });
  });
});

describe("subscription lifecycle state machine", () => {
  it("pauses entitlement on halted/paused without deleting state", () => {
    expect(entitlementStateForStatus("halted")).toBe("paused");
    expect(entitlementStateForStatus("paused")).toBe("paused");
    expect(entitlementStateForStatus("active")).toBe("active");
    expect(entitlementStateForStatus("pending")).toBe("active");
    expect(entitlementStateForStatus("cancelled")).toBe("cancelled");
    expect(entitlementStateForStatus("completed")).toBe("completed");
    expect(entitlementStateForStatus("authenticated")).toBe("active");
  });

  it("allows halt -> resume and rejects stale resurrection after terminal", () => {
    expect(canApplySubscriptionTransition("active", "halted")).toBe(true);
    expect(canApplySubscriptionTransition("halted", "paused")).toBe(true);
    expect(canApplySubscriptionTransition("halted", "active")).toBe(true);
    expect(canApplySubscriptionTransition("paused", "active")).toBe(true);
    expect(canApplySubscriptionTransition("cancelled", "active")).toBe(false);
    expect(canApplySubscriptionTransition("cancelled", "cancelled")).toBe(true);
    expect(canApplySubscriptionTransition("completed", "active")).toBe(false);
    expect(canApplySubscriptionTransition("cancelled", "completed")).toBe(false);
    // Stale authenticated/activated retries must not resurrect a halted mandate.
    expect(canApplySubscriptionTransition("halted", "authenticated")).toBe(false);
    expect(canApplySubscriptionTransition("paused", "active")).toBe(true);
  });

  it("maps every supported subscription event to a status", () => {
    expect(subscriptionStatusForEvent("subscription.authenticated")).toBe("authenticated");
    expect(subscriptionStatusForEvent("subscription.activated")).toBe("active");
    expect(subscriptionStatusForEvent("subscription.charged")).toBe("active");
    expect(subscriptionStatusForEvent("subscription.pending")).toBe("pending");
    expect(subscriptionStatusForEvent("subscription.halted")).toBe("halted");
    expect(subscriptionStatusForEvent("subscription.paused")).toBe("paused");
    expect(subscriptionStatusForEvent("subscription.resumed")).toBe("active");
    expect(subscriptionStatusForEvent("subscription.cancelled")).toBe("cancelled");
    expect(subscriptionStatusForEvent("subscription.completed")).toBe("completed");
    expect(subscriptionStatusForEvent("payment.captured")).toBeNull();
  });

  it("normalises mandate payment methods", () => {
    expect(normalizeMandateMethod("upi")).toBe("upi");
    expect(normalizeMandateMethod("card")).toBe("card");
    expect(normalizeMandateMethod("emandate")).toBe("emandate");
    expect(normalizeMandateMethod("e-mandate")).toBe("emandate");
    expect(normalizeMandateMethod(undefined)).toBe("unknown");
    expect(normalizeMandateMethod("netbanking")).toBe("unknown");
  });

  it("classifies purchase rows by issuing gateway (legacy-compatible)", () => {
    expect(classifyPurchaseGateway({ metadata: { provider: "razorpay" }, orderId: "cs_x" })).toBe(
      "razorpay",
    );
    expect(classifyPurchaseGateway({ metadata: { provider: "stripe" }, orderId: "order_x" })).toBe(
      "stripe",
    );
    expect(classifyPurchaseGateway({ metadata: null, orderId: "order_live_1" })).toBe("razorpay");
    expect(classifyPurchaseGateway({ metadata: null, orderId: "cs_test_mock_1" })).toBeNull();
  });
});

// ── Mandate pre-debit window ────────────────────────────────────────────────

describe("mandate pre-debit notification window", () => {
  it("is 24h before the charge by default", () => {
    const chargeAt = new Date("2026-11-01T00:00:00Z");
    const now = new Date("2026-10-20T00:00:00Z");
    const due = computePreDebitNotificationAt({ chargeAt, now });
    expect(due.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(MANDATE_PRE_DEBIT_WINDOW_HOURS).toBe(24);
  });

  it("supports a custom window and clamps overdue notifications to now", () => {
    const chargeAt = new Date("2026-11-01T00:00:00Z");
    const now = new Date("2026-10-20T00:00:00Z");
    expect(
      computePreDebitNotificationAt({ chargeAt, windowHours: 12, now }).toISOString(),
    ).toBe("2026-10-31T12:00:00.000Z");
    const overdueCharge = new Date("2026-10-20T05:00:00Z");
    expect(computePreDebitNotificationAt({ chargeAt: overdueCharge, now }).getTime()).toBe(
      now.getTime(),
    );
  });
});

// ── GST single source ──────────────────────────────────────────────────────

describe("GST computation — single source for invoices", () => {
  const supplierState = GST_SUPPLIER_STATE_DEFAULT; // 27

  it("validates GSTIN including the mod-36 checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("29AAGCB7383J1Z4")).toBe(true);
    expect(isValidGstin("27aapfu0939f1zv")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZZ")).toBe(false); // bad checksum
    expect(isValidGstin("27AAPFU0939F1")).toBe(false); // too short
    expect(isValidGstin(undefined)).toBe(false);
    expect(gstStateCodeFromGstin("29AAGCB7383J1Z4")).toBe("29");
    expect(() => assertValidGstin("garbage")).toThrow(RazorpayGstError);
  });

  it("extracts tax from a GST-inclusive price and splits CGST+SGST intra-state", () => {
    const gst = computeGst({
      amountMinor: 11800,
      supplierStateCode: supplierState,
      placeOfSupplyStateCode: supplierState,
    });
    expect(gst).toMatchObject({
      totalMinor: 11800,
      subtotalMinor: 10000,
      taxMinor: 1800,
      cgstMinor: 900,
      sgstMinor: 900,
      igstMinor: 0,
      taxType: "CGST_SGST",
      taxRateBps: 1800,
      taxInclusive: true,
    });
    expect(gst.totalMinor).toBe(gst.subtotalMinor + gst.taxMinor);
  });

  it("charges IGST for inter-state supply (buyer GSTIN state differs)", () => {
    const gst = computeGst({
      amountMinor: 11800,
      supplierStateCode: supplierState,
      gstin: "29AAGCB7383J1Z4",
    });
    expect(gst.taxType).toBe("IGST");
    expect(gst.igstMinor).toBe(1800);
    expect(gst.cgstMinor).toBe(0);
    expect(gst.sgstMinor).toBe(0);
    expect(gst.placeOfSupplyStateCode).toBe("29");
    expect(gst.gstin).toBe("29AAGCB7383J1Z4");
  });

  it("supports exclusive (B2B) pricing", () => {
    const gst = computeGst({ amountMinor: 10000, taxInclusive: false });
    expect(gst).toMatchObject({ subtotalMinor: 10000, taxMinor: 1800, totalMinor: 11800 });
  });

  it("handles odd paise and zero-rate invoices without losing a paisa", () => {
    const odd = computeGst({ amountMinor: 10500 });
    expect(odd.subtotalMinor).toBe(8898);
    expect(odd.taxMinor).toBe(1602);
    expect(odd.cgstMinor + odd.sgstMinor).toBe(odd.taxMinor);
    expect(odd.totalMinor).toBe(odd.subtotalMinor + odd.taxMinor);
    const zero = computeGst({ amountMinor: 5000, taxRateBps: 0 });
    expect(zero).toMatchObject({ taxType: "NONE", taxMinor: 0, totalMinor: 5000 });
  });

  it("rejects invalid GSTIN, negative amounts and absurd rates", () => {
    expect(() => computeGst({ amountMinor: 100, gstin: "27BADGSTIN0000Z0" })).toThrow(
      RazorpayGstError,
    );
    expect(() => computeGst({ amountMinor: -1 })).toThrow(RazorpayGstError);
    expect(() => computeGst({ amountMinor: 100, taxRateBps: 6000 })).toThrow(RazorpayGstError);
  });

  it("reads deployment GST config from env with safe defaults", () => {
    expect(configuredSupplierStateCode(env({}))).toBe(GST_SUPPLIER_STATE_DEFAULT);
    expect(configuredSupplierStateCode(env({ RAZORPAY_GST_SUPPLIER_STATE: "29" }))).toBe("29");
    expect(configuredGstRateBps(env({}))).toBe(1800);
    expect(configuredGstRateBps(env({ RAZORPAY_GST_RATE_BPS: "1200" }))).toBe(1200);
    expect(configuredGstInclusive(env({}))).toBe(true);
    expect(configuredGstInclusive(env({ RAZORPAY_GST_INCLUSIVE: "0" }))).toBe(false);
  });
});
