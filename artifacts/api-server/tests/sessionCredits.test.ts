import { describe, it, expect, beforeAll } from "vitest";

// sessionCredits.ts imports @workspace/db at module load, which throws unless
// DATABASE_URL is set. A pg Pool is lazy (it only connects on the first query),
// so a dummy URL lets us exercise the PURE metering helpers without a real DB.
process.env["DATABASE_URL"] ||= "postgres://test:test@localhost:5432/test";

let elapsedMinutes: (startedAt: Date | null, endedAt: Date) => number;
let isTerminalStatus: (status: string) => boolean;

beforeAll(async () => {
  const mod = await import("../src/lib/sessionCredits.js");
  elapsedMinutes = mod.elapsedMinutes;
  isTerminalStatus = mod.isTerminalStatus;
});

describe("elapsedMinutes", () => {
  it("returns 0 when the session never started", () => {
    expect(elapsedMinutes(null, new Date())).toBe(0);
  });

  it("returns 0 for a non-positive interval (clock skew / equal times)", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(elapsedMinutes(t, t)).toBe(0);
    expect(elapsedMinutes(new Date("2026-01-01T00:05:00Z"), t)).toBe(0);
  });

  it("ceils partial minutes to whole billable minutes", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    // 1 second in → still bills a full minute.
    expect(elapsedMinutes(start, new Date("2026-01-01T00:00:01Z"))).toBe(1);
    // 61 seconds → rolls into the second minute.
    expect(elapsedMinutes(start, new Date("2026-01-01T00:01:01Z"))).toBe(2);
  });

  it("counts exact minute boundaries without over-billing", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(elapsedMinutes(start, new Date("2026-01-01T00:01:00Z"))).toBe(1);
    expect(elapsedMinutes(start, new Date("2026-01-01T00:10:00Z"))).toBe(10);
  });
});

describe("isTerminalStatus", () => {
  it("treats every settled status as terminal", () => {
    for (const s of [
      "COMPLETED",
      "CREDIT_EXHAUSTED",
      "AUTO_ENDED",
      "FORCE_ENDED",
      "ABANDONED",
    ]) {
      expect(isTerminalStatus(s)).toBe(true);
    }
  });

  it("treats live/in-flight statuses as non-terminal (re-activatable)", () => {
    for (const s of ["ACTIVE", "PRE_CHECK", "COMPLETING", "DISCONNECTED", ""]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});
