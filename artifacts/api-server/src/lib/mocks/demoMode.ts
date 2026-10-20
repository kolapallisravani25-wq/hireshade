/**
 * DEMO_MODE gate (G-001).
 *
 * Contract: mock providers are reachable ONLY when `DEMO_MODE` is on AND
 * `NODE_ENV !== "production"`. This fails closed twice:
 *   1. mocks refuse to construct without the explicit DEMO_MODE flag, so a
 *      production deployment cannot silently fall back to fake answers;
 *   2. even with DEMO_MODE=1, NODE_ENV=production always throws.
 *
 * The check never reads provider keys, so it is safe to run with an empty env.
 */

export class DemoModeError extends Error {
  readonly code = "demo_mode_disabled";
  constructor(message: string) {
    super(message);
    this.name = "DemoModeError";
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? "").trim();
}

/** True when NODE_ENV is exactly "production" (case-insensitive). */
export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return envValue(env, "NODE_ENV").toLowerCase() === "production";
}

/** True when the operator asked for demo mode (DEMO_MODE=1|true|yes). */
export function isDemoModeRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = envValue(env, "DEMO_MODE").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Enforces the demo-mode contract. Throws DemoModeError when demo mode was not
 * requested or when it is requested in production. This is the single gate all
 * mock adapters and demo routes call before doing anything.
 */
export function assertDemoModeSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (!isDemoModeRequested(env)) {
    throw new DemoModeError(
      "DEMO_MODE is not enabled. Mock providers require DEMO_MODE=1 (they are never an implicit fallback).",
    );
  }
  if (isProduction(env)) {
    throw new DemoModeError(
      "DEMO_MODE is forbidden when NODE_ENV=production. Mock providers must never serve a production deployment.",
    );
  }
}

/** Non-throwing variant for route guards / status endpoints. */
export function isDemoModeSafe(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    assertDemoModeSafe(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves which provider set to construct:
 *  - "mock" when DEMO_MODE is on and safe (throws in production),
 *  - "real" otherwise (existing key-gated behaviour is unchanged).
 */
export function resolveProviderMode(env: NodeJS.ProcessEnv = process.env): "mock" | "real" {
  if (!isDemoModeRequested(env)) return "real";
  assertDemoModeSafe(env);
  return "mock";
}

/** Snapshot of demo-mode state for evidence files and /demo/status. */
export function describeDemoMode(env: NodeJS.ProcessEnv = process.env): {
  requested: boolean;
  safe: boolean;
  production: boolean;
  nodeEnv: string | null;
  mode: "mock" | "real";
  reason: string;
} {
  const requested = isDemoModeRequested(env);
  const production = isProduction(env);
  const safe = isDemoModeSafe(env);
  let reason: string;
  if (!requested) reason = "DEMO_MODE not set; using real providers";
  else if (production) reason = "DEMO_MODE rejected because NODE_ENV=production";
  else reason = "DEMO_MODE accepted (non-production); mock providers active";
  return {
    requested,
    safe,
    production,
    nodeEnv: env["NODE_ENV"] ?? null,
    mode: requested && safe ? "mock" : "real",
    reason,
  };
}
