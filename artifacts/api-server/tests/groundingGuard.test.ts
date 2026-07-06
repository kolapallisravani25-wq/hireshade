import { describe, it, expect } from "vitest";
import { detectUnsupportedClaims } from "../src/lib/groundingGuard.js";

describe("detectUnsupportedClaims", () => {
  it("flags an employer name that is not in the grounding context", () => {
    const findings = detectUnsupportedClaims(
      "At Hilton I built the data pipeline.",
      "Resume: Senior Data Engineer working on Spark pipelines.",
    );
    expect(findings.some((f) => f.type === "employer" && f.value === "hilton")).toBe(true);
  });

  it("does NOT flag an employer name that IS present in the context", () => {
    const findings = detectUnsupportedClaims(
      "At Amazon I led the ingestion service.",
      "Resume: Worked at Amazon as a backend engineer for 3 years.",
    );
    expect(findings.some((f) => f.type === "employer")).toBe(false);
  });

  it("flags fabricated metrics (percentages, data volume, durations)", () => {
    const findings = detectUnsupportedClaims(
      "I improved uptime to 99.9% and processed 1TB+ of data over 438 days.",
      "Resume: built ETL jobs on Databricks.",
    );
    const metrics = findings.filter((f) => f.type === "metric").map((f) => f.value.toLowerCase());
    expect(metrics.join(" ")).toMatch(/99\.9/);
    expect(metrics.join(" ")).toMatch(/1tb/);
    expect(metrics.join(" ")).toMatch(/438/);
  });

  it("does NOT flag a metric that appears verbatim in the context", () => {
    const findings = detectUnsupportedClaims(
      "I reduced latency by 40%.",
      "Project: optimization reduced query latency by 40% in production.",
    );
    expect(findings.some((f) => f.type === "metric")).toBe(false);
  });

  it("returns no findings for a grounded, qualitative answer", () => {
    const findings = detectUnsupportedClaims(
      "In my most recent role I significantly reduced deployment time by streamlining the CI pipeline.",
      "Resume: DevOps engineer, improved CI/CD.",
    );
    expect(findings).toHaveLength(0);
  });

  it("handles empty answer safely", () => {
    expect(detectUnsupportedClaims("", "some context")).toHaveLength(0);
  });
});
