# Razorpay Billing (W3 parity)

Status: **PASS (server-side)** â€” Razorpay is a first-class billing provider alongside Stripe.
Branch: feat-4. Not committed.

Verification (exact commands in section 13):

| Suite | Result |
|---|---|
| Razorpay unit tests | 45/45 passed |
| Razorpay dedicated-DB integration tests | 39/39 passed |
| Stripe regression (unit + DB) | 70/70 passed |
| API unit suite (all non-DB suites) | 262/262 passed, 34 files |
| Full api-server typecheck | exit 0 |
| API build | exit 0 |

Dedicated databases (never the shared hireshade_dev):
- hireshade_razorpay_test â€” this suite (hard guard: the test refuses any other DB name)
- hireshade_stripe_test â€” Stripe suite (unchanged, re-run green)

---

## 1. Environment keys

Required for live/test:

| Key | Purpose |
|---|---|
| RAZORPAY_KEY_ID | Public key id (rzp_test_... / rzp_live_...). Safe for Razorpay Checkout JS. |
| RAZORPAY_KEY_SECRET | API secret. Server-side only â€” Basic auth and the checkout HMAC; never returned to clients. |

Webhook secrets (separate test/live, selected by key-id mode):

| Key | Used when |
|---|---|
| RAZORPAY_WEBHOOK_SECRET_TEST | test/mock mode (preferred) |
| RAZORPAY_WEBHOOK_SECRET_LIVE | live mode (preferred) |
| RAZORPAY_WEBHOOK_SECRET | fallback for single-environment setups |

Optional:

| Key | Default | Purpose |
|---|---|---|
| RAZORPAY_PLAN_SUBSCRIPTION_WEEKLY / _MONTHLY / _YEARLY | none (fails closed 503) | Razorpay dashboard plan ids |
| RAZORPAY_INTERNAL_TOKEN | none (refund endpoint 503) | Ops refund endpoint token (header X-Internal-Token) |
| RAZORPAY_GST_SUPPLIER_STATE | 27 (Maharashtra) | Supplier state code |
| RAZORPAY_GST_RATE_BPS | 1800 (18%) | GST rate in basis points |
| RAZORPAY_GST_INCLUSIVE | true (0 disables) | Listed prices include GST |
| RAZORPAY_MODE | inferred from key id | live/test override for non-standard key ids |
| RAZORPAY_MOCK | unset | 1 = keyless deterministic mock outside production |
| RAZORPAY_API_BASE | https://api.razorpay.com/v1 | API base (tests/proxies) |

Mock mode is reachable only when NODE_ENV != production. Production without keys always fails closed (503); it can never fall back to mock.

---

## 2. Test-mode setup (checkout + webhook + tunnel)

1. Create test keys in the Razorpay dashboard (Account & Settings -> API Keys) and set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. The rzp_test_ prefix selects test mode automatically.
2. Create subscription plans in the dashboard (Subscriptions -> Plans) and put their ids in RAZORPAY_PLAN_SUBSCRIPTION_*.
3. Expose localhost over HTTPS so Razorpay can reach the webhook:
   - ngrok: ngrok http 5051 -> use the https forwarding URL
   - or cloudflared: cloudflared tunnel --url http://localhost:5051
   - or IDE port forwarding (public https URL for port 5051)
4. Razorpay dashboard -> Settings -> Webhooks -> Add:
   - URL: https://TUNNEL/api/razorpay/webhook
   - Secret: put it in RAZORPAY_WEBHOOK_SECRET_TEST (dashboard webhook secret is separate from the API key secret)
   - Active events (all 16): payment.authorized, payment.captured, payment.failed, order.paid, subscription.authenticated, subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.completed, subscription.paused, subscription.resumed, refund.created, refund.processed, invoice.paid
5. Send a dashboard test delivery: expect HTTP 200 and a razorpay_webhook_events row. 400 = wrong secret; 503 = no webhook secret configured.
6. Local replay: the signature is HMAC-SHA256 of the RAW body bytes with the dashboard secret, hex encoded, in X-Razorpay-Signature, plus X-Razorpay-Event-Id for idempotency. Do NOT pretty-print or re-serialize the body after signing.
7. app.ts mounts express.raw() for /api/razorpay/webhook before express.json(), so the raw bytes survive to verification.

---

## 3. Two DISTINCT signature verifications

