import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";

export interface LedgerEntry {
  id: string;
  userId: string;
  sessionId: string | null;
  type: "DEBIT" | "CREDIT";
  amount: string;
  reason: string;
  createdAt: string;
}

export interface LedgerPagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface UseLedgerResult {
  entries: LedgerEntry[];
  pagination: LedgerPagination | null;
  isLoading: boolean;
  error: string | null;
  page: number;
  setPage: (p: number) => void;
  refresh: () => void;
}

export function useCreditsLedger(limit = 20): UseLedgerResult {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [pagination, setPagination] = useState<LedgerPagination | null>(null);
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);

  const paramKey = `${page}-${limit}-${tick}`;
  const isLoading = loadedFor !== paramKey;
  const error = fetchError?.key === paramKey ? fetchError.message : null;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        if (cancelled) return;

        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/credits/ledger?page=${page}&limit=${limit}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (cancelled) return;

        if (!res.ok) throw new Error(`${res.status}`);
        const json = await res.json();
        if (cancelled) return;

        setEntries(json.data ?? []);
        setPagination(json.pagination ?? null);
        setLoadedFor(paramKey);
      } catch (err) {
        if (!cancelled) {
          setFetchError({ key: paramKey, message: err instanceof Error ? err.message : "Failed" });
          setLoadedFor(paramKey);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [getToken, page, limit, tick]);

  return { entries, pagination, isLoading, error, page, setPage, refresh };
}
