import { memo } from "react";
import { cn } from "@/lib/utils";
import { getSectionIcon } from "./normalizeProject";
import { SectionRenderer } from "./renderers";
import type { ProjectSection } from "./types";

interface SectionBlockProps {
  section: ProjectSection;
  index: number;
}

// React.memo: skips re-render when parent switches tabs but this section is unchanged
export const SectionBlock = memo(function SectionBlock({ section, index }: SectionBlockProps) {
  const Icon = getSectionIcon(section.key);
  return (
    <section id={`section-${section.key}`} className="scroll-mt-20 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-[#458fff]/10 text-[#458fff] shrink-0 mt-0.5">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground/50 tabular-nums">
              {String(index).padStart(2, "0")}
            </span>
            <h2 className="text-sm font-semibold text-foreground leading-none">{section.title}</h2>
          </div>
          <p className="text-xs text-muted-foreground">{section.subtitle}</p>
        </div>
      </div>
      <SectionRenderer section={section} />
    </section>
  );
});
