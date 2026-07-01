// ─── Table of Contents Components ────────────────────────────────────────────
//
// Three exported components:
//   TOCNav          — nav list of section buttons
//   MobileTOCBar    — horizontal scrollable pill bar for small screens
//   StickyTOCPanel  — desktop sticky sidebar with IntersectionObserver tracking
//
// Scroll approach:
//   Always use el.scrollIntoView({ behavior: "smooth", block: "start" }).
//   The browser respects scroll-margin-top (scroll-mt-20 = 80px) and correctly
//   scrolls the nearest overflow container — no manual offset math needed.
//
// IntersectionObserver:
//   root: null (viewport) works universally even when the page scrolls via an
//   overflow-y: auto ancestor, because changes in element viewport position
//   still fire the observer.

import { memo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { ProjectSection } from "./types";

// ─── TOCNav ───────────────────────────────────────────────────────────────────

interface TOCNavProps {
  sections: ProjectSection[];
  activeKey: string | null;
  onSelect: (key: string) => void;
}

export const TOCNav = memo(function TOCNav({ sections, activeKey, onSelect }: TOCNavProps) {
  if (!sections?.length) return null;
  return (
    <div className="w-full">
      <div className="px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest">Contents</p>
      </div>
      <nav className="px-2 pb-3 space-y-0.5">
        {sections.map((s, i) => {
          const isActive = activeKey === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onSelect(s.key)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all duration-150",
                isActive
                  ? "bg-[#458fff]/10 text-[#458fff]"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className={cn(
                "text-[10px] font-mono w-4 shrink-0 tabular-nums transition-colors duration-150",
                isActive ? "text-[#458fff]/70" : "text-muted-foreground/30",
              )}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={cn(
                "text-xs line-clamp-1 leading-tight transition-colors duration-150",
                isActive ? "font-medium" : "",
              )}>
                {s.title}
              </span>
              {isActive && (
                <span className="ml-auto h-1 w-1 rounded-full bg-[#458fff] shrink-0" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
});

// ─── MobileTOCBar ─────────────────────────────────────────────────────────────

export const MobileTOCBar = memo(function MobileTOCBar({ sections }: { sections: ProjectSection[] }) {
  if (!sections?.length) return null;
  return (
    <div className="lg:hidden border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="px-4 py-3 sm:px-6">
        <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2">
          Jump To Section
        </p>
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {sections.map((s, i) => (
            <button
              key={s.key}
              onClick={() =>
                document.getElementById(`section-${s.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            >
              {String(i + 1).padStart(2, "0")} {s.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});

// ─── StickyTOCPanel ───────────────────────────────────────────────────────────

// Hook: drives active-section tracking via IntersectionObserver during manual scroll.
// Accepts an external setter so the click handler can update active state immediately
// (rerender-move-effect-to-event: don't wait for an observer callback after a click).
function useActiveSectionObserver(
  sections: ProjectSection[],
  setActiveKey: (key: string) => void,
) {
  // Primitive string dep to avoid recreating the observer on every render
  const sectionKeys = sections.map((s) => s.key).join(",");

  useEffect(() => {
    if (!sectionKeys) return;

    const visibleMap = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).id.replace("section-", "");
          if (entry.isIntersecting) {
            visibleMap.set(key, entry.boundingClientRect.top);
          } else {
            visibleMap.delete(key);
          }
        }
        // Pick the topmost visible section (smallest positive y from top of viewport)
        const sorted = [...visibleMap.entries()].sort((a, b) => a[1] - b[1]);
        if (sorted.length > 0) setActiveKey(sorted[0][0]);
      },
      {
        root: null,
        threshold: [0, 0.1, 0.25, 0.5],
        // 80px top guard (matches scroll-mt-20 = 80px), 40% bottom cutoff
        rootMargin: "-80px 0px -40% 0px",
      },
    );

    sectionKeys.split(",").forEach((key) => {
      const el = document.getElementById(`section-${key}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sectionKeys, setActiveKey]);
}

interface StickyTOCPanelProps {
  sections: ProjectSection[];
}

export function StickyTOCPanel({ sections }: StickyTOCPanelProps) {
  // Active key is owned here so the click handler can set it immediately
  // without waiting for the IntersectionObserver callback (rerender-move-effect-to-event)
  const [activeKey, setActiveKey] = useState<string | null>(sections?.[0]?.key ?? null);

  // Observer updates activeKey while the user scrolls manually
  useActiveSectionObserver(sections, setActiveKey);

  const scrollToSection = (key: string) => {
    // Immediately reflect the clicked section as active — don't wait for the observer
    setActiveKey(key);
    const el = document.getElementById(`section-${key}`);
    if (!el) return;
    // scrollIntoView respects scroll-margin-top (scroll-mt-20 = 80px) and
    // automatically scrolls the correct overflow-y ancestor — no manual math.
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!sections?.length) return null;

  return (
    // Fills the full grid-row height via stretch default — gives sticky room to travel
    <aside className="hidden lg:block min-w-0">
      <div className="sticky top-4">
        <div className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-border bg-background shadow-sm scrollbar-none">
          <TOCNav sections={sections} activeKey={activeKey} onSelect={scrollToSection} />
        </div>
      </div>
    </aside>
  );
}
