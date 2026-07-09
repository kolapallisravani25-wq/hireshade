import { useState, useRef, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WIDGET_W } from "@/features/launcher/constants";
import { clampStoredPos } from "@/lib/clampToScreen";

interface CardPos {
  x: number;
  y: number;
}

interface UseCardPositionReturn {
  cardPos: CardPos;
  isDraggingRef: React.MutableRefObject<boolean>;
  handleDragStart: (e: React.MouseEvent) => void;
}

const STORAGE_KEY = "launcher-card-pos";

export function useCardPosition(): UseCardPositionReturn {
  const [cardPos, setCardPos] = useState<CardPos>(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        const saved = JSON.parse(s) as CardPos;
        // Clamp stored position back onto the current (possibly different) screen.
        return clampStoredPos(saved, WIDGET_W);
      }
    } catch {
      /* ignore parse errors */
    }
    // Default: horizontally centered, 20px from the top.
    return {
      x: Math.max(0, Math.round(window.innerWidth / 2 - WIDGET_W / 2)),
      y: 20,
    };
  });

  const isDraggingRef = useRef(false);

  // Re-clamp the stored position whenever the window is resized (e.g. connecting
  // an external monitor changes the logical viewport size).
  useEffect(() => {
    const onResize = () => {
      setCardPos((prev) => {
        const clamped = clampStoredPos(prev, WIDGET_W);
        return clamped.x === prev.x && clamped.y === prev.y ? prev : clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Drag the native OS window rather than repositioning the card in CSS space.
  // The launcher window is sized to the card, so CSS-space dragging left almost
  // no horizontal room and the edge-snap logic pinned X to a screen edge (drag
  // felt vertical-only); moving the card also clipped its drop-shadow against
  // the tight window bounds while dragging. Native startDragging() moves the
  // whole window in both axes and avoids the per-frame CSS repaint artifact.
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const reset = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mouseup", reset);
    };
    window.addEventListener("mouseup", reset);
    getCurrentWindow()
      .startDragging()
      .catch(() => reset());
  }, []);

  return { cardPos, isDraggingRef, handleDragStart };
}
