import { describe, expect, it } from "vitest";
import { hasExpectedFileSignature } from "../src/lib/uploadValidation.js";

describe("hasExpectedFileSignature", () => {
  it("accepts supported document signatures", () => {
    expect(hasExpectedFileSignature(Buffer.from("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(
      hasExpectedFileSignature(
        Buffer.from("d0cf11e0a1b11ae1", "hex"),
        "application/msword",
      ),
    ).toBe(true);
    expect(
      hasExpectedFileSignature(
        Buffer.from("504b0304", "hex"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("accepts supported screenshot signatures", () => {
    expect(hasExpectedFileSignature(Buffer.from("89504e470d0a1a0a", "hex"), "image/png")).toBe(true);
    expect(hasExpectedFileSignature(Buffer.from("ffd8ff", "hex"), "image/jpeg")).toBe(true);
    expect(
      hasExpectedFileSignature(Buffer.from("524946460000000057454250", "hex"), "image/webp"),
    ).toBe(true);
  });

  it("rejects spoofed, mismatched, and unknown content", () => {
    expect(hasExpectedFileSignature(Buffer.from("not a pdf"), "application/pdf")).toBe(false);
    expect(hasExpectedFileSignature(Buffer.from("89504e470d0a1a0a", "hex"), "image/jpeg")).toBe(false);
    expect(hasExpectedFileSignature(Buffer.from("GIF89a"), "image/gif")).toBe(false);
  });
});
