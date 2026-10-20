import * as React from "react";
import { PreflightPanel } from "@/overlay/preflight/PreflightPanel";
import {
  contextToPreflightInput,
  createRendererPreflightHost,
  type ElectronPreflightContext,
  type RendererBridgeLike,
} from "@/overlay/preflight/routing";
import type { PreflightInput } from "@/overlay/preflight/types";

interface PreflightBridge extends RendererBridgeLike {
  readonly hireshadePreflight?: {
    getContext?: () => Promise<ElectronPreflightContext>;
    moveToDisplay?: (displayId: number) => Promise<unknown>;
    showSelfCheck?: (pattern: "content-leak" | "black-bar-leak") => Promise<unknown>;
  };
}

function fallbackInput(): PreflightInput {
  // Browser-only / non-Electron surface: we can still state the honest
  // limitation and avoid claiming a capture-path verdict we cannot observe.
  const screenInfo = window.screen;
  return {
    displays: [
      {
        id: 0,
        primary: true,
        bounds: {
          x: 0,
          y: 0,
          width: screenInfo.width,
          height: screenInfo.height,
        },
        scaleFactor: window.devicePixelRatio,
      },
    ],
    overlay: null,
    compatMode: false,
  };
}

/**
 * Runtime pre-flight card (S3): GREEN/AMBER/RED before a session starts.
 * On the Electron shell it reads displays/overlay/capture state from the
 * preload bridge; on the web it degrades to a single-display honest verdict.
 */
export function PreflightCard({ className }: { className?: string }) {
  const [input, setInput] = React.useState<PreflightInput | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const bridge = window as unknown as PreflightBridge;
    const preflight = bridge.hireshadePreflight;
    if (!preflight || typeof preflight.getContext !== "function") {
      setInput(fallbackInput());
      return () => {
        cancelled = true;
      };
    }
    preflight
      .getContext()
      .then((context) => {
        if (!cancelled) setInput(contextToPreflightInput(context));
      })
      .catch(() => {
        if (!cancelled) setInput(fallbackInput());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!input) return null;

  const bridge = window as unknown as PreflightBridge;
  const host =
    bridge.hireshadePreflight || bridge.hireshadeCapture
      ? createRendererPreflightHost(bridge)
      : null;

  return (
    <PreflightPanel
      input={input}
      host={host}
      className={className ?? "rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm"}
    />
  );
}

export default PreflightCard;
