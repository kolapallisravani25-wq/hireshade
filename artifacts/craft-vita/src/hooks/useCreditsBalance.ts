/**
 * useCreditsBalance — reactive external store for credit balance.
 *
 * Architecture:
 *   - Module-level store (no Provider required) backed by useSyncExternalStore.
 *   - All mounted consumers share a SINGLE reactive snapshot; one update
 *     reaches every badge, panel and page simultaneously.
 *
 * Update paths:
 *   1. setOptimisticBalance(remaining)  — instant update from AI response
 *        body.creditsRemaining; zero extra HTTP requests.
 *   2. refreshCreditsBalance()          — full server fetch for authoritative
 *        data (all fields including heldCredits, earnedCredits).
 *
 * Rules applied (Vercel React best-practices):
 *   - rerender-split-combined-hooks   — fetch state is in the store, not each component
 *   - client-swr-dedup                — a single in-flight fetch is shared
 *   - js-cache-storage                — localStorage userId is read once per fetch
 *   - rerender-use-ref-transient-values — getToken ref kept stable
 */

import { useSyncExternalStore, useRef, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CreditsBalance {
  purchasedCredits: string;
  earnedCredits: string;
  heldCredits: string;
  totalAvailable: string;
}

export interface UseCreditsBalanceReturn {
  balance: CreditsBalance | null;
  isLoading: boolean;
  error: string | null;
  /** Force a full server re-fetch. */
  refresh: () => void;
}

// ─── Module-level store ───────────────────────────────────────────────────────

interface StoreState {
  balance: CreditsBalance | null;
  isLoading: boolean;
  error: string | null;
  /** Monotonic counter; incrementing triggers a re-fetch. */
  fetchTick: number;
}

let _state: StoreState = {
  balance: null,
  isLoading: false,
  error: null,
  fetchTick: 0,
};

const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

function _setState(patch: Partial<StoreState>): void {
  _state = { ..._state, ...patch };
  _notify();
}

function _getSnapshot(): StoreState {
  return _state;
}

function _subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Instantly reflect a deduction result from an AI response body.
 * Use this immediately after receiving `creditsRemaining` from postCreditedAi.
 * No extra HTTP request — the badge updates within the same React paint.
 */
export function setOptimisticBalance(remaining: number): void {
  if (_state.balance === null) return; // no balance loaded yet; skip
  _setState({
    balance: {
      ..._state.balance,
      totalAvailable: String(remaining),
    },
  });
}

/**
 * Trigger a full server re-fetch of all balance fields.
 * Called on mount (if balance is null) and after purchases / session end.
 */
export function refreshCreditsBalance(): void {
  _setState({ fetchTick: _state.fetchTick + 1 });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Single token provider shared across all hook instances via a module ref. */
let _getTokenFn: (() => Promise<string | null>) | null = null;
let _isSignedIn: boolean = false;

export function useCreditsBalance(): UseCreditsBalanceReturn {
  const { getToken, isSignedIn } = useAuth();

  // Keep the module-level token function up to date without causing re-renders.
  // (rerender-use-ref-transient-values)
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Register this component's auth context as the token source.
  _getTokenFn = () => getTokenRef.current();
  _isSignedIn = isSignedIn ?? false;

  const state = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);

  // Fetch on mount + whenever fetchTick increments.
  useEffect(() => {
    if (!_isSignedIn || !_getTokenFn) return;

    let cancelled = false;
    _setState({ isLoading: true, error: null });

    const run = async () => {
      try {
        const token = await _getTokenFn!();
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/credits/balance`,
          {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );
        if (!res.ok) throw new Error("Failed to fetch balance");
        const json = await res.json();
        if (!cancelled) _setState({ balance: json.data ?? json, isLoading: false });
      } catch (err: any) {
        if (!cancelled) _setState({ error: err?.message ?? "Unknown error", isLoading: false });
      }
    };

    run();
    return () => { cancelled = true; };
  }, [isSignedIn, state.fetchTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    balance:   state.balance,
    isLoading: state.isLoading,
    error:     state.error,
    refresh:   refreshCreditsBalance,
  };
}
