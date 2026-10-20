import { describe, expect, it } from "vitest";
import {
  DemoModeError,
  assertDemoModeSafe,
  describeDemoMode,
  isDemoModeRequested,
  isDemoModeSafe,
  isProduction,
  resolveProviderMode,
} from "./demoMode.js";

const DEMO_ENV = { DEMO_MODE: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv;

describe("demoMode", () => {
  it("treats only NODE_ENV=production as production (case-insensitive)", () => {
    expect(isProduction({ ...DEMO_ENV, NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ ...DEMO_ENV, NODE_ENV: "Production" })).toBe(true);
    expect(isProduction({ ...DEMO_ENV, NODE_ENV: "development" })).toBe(false);
    expect(isProduction({})).toBe(false);
  });

  it("parses DEMO_MODE truthy spellings", () => {
    expect(isDemoModeRequested({ DEMO_MODE: "1" })).toBe(true);
    expect(isDemoModeRequested({ DEMO_MODE: "true" })).toBe(true);
    expect(isDemoModeRequested({ DEMO_MODE: "YES" })).toBe(true);
    expect(isDemoModeRequested({ DEMO_MODE: "0" })).toBe(false);
    expect(isDemoModeRequested({})).toBe(false);
  });

  it("fails closed when DEMO_MODE is not requested", () => {
    expect(() => assertDemoModeSafe({})).toThrow(DemoModeError);
    expect(isDemoModeSafe({})).toBe(false);
    expect(resolveProviderMode({})).toBe("real");
  });

  it("fails closed when DEMO_MODE is set in production", () => {
    const env = { DEMO_MODE: "1", NODE_ENV: "production" };
    expect(() => assertDemoModeSafe(env)).toThrow(DemoModeError);
    expect(() => assertDemoModeSafe(env)).toThrow(/production/);
    expect(isDemoModeSafe(env)).toBe(false);
    expect(() => resolveProviderMode(env)).toThrow(DemoModeError);
  });

  it("allows demo mode in every non-production environment", () => {
    for (const nodeEnv of ["development", "test", "demo", ""]) {
      const env = { DEMO_MODE: "1", NODE_ENV: nodeEnv };
      expect(() => assertDemoModeSafe(env)).not.toThrow();
      expect(resolveProviderMode(env)).toBe("mock");
    }
  });

  it("describes the effective mode for evidence/status output", () => {
    expect(describeDemoMode(DEMO_ENV)).toMatchObject({
      requested: true,
      safe: true,
      production: false,
      mode: "mock",
    });
    expect(describeDemoMode({}).mode).toBe("real");
    const prod = describeDemoMode({ DEMO_MODE: "1", NODE_ENV: "production" });
    expect(prod).toMatchObject({ requested: true, safe: false, mode: "real" });
    expect(prod.reason).toMatch(/production/);
  });
});
