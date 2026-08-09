import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireGenerationLock,
  releaseGenerationLock,
  isGenerationLocked,
} from "../src/lib/sessionGenerationLock.js";

const SESSION_A = "session-a";
const SESSION_B = "session-b";

beforeEach(() => {
  // Locks are process-global module state; reset between tests.
  releaseGenerationLock(SESSION_A);
  releaseGenerationLock(SESSION_B);
});

describe("acquireGenerationLock / releaseGenerationLock", () => {
  it("1. two concurrent generation calls for the same session do not both proceed", () => {
    const first = acquireGenerationLock(SESSION_A);
    const second = acquireGenerationLock(SESSION_A); // simulates a racing request
    expect(first).toBe(true);
    expect(second).toBe(false); // must be rejected, not allowed to reach generation
  });

  it("2. lock releases after success, allowing the next request", async () => {
    expect(acquireGenerationLock(SESSION_A)).toBe(true);
    // simulate the route handler's success path
    await Promise.resolve("mock generation result");
    releaseGenerationLock(SESSION_A);
    expect(isGenerationLocked(SESSION_A)).toBe(false);
    expect(acquireGenerationLock(SESSION_A)).toBe(true);
  });

  it("3. lock releases after a thrown error (try/finally semantics)", async () => {
    expect(acquireGenerationLock(SESSION_A)).toBe(true);
    const simulateHandler = async () => {
      try {
        throw new Error("simulated provider failure mid-stream");
      } finally {
        releaseGenerationLock(SESSION_A);
      }
    };
    await expect(simulateHandler()).rejects.toThrow("simulated provider failure mid-stream");
    expect(isGenerationLocked(SESSION_A)).toBe(false);
  });

  it("4. a later request works after release", () => {
    expect(acquireGenerationLock(SESSION_A)).toBe(true);
    releaseGenerationLock(SESSION_A);
    expect(acquireGenerationLock(SESSION_A)).toBe(true); // new request, clean acquire
    releaseGenerationLock(SESSION_A);
  });

  it("does not block unrelated sessions (lock is per-session, not global)", () => {
    expect(acquireGenerationLock(SESSION_A)).toBe(true);
    expect(acquireGenerationLock(SESSION_B)).toBe(true); // different session, unaffected
    releaseGenerationLock(SESSION_A);
    releaseGenerationLock(SESSION_B);
  });

  it("releasing an unlocked or unknown session is a safe no-op", () => {
    expect(() => releaseGenerationLock("never-locked-session")).not.toThrow();
    expect(isGenerationLocked("never-locked-session")).toBe(false);
  });
});
