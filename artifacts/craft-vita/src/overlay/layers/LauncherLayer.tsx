/**
 * LauncherLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Layer 2 in the overlay stack — hosts the floating launcher widget card.
 *
 * Phase 1 (current): thin motion wrapper stub. The actual launcher content
 * continues to live in WidgetContent (WidgetApp.tsx). LauncherLayer will become
 * the canonical home for WidgetContent in Phase 4 when USE_UNIFIED_OVERLAY is
 * enabled and the launcher window transitions to OverlayRoot coordination.
 *
 * Motion spec:
 *   enter  → fade-in + slight scale-up (0.96 → 1)
 *   exit   → fade-out + slight scale-down (1 → 0.96)
 *   timing → 180ms spring (0.16, 1, 0.3, 1) — matches existing WidgetApp
 */
import React from "react";
import { motion } from "framer-motion";

interface LauncherLayerProps {
  children?: React.ReactNode;
}

export const LauncherLayer: React.FC<LauncherLayerProps> = ({ children }) => {
  return (
    <motion.div
      data-layer="launcher"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
