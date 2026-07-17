import { createHmac, timingSafeEqual } from "node:crypto";

export function signPayload(payload: string, secret: string): string {
  if (!secret) throw new Error("Signing secret is required");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signPayload(payload, secret), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