| | Checkout verification | Webhook verification |
|---|---|---|
| Endpoint | POST /api/razorpay/checkout/verify | POST /api/razorpay/webhook |
| Signature source | checkout response razorpay_signature (client posts it) | X-Razorpay-Signature header |
| Secret | RAZORPAY_KEY_SECRET | RAZORPAY_WEBHOOK_SECRET_TEST / _LIVE (dashboard) |
| Preimage | order_id + pipe + payment_id (UTF-8) | RAW request body bytes |
| Algorithm | HMAC-SHA256, lowercase hex | HMAC-SHA256, lowercase hex |
| Compare | constant-time with length/hex precheck | constant-time |
| Failure | 400 missing_signature / missing_secret / signature_mismatch | 400 with reason; 503 when secret unset |

Proof (unit tests): a valid checkout signature is rejected by the webhook verifier and vice versa even with the same secret, because the preimages differ. Pretty-printing the JSON breaks webhook verification (raw-body requirement). Test and live webhook secrets are selected by key-id mode; a test-secret signature fails the live config.

---

## 4. Event matrix (all 16 events)

| Event | Handler | Idempotency unit | Effect |
|---|---|---|---|
| payment.authorized | record payment id on pending purchase | event id | No credit; stores paymentId for later refund/failure lookup |
| payment.captured | settle purchase | event id + purchase claim + ledger key | Exactly-once credit grant; invoice -> paid |
| payment.failed | mark purchase failed | event id + conditional pending->failed | No credit; a later capture may settle (processor authoritative) |
| order.paid | settle purchase | event id + purchase claim + ledger key | Same as captured; later capture is settle_replay |
| subscription.authenticated | upsert subscription | event id + state machine | status authenticated, entitlement active, mandate method stored |
| subscription.activated | upsert subscription | event id + state machine | status active |
| subscription.charged | upsert subscription | event id + state machine | status active; paid_count/period advanced |
| subscription.pending | upsert subscription | event id + state machine | status pending; nextChargeAt + pre-debit window stored |
| subscription.halted | pause entitlement | event id + state machine | status halted, entitlementState paused (row retained) |
| subscription.paused | pause entitlement | event id + state machine | status paused, entitlementState paused |
| subscription.resumed | restore entitlement | event id + state machine | status active, entitlementState active, resumedAt |
| subscription.cancelled | terminal | event id + state machine | status cancelled, entitlement cancelled; stale events ignored |
| subscription.completed | terminal | event id + state machine | status completed, entitlement completed |
| refund.created | record only | event id | No ledger entry yet |
| refund.processed | compensate | event id + purchase claim + ledger key per refund id | Negative ledger rows: full once or proportional partial |
| invoice.paid | rotation + invoice | event id | Advances period; persists GST invoice row (machine-readable) |
| any other type | acknowledge | event id | ignored with unhandled_event_type_*; 200 so Razorpay stops retrying |

Unknown orders are acknowledged with 200 (retrying will never make them known), matching Stripe behaviour.

---

## 5. Idempotency proof

Two independent layers:
1. Event id: X-Razorpay-Event-Id is the PRIMARY KEY of razorpay_webhook_events. First delivery inserts processing and processes; replays get 200 duplicate. Failed deliveries are marked failed and may be reclaimed by a retry.
2. Business key: even for DIFFERENT event ids for the same order, settlement is exactly-once â€” conditional UPDATE credits_purchases pending/failed -> completed plus INSERT credits_ledger with UNIQUE idempotency_key razorpay:purchase:ORDERID in one transaction. Refunds use razorpay:refund:REFUNDID.
3. Refund-before-capture is a durable block, not an ignore: the pending purchase is marked refunded, so a later capture cannot credit (verified: settle_replay + already_refunded).

Verified by tests:
- same event id x5 -> one ledger row, one event row
- 6 concurrent duplicate deliveries -> one ledger row
- payment.captured + order.paid concurrently (different ids) -> exactly one settled + one settle_replay
- full refund replayed with same event id and with a different event id -> ledger stays at 2 rows
- checkout verify replay -> no double credit

---

## 6. Mandates, pre-debit window, halt/resume

Mandates (UPI Autopay / card e-mandate) are created through Razorpay Subscriptions (dashboard plan id + customer id + total_count). The normalized mandate method is stored (upi / card / emandate / unknown).

Pre-debit window: Razorpay mandates require notifying the customer before a debit. On subscription.pending / charged with charge_at (or current_end) the server stores:
- next_charge_at = charge time
- pre_debit_notify_at = charge time minus pre_debit_window_hours (default 24; clamped to now when overdue so ops still sees it)
- pre_debit_window_hours

Halt/resume: subscription.halted (and .paused) sets entitlementState=paused WITHOUT deleting the row or history; subscription.resumed restores entitlementState=active and sets resumedAt. The entitlement endpoint withholds features while paused and restores them on resume. Terminal states (cancelled/completed) are immutable: a stale activated/authenticated event after cancellation is ignored with reason stale_transition.

