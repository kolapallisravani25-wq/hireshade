import React from "react";
import { useSelector } from "react-redux";
import { cn } from "@/lib/utils";
import type { RootState } from "@/store/store";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import {
  Sparkles, Lock, ChevronRight, X, BookOpen,
  FileSearch, Wand2, RefreshCw, Zap, Tag, Search, FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

// ─── Tool Dialog Types ────────────────────────────────────────────────────────
export type ToolId = "ats" | "jdtailor" | "rewrite" | "injectskills" | "injectkeywords" | "keywordmatch" | "coverletter";

// ─── Tool definitions (shared between strip trigger and drawer) ───────────────
interface ToolDef {
  id: ToolId;
  label: string;
  description: string;
  detail: string;
  icon: React.ReactNode;
  badge: string;
  iconBg: string;
  iconColor: string;
  badgeCn: string;
  cardHover: string;
}

function useToolDefs(): ToolDef[] {
  const { costFor } = useFeatureCosts();
  const tailorCost  = costFor(FEATURE_KEYS.RESUME_TAILOR,          4);
  const rewriteCost = costFor(FEATURE_KEYS.RESUME_REWRITE,         4);
  const skillsCost  = costFor(FEATURE_KEYS.RESUME_INJECT_SKILLS,   1);
  const kwCost      = costFor(FEATURE_KEYS.RESUME_INJECT_KEYWORDS, 2);

  return React.useMemo<ToolDef[]>(() => [
    {
      id: "ats",
      label: "ATS Score",
      description: "Check keyword match against any JD",
      detail: "Instantly score your resume against a job description and see exactly which keywords you're missing.",
      icon: <FileSearch className="h-full w-full" />,
      badge: "FREE",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      badgeCn: "bg-emerald-100 text-emerald-700 border-emerald-200",
      cardHover: "hover:border-emerald-300 hover:bg-emerald-50/60",
    },
    {
      id: "jdtailor",
      label: "JD Tailor",
      description: "Align every section to a job posting",
      detail: "Paste a job description and let AI rephrase your bullets, summary, and skills to match it precisely.",
      icon: <Wand2 className="h-full w-full" />,
      badge: `${tailorCost} cr`,
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      badgeCn: "bg-violet-100 text-violet-700 border-violet-200",
      cardHover: "hover:border-violet-300 hover:bg-violet-50/60",
    },
    {
      id: "rewrite",
      label: "Full Rewrite",
      description: "Rewrite all sections for a new role",
      detail: "Provide a target role and the AI rewrites your entire resume — bullets, summary, skills — from scratch.",
      icon: <RefreshCw className="h-full w-full" />,
      badge: `${rewriteCost} cr`,
      iconBg: "bg-purple-100",
      iconColor: "text-purple-600",
      badgeCn: "bg-purple-100 text-purple-700 border-purple-200",
      cardHover: "hover:border-purple-300 hover:bg-purple-50/60",
    },
    {
      id: "injectskills",
      label: "Inject Skills",
      description: "Surface missing role-relevant skills",
      detail: "AI scans the job description and adds the technical skills you have but haven't listed yet.",
      icon: <Zap className="h-full w-full" />,
      badge: `${skillsCost} cr`,
      iconBg: "bg-sky-100",
      iconColor: "text-sky-600",
      badgeCn: "bg-sky-100 text-sky-700 border-sky-200",
      cardHover: "hover:border-sky-300 hover:bg-sky-50/60",
    },
    {
      id: "injectkeywords",
      label: "Bulk Keywords",
      description: "Weave JD keywords into your resume",
      detail: "Extracts high-value keywords from the JD and naturally weaves them into your existing bullet points.",
      icon: <Tag className="h-full w-full" />,
      badge: `${kwCost} cr`,
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      badgeCn: "bg-amber-100 text-amber-700 border-amber-200",
      cardHover: "hover:border-amber-300 hover:bg-amber-50/60",
    },
    {
      id: "keywordmatch",
      label: "Keyword Match",
      description: "See which JD keywords you cover",
      detail: "Visualise covered vs. missing keywords in seconds — no AI credits needed.",
      icon: <Search className="h-full w-full" />,
      badge: "FREE",
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      badgeCn: "bg-blue-100 text-blue-700 border-blue-200",
      cardHover: "hover:border-blue-300 hover:bg-blue-50/60",
    },
    {
      id: "coverletter",
      label: "Cover Letter",
      description: "Generate a tailored cover letter",
      detail: "Creates a professional, role-specific cover letter based on your resume and the target job.",
      icon: <FileText className="h-full w-full" />,
      badge: "↗",
      iconBg: "bg-slate-100",
      iconColor: "text-slate-500",
      badgeCn: "bg-slate-100 text-slate-600 border-slate-200",
      cardHover: "hover:border-slate-300 hover:bg-slate-50/60",
    },
  ], [tailorCost, rewriteCost, skillsCost, kwCost]);
}

// ─── AIToolsStrip ─────────────────────────────────────────────────────────────
// Renders a single "AI Tools" trigger button in the top bar.
// Clicking it opens a right-side Sheet listing all 7 tools.
// Selecting a tool closes the sheet and fires onOpen(toolId).

export function AIToolsStrip({ onOpen }: { onOpen: (tool: ToolId) => void }) {
  const navigate  = useNavigate();
  const tools     = useToolDefs();
  const [open, setOpen] = React.useState(false);

  const handleSelect = (tool: ToolDef) => {
    setOpen(false);
    if (tool.id === "coverletter") { navigate("/resume/cover-letter"); return; }
    // Small delay so sheet close animation finishes before dialog mounts
    setTimeout(() => onOpen(tool.id), 80);
  };

  return (
    <>
      {/* ── Thin trigger bar ───────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-slate-200/70 bg-white/95">
        <div className="flex items-center gap-3 px-5 h-11">
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-4 h-7 rounded-full border border-slate-200 bg-slate-50 text-slate-700 text-[12px] font-semibold hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all select-none"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            <span>AI Tools</span>
            <ChevronRight className="h-3 w-3 text-slate-400" />
          </button>

          {/* Quick-access icon pills — hover for rich tooltip, click to open tool */}
          <TooltipProvider delayDuration={80} skipDelayDuration={0}>
            <div className="flex items-center gap-1.5 flex-1 overflow-x-auto min-w-0" style={{ scrollbarWidth: "none" }}>
              {tools.map((tool) => (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleSelect(tool)}
                      className={cn(
                        "flex items-center justify-center h-7 w-7 rounded-full border bg-white shrink-0 transition-all hover:shadow-sm",
                        tool.iconColor,
                        "border-slate-200 hover:border-slate-300",
                      )}
                    >
                      <span className="h-3.5 w-3.5">{tool.icon}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    sideOffset={8}
                    className={cn(
                      "p-0 border shadow-lg rounded-xl overflow-hidden",
                      "bg-white border-slate-200/90",
                      "[&[data-state=delayed-open]]:duration-100 [&[data-state=closed]]:duration-75",
                    )}
                  >
                    <div className="px-3.5 py-2.5 max-w-[220px]">
                      {/* Label + badge row */}
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[12.5px] font-semibold text-slate-900 leading-none tracking-tight whitespace-nowrap">
                          {tool.label}
                        </p>
                        <span className={cn(
                          "text-[9.5px] font-bold px-1.5 py-0.5 rounded-full border leading-none shrink-0",
                          tool.badgeCn,
                        )}>
                          {tool.badge}
                        </span>
                      </div>
                      {/* Description */}
                      <p className="text-[11px] text-slate-500 leading-snug">{tool.description}</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Right-side drawer ──────────────────────────────────────────── */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[420px] sm:w-[480px] p-0 flex flex-col gap-0 overflow-hidden"
        >
          {/* Header */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <SheetTitle className="text-base font-semibold text-slate-900 leading-tight">
                  AI Tools
                </SheetTitle>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Choose a tool to enhance your resume
                </p>
              </div>
            </div>
          </SheetHeader>

          {/* Tool cards */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => handleSelect(tool)}
                className={cn(
                  "group w-full flex items-start gap-4 p-4 rounded-2xl border border-slate-200 bg-white text-left",
                  "transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1",
                  tool.cardHover,
                  "hover:shadow-md",
                )}
              >
                {/* Icon block */}
                <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5", tool.iconBg)}>
                  <div className={cn("h-5 w-5", tool.iconColor)}>{tool.icon}</div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-[13.5px] font-semibold text-slate-900 leading-none">
                      {tool.label}
                    </p>
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full border leading-none shrink-0",
                      tool.badgeCn,
                    )}>
                      {tool.badge}
                    </span>
                  </div>
                  <p className="text-[12px] font-medium text-slate-600 leading-snug">
                    {tool.description}
                  </p>
                  <p className="text-[11.5px] text-slate-400 leading-relaxed mt-1.5">
                    {tool.detail}
                  </p>
                </div>

                {/* Arrow */}
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 shrink-0 mt-3 transition-colors" />
              </button>
            ))}
          </div>

          {/* Footer hint */}
          <div className="shrink-0 border-t border-slate-100 px-6 py-3">
            <p className="text-[11px] text-slate-400 text-center">
              AI Enhance works directly inside each section editor
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── ToolDialogShell moved to ./components/ToolDialogShell.tsx ───────────────

// ═══════════════════════════════════════════════════════════════════════════════
//  PAGE ROOT
// ═══════════════════════════════════════════════════════════════════════════════

