import { useEffect, useRef, useCallback } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";

interface UseSessionHeartbeatOptions {
  sessionId: string | undefined;
  /** Enable heartbeat only while the session is live */
  enabled: boolean;
  /** ISO string from activate response — used to calculate elapsed minutes accurately */
  startedAt: string | null;
  onExhausted: () => void;
  onWarning?: (remainingMinutes: number) => void;
  /**
   * Fired when the server reports the session is no longer ACTIVE (ended on
   * another device, auto-ended by the stale-session reaper after the machine
   * slept, etc.). The page should tear down its live UI; deactivate is
   * idempotent so calling the normal end flow is safe.
   */
  onSessionEnded?: (status?: string) => void;
}

export function useSessionHeartbeat({
  sessionId,
  enabled,
  startedAt,
  onExhausted,
  onWarning,
  onSessionEnded,
}: UseSessionHeartbeatOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  // Keep callback refs stable to avoid re-running the effect
  const onExhaustedRef = useRef(onExhausted);
  const onWarningRef = useRef(onWarning);
  const onSessionEndedRef = useRef(onSessionEnded);

  useEffect(() => { onExhaustedRef.current = onExhausted; }, [onExhausted]);
  useEffect(() => { onWarningRef.current = onWarning; }, [onWarning]);
  useEffect(() => { onSessionEndedRef.current = onSessionEnded; }, [onSessionEnded]);

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
        } else if (
          data.action === "CREDIT_EXHAUSTED" ||
          data.action === "TIME_EXHAUSTED"
        ) {
          // Server force-ended the session (credits ran out, or a free
          // session passed its cap). Stop heartbeating and let the page run
          // its end flow — deactivate is idempotent server-side, so the
          // follow-up call cannot double-charge.
          if (intervalRef.current) clearInterval(intervalRef.current);
          onExhaustedRef.current();
        } else if (data.action === "SESSION_NOT_ACTIVE") {
          // Session was ended elsewhere (another device, reaper after sleep,
          // admin). Stop heartbeating and let the page tear down its live UI.
          if (intervalRef.current) clearInterval(intervalRef.current);
          onSessionEndedRef.current?.(data.status);
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
