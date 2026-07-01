/**
 * FloatingSurface
 * ─────────────────────────────────────────────────────────────────────────────
 * Proper layered opacity container for the session overlay.
 *
 * Opacity layering spec (§7):
 *   Layer 1 (absolute inset-0): glass background — rgba alpha + blur both
 *            scale with `opacity`. Lowering opacity makes the card genuinely
 *            transparent (user sees through it) instead of frosted-glass blur.
 *   Layer 2 (relative z-10):   interactive content — always full opacity.
 *            Buttons, text, answers, transcript, icons never fade.
 *
 * Zoom strategy:
 *   Uses the CSS `zoom` property (NOT `transform: scale`, NOT `fontSize`).
 *   `zoom` is a true layout-affecting scale: it grows padding, gaps, fixed
 *   px sizes, SVG icons, AND text proportionally. This matches the launcher
 *   widget exactly. The host element (FloatingApp) must pass
 *   `cssZoomApplied: true` to `useSafeZoom` so safeMax is computed correctly
 *   from the zoom-affected offsetHeight.
 *
 * This is the root surface for the mini overlay window. It handles:
 * - Glass background with controlled opacity AND matching blur fade
 * - Border radius + overflow clipping
 * - Layout-correct CSS zoom on the interactive layer
 */
import React from "react";

// Detected once at module load — zero cost per render.
// Disable backdrop-filter on devices with ≤4 logical cores (typical low-end i3/i5)
// or when the user has requested reduced motion.
const isLowPerfDevice: boolean = (() => {
  if (typeof window === "undefined") return false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const lowCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return reducedMotion || lowCores;
})();

export interface FloatingSurfaceProps {
  /** 0.0–1.0 — affects glass alpha AND backdrop blur intensity */
  opacity: number;
  /** 0.70–1.60 — CSS `zoom` applied to interactive content layer */
  zoom: number;
  className?: string;
  children: React.ReactNode;
  divRef?: React.Ref<HTMLDivElement>;
}

export const FloatingSurface: React.FC<FloatingSurfaceProps> = ({
  opacity,
  zoom,
  className,
  children,
  divRef,
}) => {
  // Clamp opacity to a sane visible range.
  // alpha controls the glass tint; blur scales with the same factor so that
  // at low opacity the user sees the actual content behind the window
  // (transparency), not a frosted blur.
  const opacityFactor = Math.min(1, Math.max(0.05, opacity));
  const alpha = opacityFactor * 0.95;
  // 24px max blur (matches Tailwind's backdrop-blur-2xl) → 0 at full transparency.
  const blurPx = +(opacityFactor * 24).toFixed(1);

  return (
    <div
      ref={divRef}
      className={`relative w-full flex flex-col outline-none ${className ?? ""}`}
      style={{
        // NO will-change / transform here — GPU layer promotion in WKWebView
        // causes compositor ordering bugs where portal overlays render BEHIND
        // the card regardless of z-index. isolation:isolate is sufficient to
        // scope internal z-indexes without promoting a GPU layer.
        isolation: "isolate",
        overflow: "visible",
        pointerEvents: "auto",
      }}
    >
      {/*
        Layer 1 — Glass background (opacity + blur both controlled).
        absolute inset-0: fills the card WITHOUT affecting child layout.
        overflow-hidden + rounded-xl: clips the glass bg to card shape.
        pointer-events-none: never intercepts clicks.
      */}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none"
        style={{
          backgroundColor: `rgba(24, 24, 27, ${alpha.toFixed(3)})`,
          // backdropFilter scales with opacity. At opacity=1 we get ~24px blur
          // (frosted glass). At opacity→0 blur disappears so the user sees
          // straight through the window — true transparency, not blur.
          backdropFilter: blurPx > 0.5 ? `blur(${blurPx}px)` : "none",
          WebkitBackdropFilter: blurPx > 0.5 ? `blur(${blurPx}px)` : "none",
          transition:
            "background-color 120ms ease, backdrop-filter 120ms ease, -webkit-backdrop-filter 120ms ease",
          zIndex: 0,
        }}
      />

      {/*
        Layer 2 — Interactive content (always full opacity).
        relative + z-10: floats above the glass background within the card.
        rounded-xl + overflow-hidden: clips child content to card shape.
        CSS `zoom`: scales padding, gaps, icons, text proportionally — the
        same mechanism used by the launcher widget. Without this, only `em`
        text sizes would scale and the card would barely grow.
        All portal-rendered dropdowns/menus/tooltips escape this layer via
        createPortal(…, document.getElementById('floating-portal-root')).
      */}
      <div
        className="relative flex flex-col w-full rounded-xl"
        style={{
          zIndex: 1,
          zoom,
        }}
      >
        {children}
      </div>
    </div>
  );
};

