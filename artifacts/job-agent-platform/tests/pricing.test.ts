import { describe, expect, it } from "vitest";
import { formatMoney, plans } from "../src/lib/billing/pricing";

describe("regional pricing", () => {
  it("defines INR, USD and EUR for every plan", () => {
    for (const plan of plans) expect(Object.keys(plan.monthly).sort()).toEqual(["EUR", "INR", "USD"]);
  });

  it("formats minor units without floating point pricing storage", () => {
    expect(formatMoney(1900, "USD")).toContain("19.00");
    expect(formatMoney(1799, "EUR")).toContain("17.99");
  });
});
