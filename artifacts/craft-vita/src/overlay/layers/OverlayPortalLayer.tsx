/**
 * OverlayPortalLayer
 * ─────────────────────────────────────────────────────────────────────────────
 * Top-most layer in the overlay stack. Renders nothing itself — the actual
 * portal content (menus, popovers, dropdowns, tooltips) is injected by
 * OverlayPortalProvider into the #overlay-portal-root DOM node.
 *
 * This component is a logical bookmark to document the layer's position in the
 * stack and serves as a future integration point for layer-level analytics or
 * debug overlays.
 */
import React from "react";

export const OverlayPortalLayer: React.FC = () => null;
