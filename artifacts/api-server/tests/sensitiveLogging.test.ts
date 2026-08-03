import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../src", file), "utf8");

describe("sensitive server logging", () => {
  it("does not log interview question text", () => {
    const sessions = src("routes/sessions.ts");
    expect(sessions).not.toContain("detectedQuestion:");
    expect(sessions).not.toContain("previousQuestion:");
    expect(sessions).not.toContain("answeredQuestionHash:");
    expect(sessions).not.toContain("JSON.stringify(question.slice");
  });

  it("does not log external authentication provider response bodies", () => {
    const auth = src("routes/auth.ts");
    expect(auth).not.toContain("await mintRes.text()");
    expect(auth).not.toContain("await clerkRes.text()");
  });

  it("does not log payment order identifiers", () => {
    const purchase = src("lib/purchaseCredit.ts");
    const credits = src("routes/credits.ts");
    expect(purchase).not.toContain("orderId: opts.orderId");
    expect(credits).not.toContain('"[credits] webhook for unknown order", orderId');
  });
});
