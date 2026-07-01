/**
 * useUserCurrency
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the resolved billing currency.
 *
 * Design goals:
 *   • Zero flicker — value is resolved synchronously via a lazy useState
 *     initializer so it is available on the FIRST render (no async update).
 *   • SSR-safe — wraps all DOM/localStorage access in try-catch.
 *   • Tauri-safe — works inside WKWebView where window === globalThis.
 *   • No network call — falls back to timezone → locale → USD.
 *
 * The returned `currency` is the ONLY currency the user should see.
 * No UI should offer a switcher — show pricing only for this value.
 */
import { useState } from "react";
import {
  detectUserCurrency,
  type SupportedCurrency,
} from "@/lib/userCurrency";

export type { SupportedCurrency };

interface UseUserCurrencyResult {
  /** The resolved billing currency for this user — immutable after mount. */
  currency: SupportedCurrency;
}

/**
 * Resolves and returns the billing currency for the current user.
 *
 * The lazy initializer pattern (`useState(() => fn())`) guarantees the value
 * is computed exactly once, synchronously, before the first render. This
 * prevents the "flash of wrong currency" that would occur with useEffect.
 *
 * Usage:
 * ```tsx
 * const { currency } = useUserCurrency();
 * // currency is always "INR" | "USD" | "GBP" — never undefined
 * ```
 */
export function useUserCurrency(): UseUserCurrencyResult {
  // Lazy initializer: runs once synchronously before first render.
  // detectUserCurrency() is safe to call here — it only touches localStorage
  // and Intl/navigator APIs, all of which exist in Tauri's WKWebView.
  const [currency] = useState<SupportedCurrency>(() => detectUserCurrency());
  return { currency };
}
