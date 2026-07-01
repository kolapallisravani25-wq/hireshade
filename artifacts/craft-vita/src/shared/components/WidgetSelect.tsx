import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WidgetSelectOption {
  value: string;
  label: string;
  /** Short capability tag rendered as a colored pill (e.g. "fast", "reasoning"). */
  badge?: string;
}

interface WidgetSelectProps {
  value: string;
  onValueChange: (val: string) => void;
  placeholder: string;
  options: WidgetSelectOption[];
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  listClassName?: string;
}

const BADGE_COLORS: Record<string, string> = {
  fast: "bg-emerald-100 text-emerald-700",
  reasoning: "bg-violet-100 text-violet-700",
  default: "bg-zinc-100 text-zinc-600",
};

function badgeClass(badge: string) {
  return BADGE_COLORS[badge.toLowerCase()] ?? BADGE_COLORS.default;
}

/**
 * Portalized dropdown — renders the option list directly in document.body so
 * it never contributes to the innerContentRef measured height.
 * This prevents useSafeZoom from auto-clamping zoom when the list opens.
 * getBoundingClientRect() returns post-zoom visual coords so no scale math needed.
 */
export function WidgetSelect({
  value,
  onValueChange,
  placeholder,
  options,
  isLoading = false,
  emptyMessage = "Nothing uploaded yet",
  className,
  listClassName,
}: WidgetSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  const openDropdown = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(true);
  };

  const closeDropdown = () => setOpen(false);

  // Close when scrolled/resized to avoid stale position
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close, { passive: true });
    return () => window.removeEventListener("resize", close);
  }, [open]);

  return (
    <div className={cn("flex-1 min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        className="w-full flex items-center justify-between gap-2 px-3 h-11 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-800 hover:bg-zinc-50 transition-colors"
      >
        <span className={cn("truncate min-w-0 text-left", !selected && "text-zinc-400")}>
          {selected ? selected.label : placeholder}
        </span>
        {selected?.badge && (
          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", badgeClass(selected.badge))}>
            {selected.badge}
          </span>
        )}
        <ChevronDown
          className={cn(
            "w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && dropPos && createPortal(
        <>
          {/* Backdrop — captures outside clicks without blocking underlying UI */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 9994 }}
            onMouseDown={closeDropdown}
          />
          {/* Option list */}
          <div
            style={{
              position: "fixed",
              top: dropPos.top,
              left: dropPos.left,
              width: dropPos.width,
              zIndex: 9995,
              borderRadius: 12,
              background: "#ffffff",
              border: "1px solid rgba(0,0,0,0.08)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)",
              overflow: "hidden",
              animation: "wsIn 120ms cubic-bezier(0.16,1,0.3,1) both",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <style>{`
              @keyframes wsIn {
                from { opacity: 0; transform: translateY(-6px) scale(0.97); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
            {isLoading ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              </div>
            ) : options.length === 0 ? (
              <p className="py-3 text-center text-xs text-zinc-400">{emptyMessage}</p>
            ) : (
              <div className={cn("max-h-44 overflow-y-auto", listClassName)}>
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onValueChange(opt.value); closeDropdown(); }}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-zinc-50 transition-colors text-left",
                      opt.value === value && "bg-zinc-100 font-medium text-zinc-900",
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {opt.badge && (
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0", badgeClass(opt.badge))}>
                        {opt.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
