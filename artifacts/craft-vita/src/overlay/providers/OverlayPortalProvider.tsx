/**
 * OverlayPortalProvider
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides a stable, fixed-position DOM root for all overlay UI that must NOT
 * be rendered inside a transformed container (popovers, menus, dropdowns,
 * tooltips). Prevents zoom/scale-induced positioning bugs.
 *
 * Usage:
 *   // Render inside portal
 *   const { renderInPortal } = useOverlayPortal();
 *   return renderInPortal(<MyMenu />);
 *
 *   // OR direct ref access
 *   const { portalRoot } = useOverlayPortal();
 *   return portalRoot ? createPortal(<MyMenu />, portalRoot) : null;
 *
 * The overlay-portal-root element is a singleton appended to document.body.
 * It has pointer-events: none on the root; children opt-in via data-interactive
 * or inline style.
 */
import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
} from "react";
import { createPortal } from "react-dom";

// ─── Context ──────────────────────────────────────────────────────────────────

interface OverlayPortalContextValue {
  /** The DOM element that serves as the portal target. null during SSR/hydration. */
  portalRoot: HTMLElement | null;
  /** Convenience wrapper — renders content into the portal or returns null. */
  renderInPortal: (content: React.ReactNode) => React.ReactPortal | null;
}

const OverlayPortalContext = createContext<OverlayPortalContextValue>({
  portalRoot: null,
  renderInPortal: () => null,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function OverlayPortalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  // Stable ref so callbacks created before mount see the same root
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Singleton — reuse if already created by a previous mount
    let el = document.getElementById("overlay-portal-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "overlay-portal-root";
      // Root is pointer-events:none; children use data-interactive or
      // override inline to opt-in to event handling.
      Object.assign(el.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "9990",
        overflow: "visible",
        isolation: "isolate",
      });
      document.body.appendChild(el);
    }
    rootRef.current = el;
    setPortalRoot(el);
    // Intentionally not removing on unmount — this is a document-level singleton
  }, []);

  const renderInPortal = (content: React.ReactNode): React.ReactPortal | null => {
    const root = rootRef.current ?? portalRoot;
    if (!root) return null;
    return createPortal(content, root);
  };

  return (
    <OverlayPortalContext.Provider value={{ portalRoot, renderInPortal }}>
      {children}
    </OverlayPortalContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useOverlayPortal(): OverlayPortalContextValue {
  return useContext(OverlayPortalContext);
}
