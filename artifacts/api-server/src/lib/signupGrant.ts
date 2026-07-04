/**
 * Signup credit grant — canonical value from the ScribeShade Pricing &
 * Credits document (Apr 25, 2026): "Free Tier (signup): 3 credits".
 *
 * Used everywhere a balance row is seeded or a missing row is interpreted
 * (requireAuth first-login seed, /credits/balance default, session
 * settlement's legacy-user fallback, purchase crediting's missing-row seed).
 * The previous scattered hardcoded value was 100 — a dev-era default that
 * would have given every new user 200 free session minutes.
 */
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export const SIGNUP_CREDITS = envNum("SIGNUP_CREDITS", 3);
