/**
 * SessionMenu
 * ─────────────────────────────────────────────────────────────────────────────
 * 3-dot settings menu for the active session overlay.
 *
 * This is a thin wrapper that REUSES the launcher's `HeaderMenu` component
 * (single source of truth for overlay settings UI).  The trigger button is
 * styled for the dark mini-overlay, but the popover body is exactly the same
 * component shown in WidgetApp — same opacity slider, zoom controls, private
 * mode toggle, dashboard link, and logout.  An extra "End Session" row is
 * conditionally rendered when `onEndSession` is provided.
 *
 * During an active session, the `sessionActive` flag locks the private mode
 * toggle (display + interaction) so users cannot change it mid-session.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZOOM_MIN, ZOOM_MAX } from "@/lib/overlaySettings";
import { HeaderMenu } from "@/features/launcher/components/HeaderMenu";
import { MORE_ACTIONS_POPOVER_W } from "@/features/launcher/constants";
import { useSessionMenuAnchor } from "@/features/session/hooks/useSessionMenuAnchor";

export interface SessionMenuProps {
  opacity: number;
  setOpacity: (v: number) => void;
  zoom: number;
  setZoom: (v: number) => void;
  privateMode: boolean;
  setPrivateMode: (v: boolean) => void;
  /** Optional safe zoom bounds (defaults to ZOOM_MIN/MAX). */
  safeMin?: number;
  safeMax?: number;
  /** Called when the user clicks "End Session" from the menu. */
  onEndSession?: () => void;
  /** Whether a session is running — locks private mode toggle. */
  sessionActive?: boolean;
}

export const SessionMenu: React.FC<SessionMenuProps> = ({
  opacity,
  setOpacity,
  zoom,
  setZoom,
  privateMode,
  setPrivateMode,
  safeMin = ZOOM_MIN,
  safeMax = ZOOM_MAX,
  onEndSession,
  sessionActive = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const menuAnchor = useSessionMenuAnchor({
    menuOpen: isOpen,
    triggerRef,
  });

  const handleToggle = useCallback(() => setIsOpen((v) => !v), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, handleClose]);

  // Derived zoom bounds for HeaderMenu
  const atMin = zoom <= safeMin + 0.001;
  const atMax = zoom >= safeMax - 0.001;

  // Portal target — #floating-portal-root in the mini window, body elsewhere
  const getPortalRoot = useCallback(
    () => document.getElementById("floating-portal-root") ?? document.body,
    [],
  );

  // Wrap end-session to also close the menu
  const handleEndSession = onEndSession
    ? () => {
        handleClose();
        onEndSession();
      }
    : undefined;

  const menuContent =
    isOpen && menuAnchor ? (
      <>
        {/* Backdrop — captures outside clicks. */}
        <div
          data-interactive
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            pointerEvents: "auto",
          }}
          onMouseDown={handleClose}
        />

        {/* Menu panel — reuses HeaderMenu component. */}
        <div
          data-interactive
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: menuAnchor.top,
            left: menuAnchor.left,
            zIndex: 9999,
            width: MORE_ACTIONS_POPOVER_W,
            borderRadius: 16,
            background: "rgba(255,255,255,0.97)",
            border: "1px solid rgba(0,0,0,0.07)",
            boxShadow:
              "0 8px 28px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.05)",
            overflow: "hidden",
            pointerEvents: "auto",
            transformOrigin: "top center",
            animation: "menuIn 140ms cubic-bezier(0.16,1,0.3,1) both",
          }}
        >
          <style>{`
            @keyframes menuIn {
              from { opacity: 0; transform: scale(0.95) translateY(-4px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
            input[type="range"].slider-track::-webkit-slider-runnable-track {
              height: 4px;
              border-radius: 9999px;
              background: transparent;
            }
            input[type="range"].slider-track::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 14px;
              height: 14px;
              border-radius: 9999px;
              background: #18181b;
              border: 2px solid #ffffff;
              box-shadow: 0 1px 2px rgba(0,0,0,0.18);
              margin-top: -5px;
              cursor: pointer;
            }
            input[type="range"].slider-track::-moz-range-track {
              height: 4px;
              border-radius: 9999px;
              background: transparent;
            }
            input[type="range"].slider-track::-moz-range-thumb {
              width: 14px;
              height: 14px;
              border-radius: 9999px;
              background: #18181b;
              border: 2px solid #ffffff;
              box-shadow: 0 1px 2px rgba(0,0,0,0.18);
              cursor: pointer;
            }
          `}</style>

          <HeaderMenu
            opacity={opacity}
            setOpacity={setOpacity}
            zoom={zoom}
            setZoom={setZoom}
            privateMode={privateMode}
            setPrivateMode={setPrivateMode}
            safeMin={safeMin}
            safeMax={safeMax}
            atMin={atMin}
            atMax={atMax}
            sessionLocked={sessionActive}
            onEndSession={handleEndSession}
          />
        </div>
      </>
    ) : null;

  return (
    <>
      {/* Trigger — 3-dot/sliders icon styled for dark overlay */}
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className={cn(
          "p-1.5 rounded-lg transition-all active:scale-95 flex items-center justify-center",
          isOpen
            ? "bg-white/20 text-white"
            : "text-zinc-400 hover:text-white hover:bg-white/10",
        )}
        aria-label="Session settings"
      >
        <SlidersHorizontal size={14} />
      </button>

      {typeof document !== "undefined" &&
        createPortal(menuContent, getPortalRoot())}
    </>
  );
};
