import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";

export interface CreditPurchase {
  id: string;
  userId: string;
  amountPaid: string;
  creditsAdded: string;
  currency: string;
  status: "CONFIRMED" | "PENDING" | "FAILED";
  createdAt: string;
}

interface UsePurchasesResult {
  purchases: CreditPurchase[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCreditsPurchases(): UsePurchasesResult {
  const { getToken } = useAuth();
  const [purchases, setPurchases] = useState<CreditPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const token = await getToken();
        if (cancelled) return;

        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/credits/purchases`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (cancelled) return;

        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (cancelled) return;

        setPurchases(json.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [getToken, tick]);

  return { purchases, isLoading, error, refresh };
}
