import { describe, it, expect } from "vitest";
import { detectUnsupportedClaims } from "../src/lib/groundingGuard.js";

describe("detectUnsupportedClaims — extended employer/metric coverage", () => {
  it("flags common Indian IT employers that models love to invent", () => {
    for (const employer of ["Infosys", "TCS", "Wipro", "HCL", "Tech Mahindra", "Cognizant"]) {
      const findings = detectUnsupportedClaims(
        `During my time at ${employer} I owned the migration.`,
        "Resume: backend engineer building payment services.",
      );
      expect(
        findings.some((f) => f.type === "employer"),
        `expected ${employer} to be flagged`,
      ).toBe(true);
    }
  });

  it("flags fabricated scale metrics like '5 million users' / '10k requests'", () => {
    const findings = detectUnsupportedClaims(
      "I built a system serving 5 million users and 10k requests per second.",
      "Resume: worked on a web application.",
    );
    const metrics = findings.filter((f) => f.type === "metric").map((f) => f.value.toLowerCase());
    expect(metrics.join(" ")).toMatch(/5\s?million/);
    expect(metrics.join(" ")).toMatch(/10k/);
  });

  it("does not flag scale figures that are present in the grounding context", () => {
    const findings = detectUnsupportedClaims(
      "The platform served 5 million users.",
      "Project summary: the platform served 5 million users at peak.",
    );
    expect(findings.some((f) => f.type === "metric")).toBe(false);
  });

  it("stays quiet on a grounded, qualitative answer with no numbers or brands", () => {
    const findings = detectUnsupportedClaims(
      "On a recent project I significantly improved throughput by tuning the query layer.",
      "Resume: data engineer focused on query optimization.",
    );
    expect(findings).toHaveLength(0);
  });
});
