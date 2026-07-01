import { getAuthHeaders } from "@/lib/globalAuth";

// Module-level cache keyed by currency — avoids re-fetching across re-renders
// (same dedup pattern as useCreditBrackets)
const cache: Record<string, CreditPlan[]> = {};
const inFlight: Record<string, Promise<CreditPlan[]>> = {};

export interface CreditPlan {
  code: string;
  name: string;
  credits: string;
  currency: string;
  amountMajor: string;
  amountMinor: number;
  feature: string;
  isPopular: boolean;
  valuePct: number;
}

async function fetchPlans(currency: string): Promise<CreditPlan[]> {
  if (cache[currency]) return cache[currency];
  if (!inFlight[currency]) {
    inFlight[currency] = getAuthHeaders()
      .then((authHeaders) => fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/credits/plans?currency=${currency}`,
        { headers: authHeaders },
      ))
      .then((r) => r.json())
      .then((json) => {
        const plans: CreditPlan[] = json.data ?? [];
        cache[currency] = plans;
        delete inFlight[currency];
        return plans;
      })
      .catch(() => {
        delete inFlight[currency];
        return [];
      });
  }
  return inFlight[currency];
}

import { useState, useEffect } from "react";

export type SupportedCurrency = "INR" | "USD" | "GBP";

export function useCreditPlans(currency: SupportedCurrency = "INR") {
  const [plans, setPlans] = useState<CreditPlan[]>(cache[currency] ?? []);
  const [isLoading, setIsLoading] = useState(!cache[currency]);

  useEffect(() => {
    let cancelled = false;
    if (cache[currency]) {
      setPlans(cache[currency]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchPlans(currency).then((p) => {
      if (!cancelled) {
        setPlans(p);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [currency]);

  return { plans, isLoading };
}
