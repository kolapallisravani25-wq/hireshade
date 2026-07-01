/**
 * SessionLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 3 in the overlay stack — hosts the active session overlay UI.
 *
 * Phase 1 (current): stub. The active session still opens in the separate
 * Tauri mini window (FloatingApp.tsx). SessionLayer will receive the ported
 * FloatingApp content in Phase 2 once ENABLE_SESSION_LAYER is set to true.
 *
 * When active (ENABLE_SESSION_LAYER = true):
 *   - Listens for "session-init" Tauri event to hydrate session data
 *   - Renders session transcript, AI answers, controls inside this layer
 *   - Emits "session:reset" Tauri event on end to notify launcher layer
 *   - No separate Tauri window is created
 *
 * Motion spec:
 *   enter  → fade-in + scale-up (0.94 → 1) + upward translate (8px → 0)
 *   exit   → fade-out + scale-down (1 → 0.94) + downward translate (0 → 4px)
 *   timing → 220ms spring (0.16, 1, 0.3, 1)
 */
import React from "react";
import { motion } from "framer-motion";

interface SessionLayerProps {
  children?: React.ReactNode;
}

export const SessionLayer: React.FC<SessionLayerProps> = ({ children }) => {
  return (
    <motion.div
      data-layer="session"
      initial={{ opacity: 0, scale: 0.94, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 4 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        willChange: "opacity, transform",
      }}
    >
      {children}
    </motion.div>
  );
};
