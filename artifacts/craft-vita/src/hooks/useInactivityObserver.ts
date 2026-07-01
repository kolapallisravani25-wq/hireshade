import { useState, useCallback } from "react";
import { useIdleTimer } from "react-idle-timer";

/**
 * useInactivityObserver
 *
 * Monitors user inactivity and shows a warning dialog before automatically
 * ending the session.
 *
 * @param timeoutMs Total time until idle (Inactivity + Warning period)
 * @param onIdleCallback Callback to execute on idle
 * @param promptBeforeIdleMs Duration of the warning period (default 30s)
 */
export const useInactivityObserver = (
  timeoutMs = Number(import.meta.env.VITE_INACTIVITY_TIMEOUT_MS),
  onIdleCallback?: () => void,
  promptBeforeIdleMs = Number(import.meta.env.VITE_INACTIVITY_WARNING_MS),
) => {
  const [showDialog, setShowDialog] = useState(false);

  const handleIdle = useCallback(async () => {
    setShowDialog(false);

    if (onIdleCallback) {
      onIdleCallback();
    }
  }, [onIdleCallback]);

  const { getRemainingTime, reset } = useIdleTimer({
    timeout: timeoutMs,
    promptBeforeIdle: promptBeforeIdleMs,
    onPrompt: () => setShowDialog(true),
    onIdle: handleIdle,
    events: ["mousemove", "keydown", "wheel", "mousedown", "touchstart"],
    throttle: 500,
    crossTab: true,
  });

  const handleStayActive = useCallback(() => {
    setShowDialog(false);
    reset();
  }, [reset]);

  return {
    showDialog,
    onStayActive: handleStayActive,
    remainingTime: Math.ceil(getRemainingTime() / 1000),
    reset,
  };
};
