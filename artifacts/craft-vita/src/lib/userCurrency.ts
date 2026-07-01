/**
 * userCurrency.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight, dependency-free currency detection for the credit-purchase flow.
 *
 * Picks one of the supported billing currencies (INR / USD / GBP) based on the
 * browser's locale + IANA timezone — no network calls, no IP geolocation.
 *
 * Resolution order:
 *   1. Cached value in localStorage (so the user's manual override sticks).
 *   2. Mapping from `Intl.DateTimeFormat().resolvedOptions().timeZone` →
 *      country → currency.  This is the most reliable signal because the OS
 *      sets the timezone and it survives Tauri's webview.
 *   3. Mapping from `navigator.language` region (`en-IN`, `en-GB`, `en-US`,
 *      `hi-IN`, etc.) → currency.
 *   4. Fallback: USD (broadest default for non-IN / non-GB users).
 */

export type SupportedCurrency = "INR" | "USD" | "GBP";

const STORAGE_KEY = "hireshade.user.currency";

// ── Country → currency ──────────────────────────────────────────────────────
const COUNTRY_TO_CURRENCY: Record<string, SupportedCurrency> = {
  IN: "INR",
  GB: "GBP",
  UK: "GBP", // some locales use "UK"
  US: "USD",
};

// ── Timezone → country (only entries we care about) ─────────────────────────
const TIMEZONE_TO_COUNTRY: Record<string, string> = {
  // India
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  // United Kingdom
  "Europe/London": "GB",
  "Europe/Belfast": "GB",
  "Europe/Guernsey": "GB",
  "Europe/Isle_of_Man": "GB",
  "Europe/Jersey": "GB",
};

/**
 * Read only an *explicitly user-chosen* currency from localStorage.
 * Values written by the old code that defaulted to "INR" (before auto-detect
 * existed) are treated as stale and ignored — they lack the marker key
 * "hireshade.user.currency.explicit".
 */
function readCache(): SupportedCurrency | null {
  try {
    const explicit = localStorage.getItem(STORAGE_KEY + ".explicit");
    if (explicit !== "1") return null; // not a conscious user choice
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "INR" || v === "USD" || v === "GBP") return v;
  } catch {
    /* ignore — non-DOM contexts */
  }
  return null;
}

function fromTimezone(): SupportedCurrency | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return null;
    const country = TIMEZONE_TO_COUNTRY[tz];
    if (country) return COUNTRY_TO_CURRENCY[country] ?? null;
    // Heuristic: any "Asia/*" zone outside India still leans USD; any
    // "Europe/*" outside GB also leans USD.  We only special-case IN/GB.
    if (tz.startsWith("America/")) return "USD";
  } catch {
    /* ignore */
  }
  return null;
}

function fromNavigator(): SupportedCurrency | null {
  if (typeof navigator === "undefined") return null;
  const langs: string[] = [];
  if (navigator.language) langs.push(navigator.language);
  if (Array.isArray(navigator.languages)) langs.push(...navigator.languages);

  for (const lang of langs) {
    // Normalise e.g. "en-IN" / "hi-IN" / "en_GB" / "en-GB-oxendict"
    const region = lang.split(/[-_]/)[1]?.toUpperCase();
    if (!region) continue;
    const cur = COUNTRY_TO_CURRENCY[region];
    if (cur) return cur;
  }
  return null;
}

/**
 * Detect the user's preferred billing currency.
 *
 * Pure function — safe to call during render.  Result is memoised in
 * localStorage so subsequent calls (and reloads) are O(1) and consistent.
 */
export function detectUserCurrency(): SupportedCurrency {
  const cached = readCache();
  if (cached) return cached;

  const detected = fromTimezone() ?? fromNavigator() ?? "USD";

  try {
    localStorage.setItem(STORAGE_KEY, detected);
  } catch {
    /* ignore */
  }
  return detected;
}

/**
 * Persist a user-selected currency so it overrides auto-detection on the next
 * load.  Call this from any UI control that lets the user switch currency.
 */
export function setUserCurrency(currency: SupportedCurrency): void {
  try {
    localStorage.setItem(STORAGE_KEY, currency);
    // Mark as an explicit user choice so readCache() trusts it on next load.
    localStorage.setItem(STORAGE_KEY + ".explicit", "1");
  } catch {
    /* ignore */
  }
}

// ── Display helpers ─────────────────────────────────────────────────────────

export const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  INR: "₹",
  USD: "$",
  GBP: "£",
};

export const CURRENCY_FLAGS: Record<SupportedCurrency, string> = {
  INR: "🇮🇳",
  USD: "🇺🇸",
  GBP: "🇬🇧",
};

export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  INR: "Indian Rupee",
  USD: "US Dollar",
  GBP: "British Pound",
};
