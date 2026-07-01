/**
 * useOverlayShortcuts — centralized keyboard shortcut manager for overlay windows.
 *
 * Shortcuts (macOS: Cmd, Windows/Linux: Ctrl)
 *   Cmd/Ctrl + =  / +      → zoom in
 *   Cmd/Ctrl + -           → zoom out
 *   Cmd/Ctrl + 0           → reset zoom
 *   Cmd/Ctrl + Shift + ↑   → opacity up
 *   Cmd/Ctrl + Shift + ↓   → opacity down
 *   Cmd/Ctrl + Shift + P   → toggle private mode
 *
 * All handlers are debounced at 60 fps to prevent key-repeat flood.
 * A single `window.addEventListener("keydown", ...)` listener is registered
 * and cleaned up on unmount — no duplicate listeners.
 */

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  OPACITY_MIN,
  OPACITY_MAX,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  saveOpacity,
  saveZoom,
  savePrivateMode,
} from "@/lib/overlaySettings";

interface ShortcutHandlers {
  opacity: number;
  setOpacity: (v: number) => void;
  zoom: number;
  setZoom: (v: number) => void;
  privateMode: boolean;
  setPrivateMode: (v: boolean) => void;
  /**
   * Optional runtime-safe zoom bounds from useSafeZoom.
   * When provided, keyboard zoom is clamped to these instead of the global ZOOM_MIN/MAX.
   */
  safeZoomMin?: number;
  safeZoomMax?: number;
  /**
   * When true, the Cmd/Ctrl+Shift+P private mode shortcut is blocked.
   * Set this to `true` during an active session so private mode cannot
   * change mid-session via keyboard.
   */
  isPrivateLocked?: boolean;
}

const OPACITY_STEP = 0.05;
// 16 ms ≈ 1 frame at 60 fps — prevent key-repeat flood
const FRAME_MS = 16;

export function useOverlayShortcuts({
  opacity,
  setOpacity,
  zoom,
  setZoom,
  privateMode,
  setPrivateMode,
  safeZoomMin,
  safeZoomMax,
  isPrivateLocked,
}: ShortcutHandlers): void {
  // Use refs so the keydown closure always sees the latest values without
  // being re-registered on every state change.
  const opacityRef   = useRef(opacity);
  const zoomRef      = useRef(zoom);
  const privateModeRef = useRef(privateMode);
  const lastFiredRef = useRef(0);
  // Safe zoom bounds refs — updated every render without re-attaching the listener
  const safeZoomMinRef = useRef(safeZoomMin ?? ZOOM_MIN);
  const safeZoomMaxRef = useRef(safeZoomMax ?? ZOOM_MAX);
  const isPrivateLockedRef = useRef(isPrivateLocked ?? false);

  opacityRef.current    = opacity;
  zoomRef.current       = zoom;
  privateModeRef.current = privateMode;
  safeZoomMinRef.current = safeZoomMin ?? ZOOM_MIN;
  safeZoomMaxRef.current = safeZoomMax ?? ZOOM_MAX;
  isPrivateLockedRef.current = isPrivateLocked ?? false;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const now = performance.now();
      if (now - lastFiredRef.current < FRAME_MS) return;

      // Zoom in: Cmd/Ctrl + = or Cmd/Ctrl + +
      if (!e.shiftKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        lastFiredRef.current = now;
        const next = Math.min(safeZoomMaxRef.current, +(zoomRef.current + ZOOM_STEP).toFixed(2));
        setZoom(next);
        saveZoom(next);
        return;
      }

      // Zoom out: Cmd/Ctrl + -
      if (!e.shiftKey && e.key === "-") {
        e.preventDefault();
        lastFiredRef.current = now;
        const next = Math.max(safeZoomMinRef.current, +(zoomRef.current - ZOOM_STEP).toFixed(2));
        setZoom(next);
        saveZoom(next);
        return;
      }

      // Reset zoom: Cmd/Ctrl + 0
      if (!e.shiftKey && e.key === "0") {
        e.preventDefault();
        lastFiredRef.current = now;
        setZoom(1);
        saveZoom(1);
        return;
      }

      // Opacity up: Cmd/Ctrl + Shift + ArrowUp
      if (e.shiftKey && e.key === "ArrowUp") {
        e.preventDefault();
        lastFiredRef.current = now;
        const next = Math.min(OPACITY_MAX, +(opacityRef.current + OPACITY_STEP).toFixed(2));
        setOpacity(next);
        saveOpacity(next);
        return;
      }

      // Opacity down: Cmd/Ctrl + Shift + ArrowDown
      if (e.shiftKey && e.key === "ArrowDown") {
        e.preventDefault();
        lastFiredRef.current = now;
        const next = Math.max(OPACITY_MIN, +(opacityRef.current - OPACITY_STEP).toFixed(2));
        setOpacity(next);
        saveOpacity(next);
        return;
      }

      // Toggle private mode: Cmd/Ctrl + Shift + P
      if (e.shiftKey && e.key === "P") {
        e.preventDefault();
        // Block private mode change during active session
        if (isPrivateLockedRef.current) return;
        lastFiredRef.current = now;
        const next = !privateModeRef.current;
        setPrivateMode(next);
        savePrivateMode(next);
        invoke("toggle_content_protection", { protected: next }).catch(console.error);
        return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Empty deps — effect runs once; all mutable state accessed via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
