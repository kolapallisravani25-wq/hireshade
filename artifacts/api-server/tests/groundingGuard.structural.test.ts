import { describe, it, expect } from "vitest";
import { detectUnsupportedClaims, auditAnswerGrounding } from "../src/lib/groundingGuard.js";

/**
 * These tests prove the guard is a GENERIC structural backstop, not a blacklist.
 * They replay the exact fabrication classes from the production transcript
 * (fake client industry, fake data volume, fake percentage, fake artifact count)
 * against an empty/thin context — none of these specific values were ever in a
 * blacklist, yet all must be flagged by structure.
 */
describe("detectUnsupportedClaims — structural fabrication (transcript replay)", () => {
  const THIN_CONTEXT = "Resume: Data Engineer. Skills: Spark, Azure, SQL."; // no client, no numbers

  it("flags an invented client industry descriptor", () => {
    const findings = detectUnsupportedClaims(
      "I worked with a large hospitality operations client on their data platform.",
      THIN_CONTEXT,
    );
    expect(findings.some((f) => f.type === "industry")).toBe(true);
  });

  it("flags several invented industry verticals generically", () => {
    for (const phrase of [
      "for a leading healthcare company",
      "at a major retail client",
      "a global banking customer",
      "an insurance domain project",
    ]) {
      const findings = detectUnsupportedClaims(
        `I delivered a pipeline ${phrase}.`,
        THIN_CONTEXT,
      );
      expect(findings.some((f) => f.type === "industry"), `expected "${phrase}" flagged`).toBe(true);
    }
  });

  it("flags an invented data-volume claim (1TB+ daily)", () => {
    const findings = detectUnsupportedClaims(
      "We were processing over 1TB of data daily across their properties.",
      THIN_CONTEXT,
    );
    expect(findings.some((f) => f.type === "metric" && /tb/i.test(f.value))).toBe(true);
  });

  it("flags an invented percentage (reduced query time by 30%)", () => {
    const findings = detectUnsupportedClaims(
      "I reduced query execution time by 30% through advanced partitioning.",
      THIN_CONTEXT,
    );
    expect(findings.some((f) => f.type === "metric" && /30/.test(f.value))).toBe(true);
  });

  it("flags an invented artifact count (20+ PySpark transformations)", () => {
    const findings = detectUnsupportedClaims(
      "We developed 20+ optimized PySpark transformations for the medallion layers.",
      THIN_CONTEXT,
    );
    expect(findings.some((f) => f.type === "count")).toBe(true);
  });

  it("flags a variety of artifact counts generically", () => {
    for (const phrase of ["15 microservices", "10 data pipelines", "8 dashboards", "12 REST APIs"]) {
      const findings = detectUnsupportedClaims(`I built ${phrase}.`, THIN_CONTEXT);
      expect(findings.some((f) => f.type === "count"), `expected "${phrase}" flagged`).toBe(true);
    }
  });

  it("flags the full transcript-style fabricated case study in one pass", () => {
    const fabricated =
      "For a large hospitality operations client we processed over 1TB of data daily. " +
      "I developed 20+ optimized PySpark transformations and reduced query execution time by 30%.";
    const findings = detectUnsupportedClaims(fabricated, THIN_CONTEXT);
    const types = new Set(findings.map((f) => f.type));
    expect(types.has("industry")).toBe(true);
    expect(types.has("metric")).toBe(true);
    expect(types.has("count")).toBe(true);
  });
});

describe("detectUnsupportedClaims — does NOT flag grounded specifics", () => {
  it("does not flag an industry that IS in the context", () => {
    const findings = detectUnsupportedClaims(
      "I worked with a hospitality client on occupancy analytics.",
      "Resume: 4 years serving a hospitality client, building occupancy dashboards.",
    );
    expect(findings.some((f) => f.type === "industry")).toBe(false);
  });

  it("does not flag a count that IS in the context", () => {
    const findings = detectUnsupportedClaims(
      "I built 12 pipelines.",
      "Project: owned 12 pipelines end to end.",
    );
    expect(findings.some((f) => f.type === "count")).toBe(false);
  });

  it("does not flag a percentage that IS in the context", () => {
    const findings = detectUnsupportedClaims(
      "I reduced latency by 40%.",
      "Project: reduced query latency by 40% in production.",
    );
    expect(findings.some((f) => f.type === "metric")).toBe(false);
  });

  it("stays quiet on an honest generic answer with no invented specifics", () => {
    const generic =
      "In my recent work I migrated on-prem data sources into a cloud data platform — " +
      "I'd land raw data, clean it in staged layers, model it for analytics, and add data-quality checks.";
    const findings = detectUnsupportedClaims(generic, THIN_CONTEXT_EMPTY);
    expect(findings).toHaveLength(0);
  });
});

const THIN_CONTEXT_EMPTY = "";

describe("auditAnswerGrounding — structured logging", () => {
  it("buckets findings by type and calls the provided logger", () => {
    let captured: Record<string, unknown> | null = null;
    const findings = auditAnswerGrounding({
      sessionId: "sess-1",
      answer:
        "For a large hospitality client I built 20+ pipelines and cut runtime by 30% over 438 days.",
      context: "Resume: data engineer.",
      log: (_msg, meta) => {
        captured = meta;
      },
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(captured).not.toBeNull();
    const meta = captured as unknown as Record<string, string[]>;
    expect(meta["unsupportedIndustries"]!.length).toBeGreaterThan(0);
    expect(meta["unsupportedCounts"]!.length).toBeGreaterThan(0);
    expect(meta["unsupportedMetrics"]!.length).toBeGreaterThan(0);
  });
});
