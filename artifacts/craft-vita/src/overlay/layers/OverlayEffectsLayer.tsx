/**
 * OverlayEffectsLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Bottom-most layer in the overlay stack. Reserved for ambient background
 * effects: glass blur, gradient vignettes, noise textures.
 *
 * Currently a no-op stub — effects are handled per-card in LauncherLayer and
 * SessionLayer. This layer will be activated in Phase 3 when background effects
 * are separated from interactive content layers (spec §7 opacity system).
 */
import React from "react";

export const OverlayEffectsLayer: React.FC = () => null;
