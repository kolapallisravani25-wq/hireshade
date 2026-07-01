import { useEffect, useRef } from "react";
import { toast } from "sonner";

interface UseSessionEventsOptions {
  sessionId: string | undefined;
  enabled: boolean;
  onExhausted: () => void;
  onWarning?: (remainingMinutes: number) => void;
}

export function useSessionEvents({
  sessionId,
  enabled,
  onExhausted,
  onWarning,
}: UseSessionEventsOptions) {
  const onExhaustedRef = useRef(onExhausted);
  const onWarningRef = useRef(onWarning);

  useEffect(() => {
    onExhaustedRef.current = onExhausted;
  }, [onExhausted]);
  useEffect(() => {
    onWarningRef.current = onWarning;
  }, [onWarning]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    console.log(`[useSessionEvents] Establishing EventSource (SSE) connection to: ${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/events`);

    const eventSource = new EventSource(
      `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/events`,
      { withCredentials: true },
    );

    eventSource.addEventListener("CREDIT_WARNING", (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[useSessionEvents] SSE Event: CREDIT_WARNING received. Data:", data);
        onWarningRef.current?.(data.remainingMinutes ?? 1);
      } catch (err) {
        console.error("[useSessionEvents] Failed to parse CREDIT_WARNING event:", err);
      }
    });

    eventSource.addEventListener("SESSION_CLOSED", (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[useSessionEvents] SSE Event: SESSION_CLOSED received. Data:", data);
        if (data.reason === "CREDIT_EXHAUSTED") {
          console.log("[useSessionEvents] Session closed due to credit exhaustion. Triggering onExhausted.");
          onExhaustedRef.current();
        }
      } catch (err) {
        console.error("[useSessionEvents] Failed to parse SESSION_CLOSED event:", err);
      }
    });

    eventSource.onerror = (err) => {
      if (eventSource.readyState === EventSource.CLOSED) {
        console.error("[useSessionEvents] SSE connection closed:", err);
        return;
      }

      console.debug("[useSessionEvents] SSE reconnecting after transient error:", err);
    };

    return () => {
      console.log("[useSessionEvents] Cleaning up EventSource (SSE) connection.");
      eventSource.close();
    };
  }, [enabled, sessionId]);
}
