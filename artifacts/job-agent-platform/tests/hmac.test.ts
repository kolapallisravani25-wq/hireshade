import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../src/lib/security/hmac";

describe("webhook signatures", () => {
  it("accepts a matching signature and rejects a modified payload", () => {
    const signature = signPayload("payload", "secret");
    expect(verifySignature("payload", signature, "secret")).toBe(true);
    expect(verifySignature("changed", signature, "secret")).toBe(false);
  });
});
