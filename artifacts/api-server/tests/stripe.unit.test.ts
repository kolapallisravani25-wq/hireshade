/**
 * Unit tests for the Stripe adapter — no network, no database.
 *
 * Covers:
 *  - T-12 catalog parity with the live pricing capture
 *    (docs/raw/probes/trpc-billing.getPrices.json) and the credit unit mapping;
 *  - server-side amount resolution (pack code -> cents, client amount ignored
 *    by design — this module has no amount input);
 *  - line-item construction incl. subscription recurring intervals;
 *  - config/mode fail-closed rules (production never mocks);
 *  - webhook signature verification (raw body, timestamp tolerance, rotation);
 *  - deterministic mock adapter and the real REST adapter via an injected fetch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  STRIPE_CATALOG,
  STRIPE_CURRENCIES,
  buildCheckoutLineItems,
  buildStripeSignatureHeader,
  collectStripePriceIds,
  computeStripeSignature,
  createMockCheckoutSession,
  createStripeCheckoutSession,
  normalizeCurrency,
  parseStripeEvent,
  readStripeConfig,
  resolveStripeMode,
  resolveStripeProduct,
  StripeAmountMismatchError,
  StripeApiError,
  StripeEventValidationError,
  StripeNotConfiguredError,
  verifyStripeSignature,
} from "../src/lib/stripe.js";

// ── T-12 pricing evidence parity ─────────────────────────────────────────────

interface PriceEntry {
  price: string;
  cents: number;
}
const probePath = fileURLToPath(
  new URL("../../../docs/raw/probes/trpc-billing.getPrices.json", import.meta.url),
);
const probeRaw = JSON.parse(readFileSync(probePath, "utf8")) as Array<{
  result: { data: { json: Record<string, Record<string, PriceEntry | null>> } };
}>;
const observedPrices = probeRaw[0]!.result.data.json;

describe("T-12 catalog parity with docs/raw/probes/trpc-billing.getPrices.json", () => {
  it("mirrors every observed USD/INR cent value exactly", () => {
    expect(STRIPE_CATALOG.length).toBeGreaterThan(0);
    for (const product of STRIPE_CATALOG) {
      const observed = observedPrices[product.code];
      expect(observed, "missing observed price for " + product.code).toBeTruthy();
      expect(observed!["USD"]!.cents, product.code + " USD").toBe(product.amountMinor.USD);
      expect(observed!["INR"]!.cents, product.code + " INR").toBe(product.amountMinor.INR);
      // The live capture has EUR: null, so EUR must not be offered.
      expect(observed!["EUR"]).toBeNull();
    }
  });

  it("includes the T-12 headline products the Lead called out", () => {
    for (const code of [
      "credit_1",
      "credit_3",
      "credit_6",
      "credit_9",
      "subscription_weekly",
      "subscription_monthly",
      "subscription_yearly",
      "lifetime_plan",
    ]) {
      expect(
        STRIPE_CATALOG.some((p) => p.code === code),
        "missing " + code,
      ).toBe(true);
    }
  });

  it("grant counts match the credit-pack names (credit_N -> N credits)", () => {
    const creditPacks = STRIPE_CATALOG.filter((p) => p.kind === "credits");
    expect(creditPacks.map((p) => p.code)).toEqual([
      "credit_1",
      "credit_3",
      "credit_6",
      "credit_9",
    ]);
    for (const pack of creditPacks) {
      expect(pack.credits).toBe(Number(pack.code.replace("credit_", "")));
    }
  });

  it("subscription tiers carry a recurring interval; plans/credits do not", () => {
    for (const product of STRIPE_CATALOG) {
      if (product.kind === "subscription") {
        expect(["week", "month", "year"]).toContain(product.interval);
        expect(product.credits).toBe(0);
      } else {
        expect(product.interval).toBeUndefined();
      }
    }
  });
});

describe("resolveStripeProduct — server-side amount authority", () => {
  it("resolves the exact T-12 cents from the catalog", () => {
    expect(resolveStripeProduct("credit_1", "USD")).toEqual({
      product: STRIPE_CATALOG.find((p) => p.code === "credit_1"),
      currency: "USD",
      amountMinor: 2500,
    });
    expect(resolveStripeProduct("credit_6", "USD")!.amountMinor).toBe(7800);
    expect(resolveStripeProduct("credit_6", "INR")!.amountMinor).toBe(738000);
    expect(resolveStripeProduct("credit_9", "USD")!.amountMinor).toBe(11700);
    expect(resolveStripeProduct("lifetime_plan", "USD")!.amountMinor).toBe(59990);
  });

  it("defaults unknown/unsupported currencies to USD (T-12 EUR is null)", () => {
    for (const currency of [undefined, null, "", "EUR", "GBP", 42]) {
      expect(normalizeCurrency(currency)).toBe("USD");
      expect(resolveStripeProduct("credit_3", currency)!.currency).toBe("USD");
    }
    expect(normalizeCurrency("INR")).toBe("INR");
  });

  it("rejects unknown product codes and non-strings", () => {
    for (const code of ["", "quick_5", "credit_10", "CREDIT_6", null, 5, undefined]) {
      expect(resolveStripeProduct(code, "USD")).toBeNull();
    }
  });

  it("offers only the currencies captured from billing.getPrices", () => {
    expect(STRIPE_CURRENCIES).toEqual(["USD", "INR"]);
  });
});

describe("buildCheckoutLineItems", () => {
  it("builds price_data from the catalog when no price override exists", () => {
    const items = buildCheckoutLineItems(resolveStripeProduct("credit_6", "USD")!);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect("price_data" in item).toBe(true);
    if ("price_data" in item) {
      expect(item.price_data.currency).toBe("usd");
      expect(item.price_data.unit_amount).toBe(7800);
      expect(item.price_data.recurring).toBeUndefined();
      expect(item.price_data.product_data.name).toContain("HireShade");
      expect(item.quantity).toBe(1);
    }
  });

  it("emits recurring.interval for subscription products", () => {
    const monthly = buildCheckoutLineItems(resolveStripeProduct("subscription_monthly", "USD")!);
    expect("price_data" in monthly[0]!).toBe(true);
    if ("price_data" in monthly[0]!) {
      expect(monthly[0]!.price_data.recurring).toEqual({ interval: "month" });
      expect(monthly[0]!.price_data.unit_amount).toBe(9990);
    }
    const weekly = buildCheckoutLineItems(resolveStripeProduct("subscription_weekly", "INR")!);
    if ("price_data" in weekly[0]!) {
      expect(weekly[0]!.price_data.recurring).toEqual({ interval: "week" });
      expect(weekly[0]!.price_data.currency).toBe("inr");
      expect(weekly[0]!.price_data.unit_amount).toBe(498000);
    }
  });

  it("uses a configured STRIPE_PRICE_* id instead of inline price_data", () => {
    const items = buildCheckoutLineItems(resolveStripeProduct("credit_6", "USD")!, {
      credit_6: "price_123",
    });
    expect(items).toEqual([{ price: "price_123", quantity: 1 }]);
  });
});

describe("readStripeConfig — fail-closed mode selection", () => {
  const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv =>
    overrides as NodeJS.ProcessEnv;

  it("is live whenever a secret key is configured", () => {
    expect(resolveStripeMode(env({ NODE_ENV: "production", STRIPE_SECRET_KEY: "sk_test" }))).toBe("live");
    expect(resolveStripeMode(env({ NODE_ENV: "test", STRIPE_SECRET_KEY: "sk_test" }))).toBe("live");
  });

  it("is mock in test (or explicit STRIPE_MOCK outside production)", () => {
    expect(resolveStripeMode(env({ NODE_ENV: "test" }))).toBe("mock");
    expect(resolveStripeMode(env({ NODE_ENV: "development", STRIPE_MOCK: "1" }))).toBe("mock");
  });

  it("NEVER mocks in production, even with STRIPE_MOCK=1", () => {
    expect(resolveStripeMode(env({ NODE_ENV: "production", STRIPE_MOCK: "1" }))).toBe("unconfigured");
    expect(resolveStripeMode(env({ NODE_ENV: "production" }))).toBe("unconfigured");
  });

  it("is unconfigured in plain development with no keys", () => {
    expect(resolveStripeMode(env({ NODE_ENV: "development" }))).toBe("unconfigured");
  });

  it("reads webhook/publishable keys and STRIPE_PRICE_* overrides", () => {
    const config = readStripeConfig(
      env({
        NODE_ENV: "production",
        STRIPE_SECRET_KEY: "sk_live_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        STRIPE_PUBLISHABLE_KEY: "pk_live_x",
        STRIPE_PRICE_CREDIT_6: "price_abc",
        STRIPE_PRICE_SUBSCRIPTION_MONTHLY: "price_sub",
        STRIPE_API_VERSION: "2026-09-30.endive",
      }),
    );
    expect(config.mode).toBe("live");
    expect(config.webhookSecret).toBe("whsec_x");
    expect(config.publishableKey).toBe("pk_live_x");
    expect(config.priceIds).toEqual({ credit_6: "price_abc", subscription_monthly: "price_sub" });
    expect(collectStripePriceIds(env({ STRIPE_PRICE_OTHER: "  " }))).toEqual({});
  });
});

describe("verifyStripeSignature — raw body HMAC with timestamp tolerance", () => {
  const secret = "whsec_test_secret";
  const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "charge.refunded", data: { object: {} } }));
  const now = 1_800_000_000;

  it("accepts a correct signature built over the raw bytes", () => {
    const header = buildStripeSignatureHeader(body, secret, now);
    expect(verifyStripeSignature({ rawBody: body, signatureHeader: header, secret, nowSeconds: now })).toEqual({
      ok: true,
      timestamp: now,
    });
  });

  it("rejects a tampered body (signature over original bytes)", () => {
    const header = buildStripeSignatureHeader(body, secret, now);
    const tampered = Buffer.from(body.toString("utf8").replace("evt_1", "evt_2"));
    expect(
      verifyStripeSignature({ rawBody: tampered, signatureHeader: header, secret, nowSeconds: now }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects the wrong secret", () => {
    const header = buildStripeSignatureHeader(body, "other_secret", now);
    expect(
      verifyStripeSignature({ rawBody: body, signatureHeader: header, secret, nowSeconds: now }),
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects timestamps outside the 300s tolerance (replay)", () => {
    const old = now - 301;
    const header = buildStripeSignatureHeader(body, secret, old);
    expect(
      verifyStripeSignature({ rawBody: body, signatureHeader: header, secret, nowSeconds: now }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
    const future = now + 301;
    expect(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: buildStripeSignatureHeader(body, secret, future),
        secret,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("accepts a timestamp exactly at the tolerance boundary", () => {
    const edge = now - 300;
    expect(
      verifyStripeSignature({
        rawBody: body,
        signatureHeader: buildStripeSignatureHeader(body, secret, edge),
        secret,
        nowSeconds: now,
        toleranceSeconds: 300,
      }).ok,
    ).toBe(true);
  });

  it("accepts multiple v1 signatures during secret rotation", () => {
    const valid = computeStripeSignature(body, secret, now);
    const header = "t=" + now + ",v1=" + "f".repeat(64) + ",v1=" + valid;
    expect(verifyStripeSignature({ rawBody: body, signatureHeader: header, secret, nowSeconds: now }).ok).toBe(
      true,
    );
  });

  it("reports each malformed-header case distinctly", () => {
    expect(verifyStripeSignature({ rawBody: body, signatureHeader: undefined, secret })).toEqual({
      ok: false,
      reason: "missing_header",
    });
    expect(verifyStripeSignature({ rawBody: body, signatureHeader: "  ", secret })).toEqual({
      ok: false,
      reason: "missing_header",
    });
    expect(
      verifyStripeSignature({ rawBody: body, signatureHeader: "v1=abc", secret }),
    ).toEqual({ ok: false, reason: "malformed_header" });
    expect(
      verifyStripeSignature({ rawBody: body, signatureHeader: "t=" + now, secret, nowSeconds: now }),
    ).toEqual({ ok: false, reason: "no_v1_signature" });
    expect(
      verifyStripeSignature({ rawBody: body, signatureHeader: "t=notdigits,v1=abc", secret }),
    ).toEqual({ ok: false, reason: "malformed_header" });
  });
});

describe("parseStripeEvent", () => {
  it("accepts a well-formed event", () => {
    const event = parseStripeEvent(
      JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } }),
    );
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("checkout.session.completed");
  });

  it("rejects non-JSON and missing id/type/data.object", () => {
    expect(() => parseStripeEvent("not json")).toThrow(StripeEventValidationError);
    expect(() => parseStripeEvent(JSON.stringify({ type: "x", data: { object: {} } }))).toThrow(
      StripeEventValidationError,
    );
    expect(() => parseStripeEvent(JSON.stringify({ id: "e", data: { object: {} } }))).toThrow(
      StripeEventValidationError,
    );
    expect(() => parseStripeEvent(JSON.stringify({ id: "e", type: "x", data: {} }))).toThrow(
      StripeEventValidationError,
    );
  });
});

// ── Adapters ────────────────────────────────────────────────────────────────

function captureFetch(responseBody: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, impl };
}

const liveConfig = readStripeConfig({
  NODE_ENV: "production",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_123",
  STRIPE_CHECKOUT_SUCCESS_URL: "https://shop.example/success",
  STRIPE_CHECKOUT_CANCEL_URL: "https://shop.example/cancel",
} as NodeJS.ProcessEnv);

const mockConfig = readStripeConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

describe("createMockCheckoutSession — deterministic offline adapter", () => {
  const resolved = resolveStripeProduct("credit_6", "USD")!;

  it("is deterministic for identical inputs", () => {
    const a = createMockCheckoutSession({ userId: "u1", resolved, idempotencyKey: "k1" });
    const b = createMockCheckoutSession({ userId: "u1", resolved, idempotencyKey: "k1" });
    expect(a).toEqual(b);
    expect(a.id).toMatch(/^cs_test_mock_[0-9a-f]{24}$/);
    expect(a.paymentIntentId).toMatch(/^pi_test_mock_/);
    expect(a.amountMinor).toBe(7800);
    expect(a.mode).toBe("mock");
  });

  it("differs when the checkout idempotency key differs", () => {
    const a = createMockCheckoutSession({ userId: "u1", resolved, idempotencyKey: "k1" });
    const b = createMockCheckoutSession({ userId: "u1", resolved, idempotencyKey: "k2" });
    expect(a.id).not.toBe(b.id);
  });

  it("subscriptions do not fabricate a PaymentIntent", () => {
    const sub = createMockCheckoutSession({
      userId: "u1",
      resolved: resolveStripeProduct("subscription_monthly", "USD")!,
      idempotencyKey: "k1",
    });
    expect(sub.paymentIntentId).toBeNull();
    expect(sub.productKind).toBe("subscription");
  });
});

describe("createStripeCheckoutSession — real REST adapter (injected fetch)", () => {
  const resolved = resolveStripeProduct("credit_6", "USD")!;

  it("calls the REST API with a form-encoded payment session and no client amount", async () => {
    const { calls, impl } = captureFetch({
      id: "cs_test_real",
      url: "https://checkout.stripe.com/c/pay/cs_test_real",
      amount_total: 7800,
      currency: "usd",
      payment_intent: "pi_real",
    });
    const session = await createStripeCheckoutSession({
      userId: "u1",
      resolved,
      config: liveConfig,
      idempotencyKey: "hs_key_1",
      fetchImpl: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_123");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Idempotency-Key"]).toBe("hs_key_1");
    expect(headers["Stripe-Version"]).toBe("2026-09-30.endive");

    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("mode")).toBe("payment");
    expect(form.get("success_url")).toBe("https://shop.example/success");
    expect(form.get("cancel_url")).toBe("https://shop.example/cancel");
    expect(form.get("client_reference_id")).toBe("u1");
    expect(form.get("metadata[productCode]")).toBe("credit_6");
    expect(form.get("metadata[credits]")).toBe("6");
    expect(form.get("line_items[0][quantity]")).toBe("1");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("7800");
    // Stripe best practice: dynamic payment methods, never an explicit list.
    expect(form.get("payment_method_types[0]")).toBeNull();
    // The client never supplies an amount: the form only carries catalog data.
    expect(form.get("amount")).toBeNull();

    expect(session).toMatchObject({
      id: "cs_test_real",
      url: "https://checkout.stripe.com/c/pay/cs_test_real",
      amountMinor: 7800,
      currency: "USD",
      productCode: "credit_6",
      productKind: "credits",
      credits: 6,
      paymentIntentId: "pi_real",
      mode: "live",
    });
  });

  it("creates subscription-mode sessions with a recurring interval", async () => {
    const { calls, impl } = captureFetch({
      id: "cs_sub",
      url: "https://checkout.stripe.com/c/pay/cs_sub",
      amount_total: 9990,
      currency: "usd",
      payment_intent: null,
    });
    const session = await createStripeCheckoutSession({
      userId: "u1",
      resolved: resolveStripeProduct("subscription_monthly", "USD")!,
      config: liveConfig,
      idempotencyKey: "hs_key_2",
      fetchImpl: impl,
    });
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("mode")).toBe("subscription");
    expect(form.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(form.get("subscription_data[metadata][userId]")).toBe("u1");
    expect(session.paymentIntentId).toBeNull();
    expect(session.productKind).toBe("subscription");
  });

  it("uses a configured price id rather than an inline amount", async () => {
    const config = readStripeConfig({
      NODE_ENV: "production",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_PRICE_CREDIT_6: "price_override",
    } as NodeJS.ProcessEnv);
    const { calls, impl } = captureFetch({
      id: "cs_price",
      url: "https://checkout.stripe.com/c/pay/cs_price",
      amount_total: 7800,
      currency: "usd",
    });
    await createStripeCheckoutSession({
      userId: "u1",
      resolved,
      config,
      idempotencyKey: "hs_key_3",
      fetchImpl: impl,
    });
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("line_items[0][price]")).toBe("price_override");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBeNull();
  });

  it("fails closed when Stripe returns a different amount than the catalog", async () => {
    const { impl } = captureFetch({
      id: "cs_bad",
      url: "https://checkout.stripe.com/c/pay/cs_bad",
      amount_total: 1,
      currency: "usd",
    });
    await expect(
      createStripeCheckoutSession({
        userId: "u1",
        resolved,
        config: liveConfig,
        idempotencyKey: "hs_key_4",
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(StripeAmountMismatchError);
  });

  it("maps non-2xx Stripe responses to StripeApiError", async () => {
    const { impl } = captureFetch({ error: { message: "bad key" } }, 401);
    await expect(
      createStripeCheckoutSession({
        userId: "u1",
        resolved,
        config: liveConfig,
        idempotencyKey: "hs_key_5",
        fetchImpl: impl,
      }),
    ).rejects.toBeInstanceOf(StripeApiError);
  });

  it("refuses to build a live session without configuration", async () => {
    await expect(
      createStripeCheckoutSession({
        userId: "u1",
        resolved,
        config: readStripeConfig({
          NODE_ENV: "production",
        } as NodeJS.ProcessEnv),
        idempotencyKey: "hs_key_6",
      }),
    ).rejects.toBeInstanceOf(StripeNotConfiguredError);
  });

  it("returns the deterministic mock when mode is mock", async () => {
    const { calls, impl } = captureFetch({});
    const session = await createStripeCheckoutSession({
      userId: "u1",
      resolved,
      config: mockConfig,
      idempotencyKey: "hs_key_7",
      fetchImpl: impl,
    });
    expect(calls).toHaveLength(0); // never touched the network
    expect(session.mode).toBe("mock");
    expect(session.id).toMatch(/^cs_test_mock_/);
  });
});
