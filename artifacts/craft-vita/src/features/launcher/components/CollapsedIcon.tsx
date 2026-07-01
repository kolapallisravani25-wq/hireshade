import { useRef } from "react";
import { APP_NAME } from "@/features/launcher/constants";

/**
 * Tiny circular floating button shown when the launcher is collapsed.
 * Dragging and clicking are wired externally via the parent's onMouseDown/onClick.
 *
 * Uses CSS transitions instead of Framer Motion spring to keep hover/tap
 * animations on the GPU compositor thread (no JS RAF loop).
 */
export function CollapsedIcon() {
  const divRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={divRef}
      onMouseEnter={() => { if (divRef.current) divRef.current.style.transform = "scale(1.08)"; }}
      onMouseLeave={() => { if (divRef.current) divRef.current.style.transform = ""; }}
      onMouseDown={() => { if (divRef.current) divRef.current.style.transform = "scale(0.94)"; }}
      onMouseUp={() => { if (divRef.current) divRef.current.style.transform = "scale(1.08)"; }}
      style={{
        width: 60,
        height: 60,
        borderRadius: "50%",
        background: "white",
        boxShadow: "0 4px 24px rgba(0,0,0,0.14), 0 1px 6px rgba(0,0,0,0.07)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
        WebkitUserSelect: "none",
        userSelect: "none",
        // cubic-bezier approximates the spring overshoot — compositor-only, no JS RAF
        transition: "transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      }}
    >
      <img
        src="/src-tauri/icons/icon.png"
        alt={APP_NAME}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          pointerEvents: "none",
          userSelect: "none",
        }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
}
