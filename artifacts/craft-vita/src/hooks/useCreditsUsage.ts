import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";

export interface UsageEntry {
  id: string;
  userId: string;
  operation: string;
  creditsUsed: string;
  cached: boolean;
  resumeId: string | null;
  aiModel: string | null;
  aiCostUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface UsagePagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface UseUsageResult {
  entries: UsageEntry[];
  pagination: UsagePagination | null;
  isLoading: boolean;
  error: string | null;
  page: number;
  setPage: (p: number) => void;
  operation: string | undefined;
  setOperation: (op: string | undefined) => void;
  refresh: () => void;
}

export function useCreditsUsage(limit = 20): UseUsageResult {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [pagination, setPagination] = useState<UsagePagination | null>(null);
  const [page, setPage] = useState(1);
  const [operation, setOperation] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<{ key: string; message: string } | null>(null);

  const paramKey = `${page}-${limit}-${String(operation)}-${tick}`;
  const isLoading = loadedFor !== paramKey;
  const error = fetchError?.key === paramKey ? fetchError.message : null;

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        if (cancelled) return;

        const res = await fetch(ENDPOINTS.creditsUsage(page, limit, operation), {
          headers: { Authorization: `Bearer ${token}` },
        });
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
  }, [getToken, page, limit, operation, tick]);

  return { entries, pagination, isLoading, error, page, setPage, operation, setOperation, refresh };
}
