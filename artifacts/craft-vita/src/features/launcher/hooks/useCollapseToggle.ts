import { useState, useRef, useCallback } from "react";

interface UseCollapseToggleOptions {
  handleDragStart: (e?: React.MouseEvent) => void;
}

interface UseCollapseToggleReturn {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  handleCollapseToggle: () => void;
  handleCollapsedDragStart: (e: React.MouseEvent) => void;
  handleCollapsedClick: () => void;
}

/**
 * Manages the collapsed/expanded toggle state with drag-suppression logic:
 * if the collapsed icon was dragged (moved > 3px), the subsequent click
 * should not expand the launcher.
 */
export function useCollapseToggle({
  handleDragStart,
}: UseCollapseToggleOptions): UseCollapseToggleReturn {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedHasDraggedRef = useRef(false);

  const handleCollapseToggle = useCallback(
    () => setCollapsed((c) => !c),
    [],
  );

  const handleCollapsedDragStart = useCallback(
    (e: React.MouseEvent) => {
      collapsedHasDraggedRef.current = false;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;
      const cleanup = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      const onMove = (ev: MouseEvent) => {
        if (dragStarted) return;
        if (
          Math.abs(ev.clientX - startX) > 3 ||
          Math.abs(ev.clientY - startY) > 3
        ) {
          // Only NOW hand off to the native window drag. Starting the drag on
          // mousedown swallowed the subsequent click in the webview, so a plain
          // click on the collapsed icon never fired handleCollapsedClick and the
          // launcher could never be expanded again (the collapse dead-end).
          dragStarted = true;
          collapsedHasDraggedRef.current = true;
          cleanup();
          handleDragStart();
        }
      };
      const onUp = () => {
        cleanup();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [handleDragStart],
  );

  const handleCollapsedClick = useCallback(() => {
    if (!collapsedHasDraggedRef.current) {
      handleCollapseToggle();
    }
  }, [handleCollapseToggle]);

  return {
    collapsed,
    setCollapsed,
    handleCollapseToggle,
    handleCollapsedDragStart,
    handleCollapsedClick,
  };
}
