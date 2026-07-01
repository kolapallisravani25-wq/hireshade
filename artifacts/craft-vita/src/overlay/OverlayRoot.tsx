/**
 * OverlayRoot
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified fullscreen overlay runtime coordinator.
 *
 * This component replaces the multi-window Tauri architecture with a single
 * fullscreen transparent React runtime inside the launcher window. It is only
 * rendered when the USE_UNIFIED_OVERLAY feature flag is true — existing
 * WidgetContent is used as-is otherwise.
 *
 * Layer stack (bottom → top):
 *   1. OverlayEffectsLayer    — ambient background effects (Phase 3+)
 *   2. LauncherLayer          — floating launcher widget card
 *   3. SessionLayer           — active session overlay (Phase 2+)
 *   4. OverlayPortalLayer     — menus, popovers, tooltips (always on top)
 *
 * Mode switching (launcher ↔ session) is driven by Redux overlay.mode.
 * AnimatePresence provides smooth cross-fade transitions between layers.
 *
 * GPU acceleration:
 *   - `will-change: transform` on root and each layer
 *   - `isolation: isolate` creates a new stacking context
 *   - `transform: translateZ(0)` forces GPU compositing on the root
 */
import React from "react";
import { AnimatePresence } from "framer-motion";
import { useAppSelector } from "@/store/hooks";
import { OverlayPortalProvider } from "./providers/OverlayPortalProvider";
import { OverlayEffectsLayer } from "./layers/OverlayEffectsLayer";
import { LauncherLayer } from "./layers/LauncherLayer";
import { SessionLayer } from "./layers/SessionLayer";
import { OverlayPortalLayer } from "./layers/OverlayPortalLayer";

// ─── Props ────────────────────────────────────────────────────────────────────

interface OverlayRootProps {
  /**
   * Content for the launcher layer (WidgetContent).
   * Will be rendered inside LauncherLayer when mode = "launcher".
   */
  launcherContent: React.ReactNode;
  /**
   * Content for the session layer (session UI).
   * Will be rendered inside SessionLayer when mode = "session".
   * Pass null when ENABLE_SESSION_LAYER is false (mini window handles sessions).
   */
  sessionContent?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OverlayRoot({ launcherContent, sessionContent }: OverlayRootProps) {
  const mode = useAppSelector((s) => s.overlay.mode);

  return (
    <OverlayPortalProvider>
      {/*
        Fixed fullscreen transparent canvas.
        - pointer-events: none — transparent areas pass through to OS
        - isolation: isolate — own stacking context, no z-index leaks
        - transform: translateZ(0) — forces GPU compositing layer
        - will-change: transform — hints GPU pre-compositing
      */}
      <div
        data-overlay-root
        style={{
          position: "fixed",
          inset: 0,
          background: "transparent",
          pointerEvents: "none",
          overflow: "visible",
          isolation: "isolate",
          transform: "translateZ(0)",
          willChange: "transform",
          zIndex: 0,
        }}
      >
        {/* Layer 1: ambient effects (stub in Phase 1) */}
        <OverlayEffectsLayer />

        {/*
          Layers 2 + 3: launcher / session
          AnimatePresence mode="wait" ensures the exiting layer fully fades out
          before the entering one appears — prevents two cards overlapping.
          mode="sync" can be used for cross-fades (Phase 4+ decision).
        */}
        <AnimatePresence mode="wait" initial={false}>
          {mode === "launcher" && (
            <LauncherLayer key="launcher">
              {launcherContent}
            </LauncherLayer>
          )}
          {mode === "session" && sessionContent != null && (
            <SessionLayer key="session">
              {sessionContent}
            </SessionLayer>
          )}
        </AnimatePresence>

        {/* Layer 4: portal anchor (content injected via OverlayPortalProvider) */}
        <OverlayPortalLayer />
      </div>
    </OverlayPortalProvider>
  );
}
