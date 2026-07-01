import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import type { ResumeFields, SectionQuality } from "@/store/resumeBuilderSlice";
import { applyAiSuggestion, discardAiSuggestion } from "@/store/resumeBuilderSlice";
import { sectionAIText } from "../types";
import {
  Sparkles, X, Check, TrendingUp, Loader2,
  AlertTriangle, ChevronRight,
} from "lucide-react";

// ─── AiDiffPanel ──────────────────────────────────────────────────────────────

const SKILL_PREVIEW_FIELDS: Array<{ label: string; key: keyof ResumeFields }> = [
  { label: "Languages", key: "skillsLanguages" },
  { label: "Frameworks & Libraries", key: "skillsFrameworks" },
  { label: "Databases", key: "skillsDatabases" },
  { label: "Tools & Platforms", key: "skillsTools" },
];

function SkillsPreviewRows({
  fields,
  muted,
}: {
  fields: Partial<ResumeFields>;
  muted?: boolean;
}) {
  return (
    <div className="space-y-2">
      {SKILL_PREVIEW_FIELDS.map(({ label, key }) => {
        const value = fields[key]?.trim();
        return (
          <div key={key} className="rounded-lg border border-border/60 bg-background/70 px-3 py-2">
            <div className={cn(
              "text-[10px] font-bold uppercase tracking-wider mb-1",
              muted ? "text-muted-foreground" : "text-[var(--color-brand)]",
            )}>
              {label}
            </div>
            <div className={cn(
              "text-xs leading-relaxed",
              muted ? "text-muted-foreground" : "text-foreground",
            )}>
              {value || "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Shows a before/after diff when an AI-enhanced suggestion is ready. */
export function AiDiffPanel() {
  const dispatch     = useDispatch<AppDispatch>();
  const aiSuggestion = useSelector((s: RootState) => s.resumeBuilder.aiSuggestion);
  const aiSuggestionFields = useSelector((s: RootState) => s.resumeBuilder.aiSuggestionFields);
  const aiSectionId  = useSelector((s: RootState) => s.resumeBuilder.aiSectionId);
  const fields       = useSelector((s: RootState) => s.resumeBuilder.fields);

  if (!aiSuggestion || !aiSectionId) return null;

  const currentText = sectionAIText(aiSectionId, fields);
  const isStructuredSkills = aiSectionId === "skills" && !!aiSuggestionFields;

  return (
    <div className="rounded-2xl border border-[var(--color-brand)]/20 bg-background shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-[var(--color-brand-muted)]/60">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-lg bg-[var(--color-brand)]/15 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
          </div>
          <span className="text-sm font-bold text-foreground">AI Enhancement Ready</span>
        </div>
        <button onClick={() => dispatch(discardAiSuggestion())} className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border max-h-80 overflow-auto">
        <div className="p-4 space-y-2">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current</span>
          </div>
          {isStructuredSkills ? (
            <SkillsPreviewRows fields={fields} muted />
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">{currentText || "(empty)"}</p>
          )}
        </div>
        <div className="p-4 space-y-2 bg-[var(--color-brand-muted)]/40">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-brand)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-brand)]">AI Enhanced</span>
          </div>
          {isStructuredSkills ? (
            <SkillsPreviewRows fields={aiSuggestionFields} />
          ) : (
            <p className="text-xs leading-relaxed whitespace-pre-line">{aiSuggestion}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-5 py-3.5 border-t border-border bg-muted/20">
        <button onClick={() => dispatch(applyAiSuggestion())} className="flex items-center gap-1.5 px-5 h-8 rounded-xl bg-[var(--color-brand)] hover:bg-[var(--color-brand-hover)] text-white text-sm font-semibold transition-colors">
          <Check className="h-3.5 w-3.5" /> Apply Changes
        </button>
        <button onClick={() => dispatch(discardAiSuggestion())} className="flex items-center gap-1.5 px-5 h-8 rounded-xl border border-border hover:bg-muted/60 text-sm font-medium transition-colors">
          <X className="h-3.5 w-3.5" /> Discard
        </button>
      </div>
    </div>
  );
}

// ─── SectionQualityMeter ──────────────────────────────────────────────────────

const QUALITY_COLORS = {
  excellent:        { bar: "#22c55e", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200/60", label: "Excellent" },
  good:             { bar: "#84cc16", bg: "bg-lime-50",    text: "text-lime-700",    border: "border-lime-200/60",    label: "Good"      },
  needs_improvement:{ bar: "#f59e0b", bg: "bg-amber-50",  text: "text-amber-700",   border: "border-amber-200/60",  label: "Needs work"},
  poor:             { bar: "#ef4444", bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200/60",    label: "Poor"      },
} as const;

/** Animated quality score bar with issues/suggestions for a resume section. */
export function SectionQualityMeter({ quality }: { quality: SectionQuality | undefined }) {
  const [open, setOpen] = useState(false);
  if (!quality) return null;

  const { score, status, issues, suggestions, constraints, wordCount, isValidating } = quality;
  const colors   = QUALITY_COLORS[status] ?? QUALITY_COLORS.needs_improvement;
  const wordPct  = Math.min(100, (wordCount / constraints.maxWords) * 100);
  const inRange  = wordCount >= constraints.minWords && wordCount <= constraints.maxWords;
  const tooShort = wordCount < constraints.minWords;
  const wordBadgeColor = inRange ? "text-emerald-600" : tooShort ? "text-amber-600" : "text-red-600";

  return (
    <div className={cn("rounded-2xl border p-4 space-y-3 transition-all duration-300", colors.bg, colors.border, isValidating && "opacity-60")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className={cn("h-4 w-4 shrink-0", colors.text)} />
          <span className={cn("text-sm font-semibold", colors.text)}>Section Quality</span>
          {isValidating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", colors.bg, colors.text, colors.border)}>{colors.label}</span>
          <span className={cn("text-base font-black tabular-nums", colors.text)}>
            {score}<span className="text-xs font-semibold opacity-60">/100</span>
          </span>
        </div>
      </div>

      <div className="relative h-1.5 rounded-full bg-black/8 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700" style={{ width: `${score}%`, background: colors.bar }} />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          <span className={cn("font-semibold", wordBadgeColor)}>{wordCount}</span>{" "}words{" "}
          <span className="opacity-60">· ideal {constraints.minWords}–{constraints.maxWords}</span>
        </span>
        <div className="relative w-24 h-1 rounded-full bg-black/8 overflow-visible">
          <div className="absolute inset-y-0 rounded-full bg-emerald-400/30" style={{ left: `${(constraints.minWords / constraints.maxWords) * 100}%`, width: `${Math.max(0, Math.min(100, 100 - (constraints.minWords / constraints.maxWords) * 100))}%` }} />
          <div className={cn("absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm transition-all duration-500", inRange ? "bg-emerald-500" : tooShort ? "bg-amber-500" : "bg-red-500")} style={{ left: `${Math.min(100, wordPct)}%` }} />
        </div>
      </div>

      {constraints.reason && <p className="text-[10px] text-muted-foreground/70 italic leading-relaxed">{constraints.reason}</p>}

      {(issues.length > 0 || suggestions.length > 0) && (
        <div>
          <button onClick={() => setOpen((p) => !p)} className={cn("flex items-center gap-1 text-xs font-medium transition-colors", colors.text, "opacity-80 hover:opacity-100")}>
            <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
            {issues.length} issue{issues.length !== 1 ? "s" : ""}
            {suggestions.length > 0 && ` · ${suggestions.length} suggestion${suggestions.length !== 1 ? "s" : ""}`}
          </button>
          {open && (
            <div className="mt-2 space-y-2">
              {issues.length > 0 && (
                <ul className="space-y-1">
                  {issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />{issue}
                    </li>
                  ))}
                </ul>
              )}
              {suggestions.length > 0 && (
                <ul className="space-y-1 pt-1 border-t border-black/8">
                  {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                      <Sparkles className="h-3 w-3 shrink-0 text-violet-400 mt-0.5" />{s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
