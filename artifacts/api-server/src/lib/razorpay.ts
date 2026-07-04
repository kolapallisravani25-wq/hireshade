/**
 * Razorpay Orders API client.
 *
 * The previous purchase flow fabricated a local `order_<uuid>` id and never
 * contacted Razorpay — but Razorpay Checkout requires a REAL order id created
 * server-side via the Orders API, so legitimate purchases could never
 * complete. This client creates the real order (payment_capture: 1 so a
 * successful checkout auto-captures) using Basic auth with the key pair.
 */

export class RazorpayNotConfiguredError extends Error {
  constructor() {
    super("Razorpay is not configured");
  }
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export function getRazorpayKeyId(): string | undefined {
  return process.env["RAZORPAY_KEY_ID"] || undefined;
}

export async function createRazorpayOrder(opts: {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) throw new RazorpayNotConfiguredError();

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: opts.amountMinor,
      currency: opts.currency,
      receipt: opts.receipt.slice(0, 40),
      payment_capture: 1,
      notes: opts.notes ?? {},
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Razorpay order creation failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as RazorpayOrder;
}
