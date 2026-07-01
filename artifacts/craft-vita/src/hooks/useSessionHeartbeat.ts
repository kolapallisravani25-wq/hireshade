import { useEffect, useRef, useCallback } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";

interface UseSessionHeartbeatOptions {
  sessionId: string | undefined;
  /** Enable heartbeat only for paid sessions */
  enabled: boolean;
  /** ISO string from activate response — used to calculate elapsed minutes accurately */
  startedAt: string | null;
  onExhausted: () => void;
  onWarning?: (remainingMinutes: number) => void;
}

export function useSessionHeartbeat({
  sessionId,
  enabled,
  startedAt,
  onExhausted,
  onWarning,
}: UseSessionHeartbeatOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Keep callback refs stable to avoid re-running the effect
  const onExhaustedRef = useRef(onExhausted);
  const onWarningRef = useRef(onWarning);

  useEffect(() => { onExhaustedRef.current = onExhausted; }, [onExhausted]);
  useEffect(() => { onWarningRef.current = onWarning; }, [onWarning]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    startTimeRef.current = startedAt
      ? new Date(startedAt).getTime()
      : Date.now();

    const tick = async () => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 60_000);
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/heartbeat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ elapsedMinutes: elapsed }),
          },
        );
        if (!res.ok) return; // non-fatal — retry next tick
        const data = await res.json();

        if (data.action === "CREDIT_WARNING") {
          onWarningRef.current?.(data.remainingMinutes ?? 1);
        } else if (data.action === "CREDIT_EXHAUSTED") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onExhaustedRef.current();
        }
      } catch {
        // Network failure — do NOT stop; retry on next tick
      }
    };

    intervalRef.current = setInterval(tick, 60_000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, sessionId, startedAt]);

  /** Manually stop the heartbeat (call before/after deactivate) */
  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  return { stop };
}
