import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import {
  setActiveSection, toggleSection, toggleCustomSection,
  moveSectionUp, moveSectionDown,
} from "@/store/resumeBuilderSlice";
import { getSectionIcon, sectionHasContent, SECTION_ICONS } from "../types";
import {
  ChevronUp, ChevronDown, Lock, Sparkles, X, Plus,
} from "lucide-react";

/**
 * Left sidebar — section navigation list with reordering, add/remove controls,
 * and per-section AI/tailor badges.
 */
export function LeftPanel() {
  const dispatch      = useDispatch<AppDispatch>();
  const sections      = useSelector((s: RootState) => s.resumeBuilder.sections);
  const customDefs    = useSelector((s: RootState) => s.resumeBuilder.customSectionDefs);
  const activeSection = useSelector((s: RootState) => s.resumeBuilder.activeSection);
  const fields        = useSelector((s: RootState) => s.resumeBuilder.fields);
  const tailoredSections   = useSelector((s: RootState) => s.resumeBuilder.tailoredSections);
  const aiEnhancedSections = useSelector((s: RootState) => s.resumeBuilder.aiEnhancedSections);
  const [hovered, setHovered] = useState<string | null>(null);

  const allSections    = [...sections, ...customDefs];
  const enabled        = allSections.filter((s) => s.enabled);
  const disabledCore   = sections.filter((s) => !s.enabled && !s.required);
  const disabledCustom = customDefs.filter((s) => !s.enabled);

  return (
    <aside className="w-[210px] shrink-0 border-r border-slate-200/70 bg-white flex flex-col overflow-y-auto">
      <div className="px-4 pt-5 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Sections</p>
      </div>

      <nav className="flex-1 px-3 pb-4 space-y-px">
        {enabled.map((sec, idx) => {
          const Icon     = getSectionIcon(sec.id);
          const isActive = activeSection === sec.id;
          const hasCont  = sec.id in SECTION_ICONS
            ? sectionHasContent(sec.id, fields)
            : (() => { try { const m = JSON.parse(fields._customSections || "{}"); return !!(m[sec.id]?.trim()); } catch { return false; } })();
          const isHov    = hovered === sec.id;
          const isCustom = !sections.find((s) => s.id === sec.id);
          const isTailored = tailoredSections.includes(sec.id);
          const isAiEnh    = aiEnhancedSections.includes(sec.id);

          return (
            <div key={sec.id} className="relative" onMouseEnter={() => setHovered(sec.id)} onMouseLeave={() => setHovered(null)}>
              <button
                onClick={() => dispatch(setActiveSection(sec.id))}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-slate-100 text-slate-900 font-semibold"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-50 font-medium",
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0 transition-colors", hasCont ? "bg-emerald-400" : "bg-slate-200")} />
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate flex-1 text-left text-[13px]">{sec.label}</span>
                {!sec.required && (isTailored || isAiEnh) && (
                  <span
                    title={isTailored ? "Tailored to job description" : "Recently AI-enhanced"}
                    className={cn(
                      "shrink-0 h-4 w-4 rounded-md flex items-center justify-center",
                      isTailored ? "bg-violet-100 text-violet-600" : "bg-indigo-50 text-indigo-500",
                    )}
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                  </span>
                )}
                {sec.required && <Lock className={cn("h-3 w-3 shrink-0", isActive ? "text-slate-400" : "text-slate-300")} />}
              </button>

              {isHov && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-white rounded-md shadow-sm border border-slate-200 z-10 p-0.5">
                  <button onClick={(e) => { e.stopPropagation(); dispatch(moveSectionUp(sec.id)); }} disabled={idx === 0} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-25" title="Move up">
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); dispatch(moveSectionDown(sec.id)); }} disabled={idx === enabled.length - 1} className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted disabled:opacity-25" title="Move down">
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {!sec.required && (
                    <button
                      onClick={(e) => { e.stopPropagation(); if (isCustom) dispatch(toggleCustomSection(sec.id)); else dispatch(toggleSection(sec.id)); }}
                      className="h-5 w-5 rounded flex items-center justify-center hover:bg-red-50 text-red-400" title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {(disabledCore.length > 0 || disabledCustom.length > 0) && (
        <div className="px-3 pb-5 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 px-1 mb-2">Add Section</p>
          {disabledCore.map((sec) => (
            <button key={sec.id} onClick={() => dispatch(toggleSection(sec.id))} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors duration-150">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {sec.label}
            </button>
          ))}
          {disabledCustom.map((sec) => (
            <button key={sec.id} onClick={() => dispatch(toggleCustomSection(sec.id))} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors duration-150">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {sec.label}
              <span className="ml-auto text-[10px] text-muted-foreground/40 bg-muted px-1.5 rounded">detected</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