State machine: created -> authenticated -> active <-> pending/halted/paused; halted/paused -> active on resume; cancelled/completed terminal. Authenticated/activated retries cannot resurrect a halted or paused mandate.

---

## 7. Refunds (compensating ledger entries)

Refunds are created only through the Razorpay Refunds API (POST /v1/payments/:id/refund), never by editing balances:
- POST /api/razorpay/refund is ops-only: requires X-Internal-Token == RAZORPAY_INTERNAL_TOKEN (503 when unset, 401 on mismatch)
- the compensating ledger row is appended by refund.processed (webhook), or immediately when the provider already reports status=processed
- full refund: purchase completed -> refunded once; ledger delta = minus grant; invoice -> refunded
- partial refund: proportional negative ledger row per refund id (4-decimal credit math); purchase stays completed; partials accumulate
- refund before capture: durable block (purchase -> refunded, no ledger); a later capture cannot credit

Verified: full reversal once plus replay; partial rows 6, -3, -3; pre-capture block; API refund with idempotent replay.

---

## 8. GST (single source)

GSTIN capture: order/subscription requests accept gstin; it is normalized, checksum-validated (mod-36) and rejected when invalid (400). The state code is the first two digits.

Single source: lib/razorpayGst.ts computeGst() is the only place tax is computed. Routes persist exactly its output into billing_invoices (subtotal, tax, CGST/SGST/IGST, tax type, rate, place of supply, GSTIN) and the API returns the same breakdown:
- Default prices are GST-inclusive: the total is the advertised paise amount; taxable value and tax are extracted (no hidden price increase).
- Intra-state (supplier state equals place of supply): CGST + SGST. Inter-state: IGST.
- Exclusive (B2B) mode: RAZORPAY_GST_INCLUSIVE=0.
- Odd paise never lost: subtotal + tax equals total; CGST + SGST equals tax.
- Verified GSTINs: 27AAPFU0939F1ZV (valid, intra-state), 29AAGCB7383J1Z4 (valid, IGST vs supplier 27), bad checksum rejected.

DEFERRED: human-readable/PDF GST invoice rendering. No PDF invoice generator is wired for invoices; machine-readable invoice rows and the API breakdown are implemented and tested, and no money logic depends on rendering. Reason: out of this task scope and no invoice PDF renderer exists in the repo.

---

## 9. Plan mapping (Stripe and Razorpay equivalence)

Single canonical table (lib/razorpayPlans.ts) consumed by both gateways; Stripe products use the same codes. A plan grants identical entitlements regardless of gateway by construction.

| Plan code | Kind | Credits | Interval | INR paise | USD cents | Razorpay plan env |
|---|---|---|---|---|---|---|
| credit_1 | credits | 1 | none | 236000 | 2500 | none (one-time order) |
| credit_3 | credits | 3 | none | 369000 | 3900 | none |
| credit_6 | credits | 6 | none | 738000 | 7800 | none |
| credit_9 | credits | 9 | none | 1107000 | 11700 | none |
| subscription_weekly | subscription | 0 | week | 498000 | 5200 | RAZORPAY_PLAN_SUBSCRIPTION_WEEKLY |
| subscription_monthly | subscription | 0 | month | 947000 | 9990 | RAZORPAY_PLAN_SUBSCRIPTION_MONTHLY |
| subscription_yearly | subscription | 0 | year | 3790000 | 39990 | RAZORPAY_PLAN_SUBSCRIPTION_YEARLY |
| prepaid_yearly | plan | 0 | none | 3790000 | 39990 | none |
| lifetime_plan | plan | 0 | none | 5685000 | 59990 | none |

Entitlements: subscriptions grant premium_sessions, all_models, priority_support; credit packs grant credit_pack; prepaid/lifetime add prepaid/lifetime flags. Unit tests assert every canonical row matches STRIPE_CATALOG (code, kind, credits, interval, USD, INR) and that entitlements come from this single table.

Issuing gateway is stored on billing_subscriptions.gateway (and credits_purchases.metadata.provider). POST /api/razorpay/subscription/cancel routes by gateway: Razorpay-issued subscriptions cancel via the Razorpay API; Stripe-issued rows return 409 GATEWAY_MANAGED_ELSEWHERE so Stripe proration/tax stay authoritative.

Note: RAZORPAY_PLAN_* ids are dashboard-created, so the dashboard plan amount must stay in sync with this table. Local invoices/entitlements use this table; the gateway charges its own plan amount.

---

## 10. API reference

