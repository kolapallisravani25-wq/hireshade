import { useState, useEffect, useRef, useCallback } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";

const FREE_SESSION_DURATION = 5 * 60; // 5 minutes in seconds

interface UseFreeSessionTimerOptions {
  sessionId: string | undefined;
  onTimeUp: () => void;
  /** For paid sessions: total minutes allowed (from activate response). Enables remaining-time countdown. */
  maxAllowedMinutes?: number | null;
}

interface UseFreeSessionTimerReturn {
  /** Remaining seconds (null if not a free session or still loading) */
  remainingSeconds: number | null;
  /** Whether this is a free session */
  isFreeSession: boolean;
  /** Whether the session data is still loading */
  isLoading: boolean;
  /** Formatted time string "MM:SS" */
  formattedTime: string | null;
  /** Progress from 1 (full) to 0 (empty) */
  progress: number;
}

export function useFreeSessionTimer({
  sessionId,
  onTimeUp,
  maxAllowedMinutes,
}: UseFreeSessionTimerOptions): UseFreeSessionTimerReturn {
  const [isFreeSession, setIsFreeSession] = useState(false);
  const [isLoading, setIsLoading] = useState(() => !!sessionId);
  const [seconds, setSeconds] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  const hasEndedRef = useRef(false);

  // Keep callback ref up to date without triggering effects
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  // Fetch session details
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const fetchSession = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}`,
          { headers: await getAuthHeaders() }
        );
        if (!res.ok) throw new Error("Failed to fetch session");

        const data = await res.json();
        if (cancelled) return;

        const session = data.data || data;
        const isFree = !!session.free;
        setIsFreeSession(isFree);
        
        const start = session.startedAt ? new Date(session.startedAt).getTime() : new Date().getTime();
        const now = new Date().getTime();
        const elapsed = Math.max(0, Math.floor((now - start) / 1000));

        if (isFree) {
          const remaining = Math.max(0, FREE_SESSION_DURATION - elapsed);
          setSeconds(remaining);
          
          if (remaining <= 0 && !hasEndedRef.current) {
            hasEndedRef.current = true;
            setTimeout(() => onTimeUpRef.current(), 0);
          }
        } else {
          // Paid/full session: always count up from elapsed time
          setSeconds(elapsed);
        }
      } catch (err) {
        console.error("[SessionTimer] Error fetching session:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchSession();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Run timer
  useEffect(() => {
    if (seconds === null) return;

    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev === null) return null;

        if (isFreeSession) {
          if (prev <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (!hasEndedRef.current) {
              hasEndedRef.current = true;
              setTimeout(() => onTimeUpRef.current(), 0);
            }
            return 0;
          }
          return prev - 1;
        } else {
          // Paid/full session: always count up
          return prev + 1;
        }
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isFreeSession, seconds === null]);

  const formatTime = useCallback((totalSeconds: number): string => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    
    const mm = m.toString().padStart(2, "0");
    const ss = s.toString().padStart(2, "0");
    
    if (h > 0) {
      const hh = h.toString().padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    }
    return `${mm}:${ss}`;
  }, []);

  return {
    remainingSeconds: seconds,
    isFreeSession,
    isLoading,
    formattedTime: seconds !== null ? formatTime(seconds) : null,
    progress: isFreeSession && seconds !== null
      ? seconds / FREE_SESSION_DURATION
      : 1,
  };
}
