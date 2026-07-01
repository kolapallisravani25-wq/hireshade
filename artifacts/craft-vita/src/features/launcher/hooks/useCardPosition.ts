import { useState, useRef, useCallback, useEffect } from "react";
import { WIDGET_W } from "@/features/launcher/constants";
import { clampToScreen, clampStoredPos } from "@/lib/clampToScreen";

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

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startMX = e.clientX;
      const startMY = e.clientY;
      const startX = cardPos.x;
      const startY = cardPos.y;
      isDraggingRef.current = true;

      const onMove = (ev: MouseEvent) => {
        const rawX = startX + ev.clientX - startMX;
        const rawY = startY + ev.clientY - startMY;
        // Clamp on every frame — keeps the widget always reachable.
        const { x, y } = clampToScreen(rawX, rawY, WIDGET_W);
        setCardPos({ x, y });
      };

      const onUp = (ev: MouseEvent) => {
        const rawX = startX + ev.clientX - startMX;
        const rawY = startY + ev.clientY - startMY;
        const { x, y } = clampToScreen(rawX, rawY, WIDGET_W);
        const finalPos = { x, y };
        setCardPos(finalPos);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(finalPos));
        } catch {
          /* storage unavailable */
        }
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        isDraggingRef.current = false;
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [cardPos.x, cardPos.y],
  );

  return { cardPos, isDraggingRef, handleDragStart };
}