| Route | Auth | Purpose |
|---|---|---|
| GET /api/razorpay/config | public | mode, public key id, webhook-secret presence/source, pre-debit window, GST config (no secrets) |
| GET /api/razorpay/plans | public | canonical plan table + Razorpay dashboard plan readiness |
| POST /api/razorpay/order | user | server-priced one-time order (paise/INR) + GST invoice row |
| POST /api/razorpay/subscription | user | mandate subscription via dashboard plan id + customer + GST |
| POST /api/razorpay/checkout/verify | user | checkout HMAC verification + idempotent settlement |
| POST /api/razorpay/webhook | Razorpay | raw-body HMAC + X-Razorpay-Event-Id idempotency |
| GET /api/razorpay/entitlement | user | gateway-neutral entitlement incl. paused mandates and pre-debit due time |
| POST /api/razorpay/subscription/cancel | user | routes management/cancel to the issuing gateway |
| POST /api/razorpay/refund | internal token | ops refund through the Refunds API + compensating ledger |

Legacy routes in routes/credits.ts (purchase/order, purchase/verify, webhook/razorpay) stay untouched for backward compatibility; both settlement paths share the same purchase claim and ledger idempotency keys, so no purchase can be credited twice.

---

## 11. Files

New:
- artifacts/api-server/src/lib/razorpay.ts (rewritten: config, dual signatures, orders/customers/subscriptions/refunds, mock)
- artifacts/api-server/src/lib/razorpayPlans.ts (plan mapping, entitlements, state machine, pre-debit window)
- artifacts/api-server/src/lib/razorpayGst.ts (single-source GST)
- artifacts/api-server/src/lib/razorpayWebhook.ts (event idempotency, settlement, mandates, refunds, invoices)
- artifacts/api-server/src/routes/razorpay.ts (routes above)
- artifacts/api-server/tests/razorpay.unit.test.ts (45)
- artifacts/api-server/tests/razorpay.integration.test.ts (39)
- docs/RAZORPAY.md and docs/evidence/razorpay/

Modified (minimal, reported):
- lib/db/src/schema/index.ts: 3 NEW tables (razorpay_webhook_events, billing_subscriptions, billing_invoices); no existing table altered
- artifacts/api-server/src/routes/index.ts: 2 lines to register /api/razorpay
- artifacts/api-server/src/app.ts: 3 lines of express.raw for /api/razorpay/webhook before express.json

---

## 12. Limits / not exercised here

- Real api.razorpay.com calls were NOT exercised (no live/test keys here). The REST adapter is covered by unit tests with an injected fetch asserting exact URLs, Basic auth, JSON bodies and error mapping; DB integration tests run in deterministic mock mode with REAL HMAC signatures.
- Client-side Razorpay Checkout JS / Tauri window wiring is not part of this server change: the server returns orderId/keyId/subscription short_url and verifies the callback.
- Subscription plans grant feature entitlements, not credits. invoice.paid advances periods and persists invoices; credit-granting subscription plans can reuse the ledger path but are not enabled by the current mapping.
- GST invoices are machine-readable rows plus API breakdown; PDF rendering is DEFERRED (section 8).
- Razorpay chargebacks/disputes are not handled (no event mapped); out of scope.

---

## 13. Reproduce

One-time DB setup (never touches hireshade_dev):

    docker exec -e PGPASSWORD=POSTGRES_PW hireshade-postgres psql -U hireshade_dev -d hireshade_dev -c "CREATE DATABASE hireshade_razorpay_test"
    DATABASE_URL=postgresql://hireshade_dev:POSTGRES_PW@localhost:5433/hireshade_razorpay_test
    pnpm --filter @workspace/db run push-force

Tests:

    POSTGRES_PASSWORD=POSTGRES_PW
    pnpm --dir artifacts/api-server exec vitest run tests/razorpay.unit.test.ts tests/razorpay.integration.test.ts
    -> 2 files, 84/84 passed

    pnpm --dir artifacts/api-server exec vitest run tests/stripe.unit.test.ts tests/stripe.integration.test.ts
    -> 2 files, 70/70 passed (no regression)

    pnpm --dir artifacts/api-server exec vitest run --exclude "**/sessions.integration.test.ts" --exclude "**/stripe.integration.test.ts" --exclude "**/razorpay.integration.test.ts"
    -> 34 files, 262/262 passed

    pnpm --filter @workspace/api-server run typecheck   -> exit 0
    pnpm --dir artifacts/api-server run build           -> exit 0

Full logs: docs/evidence/razorpay/01-razorpay-tests.txt, 02-stripe-regression.txt, 03-api-unit-suite.txt, 04-build.txt, 05-typecheck-libs.txt, 06-typecheck-full.txt, 07-typecheck-scoped.txt.

