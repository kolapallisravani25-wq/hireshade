// ─── ProjectReportView ────────────────────────────────────────────────────────
//
// This file is intentionally thin.  All sub-components live in ./project-report/
// so each concern can be read, tested, and maintained in isolation:
//
//   types.ts           → TypeScript interfaces (ProjectResponse, ProjectSection…)
//   normalizeProject.ts → normalizeProject() + getSectionIcon()
//   CopyBtn.tsx        → clipboard copy button
//   renderers.tsx      → every section renderer + SectionRenderer switch
//   SectionBlock.tsx   → section header + renderer wrapper
//   TOC.tsx            → TOCNav, MobileTOCBar, StickyTOCPanel

import React from "react";
import { Sparkles, AlertCircle, Info, Clock, Users, Target } from "lucide-react";
import { Construction } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveProjectIndex } from "@/store/aiProjectsSlice";
import { normalizeProject } from "./project-report/normalizeProject";
import { SectionBlock }     from "./project-report/SectionBlock";
import { MobileTOCBar, StickyTOCPanel } from "./project-report/TOC";
import type { ProjectReportViewProps } from "./project-report/types";

// Re-export types so existing imports (e.g. aiProjectsSlice) keep working
export type { ProjectResponse, ProjectSection, ProjectReportViewProps } from "./project-report/types";

// ─── GlobeIcon (inline SVG — avoids a lucide bundle chunk for a single icon) ─

function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" x2="22" y1="12" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProjectReportView({
  projects,
  position,
  industry,
  experienceLevel,
  createdAt,
}: ProjectReportViewProps) {
  const dispatch = useAppDispatch();
  const activeIndex = useAppSelector((s) => s.aiProjects.activeProjectIndex);

  const normalizedProjects = React.useMemo(
    () => (Array.isArray(projects) ? projects.map(normalizeProject) : []),
    [projects],
  );

  if (!normalizedProjects.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-border rounded-xl">
        <Construction className="h-10 w-10 text-muted-foreground/20 mb-4" />
        <h3 className="text-base font-semibold text-foreground">Drafting your projects…</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          Generating production-grade documentation tailored to your profile.
        </p>
      </div>
    );
  }

  // Guard: clamp Redux index to valid range when a new record is loaded
  const safeIndex = Math.min(activeIndex, normalizedProjects.length - 1);
  const project   = normalizedProjects[safeIndex];

  return (
    <div className="space-y-4 pb-10">

      {/* ── Project Selector Tabs ──────────────────────────────────────── */}
      {normalizedProjects.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
          {normalizedProjects.map((p, i) => (
            <button
              key={i}
              onClick={() => dispatch(setActiveProjectIndex(i))}
              className={cn(
                "group w-full text-left rounded-xl border px-3.5 py-3 transition-all",
                i === safeIndex
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:border-foreground/20 hover:text-foreground",
              )}
            >
              <div className="flex items-start gap-2">
                <span className={cn(
                  "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                  i === safeIndex ? "bg-[#458fff]" : "bg-muted-foreground/30 group-hover:bg-[#458fff]/70",
                )} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight line-clamp-2">
                    {p.projectHeader?.title || `Project ${i + 1}`}
                  </p>
                  {p.projectHeader?.domain && (
                    <p className={cn(
                      "mt-1 text-xs truncate",
                      i === safeIndex ? "text-background/60" : "text-muted-foreground/70",
                    )}>
                      {p.projectHeader.domain}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/*
        ── Outer layout ──────────────────────────────────────────────────
        CRITICAL: Do NOT add `items-start` here. Default `items-stretch`
        makes both columns equal height to the grid row, which gives the
        right column the height it needs for sticky to travel the full
        length of the content column.
      */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_256px] lg:gap-4">

        {/* ── Left: Main Report Card ─────────────────────────────────── */}
        <div className="bg-background border border-border rounded-xl min-w-0">

          {project.scope_limited && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-t-xl bg-amber-50 border-b border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Scope limited to your skill set.</span>{" "}
                Some technologies were narrowed to match your resume. Upload a more detailed resume to unlock broader project scopes.
              </p>
            </div>
          )}

          {project.credibility_warning && (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-red-50 border-b border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-semibold">Credibility check.</span>{" "}
                Some outcome metrics may appear ambitious for the stated experience level. Review and adjust figures before using in interviews.
              </p>
            </div>
          )}

          {/* Hero */}
          <div className={cn(
            "px-4 py-4 sm:px-6 sm:py-5 border-b border-border bg-muted/20",
            !project.scope_limited && !project.credibility_warning && "rounded-t-xl",
          )}>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/60 font-medium">
                <Sparkles className="h-3 w-3 text-[#458fff]" />
                <span className="text-[#458fff] font-semibold">Generated project</span>
                {position         && <><span>·</span><span>{position}</span></>}
                {industry         && <><span>·</span><span>{industry}</span></>}
                {experienceLevel  && <><span>·</span><span>{experienceLevel}</span></>}
                {createdAt && (() => {
                  const d = new Date(createdAt);
                  return (
                    <>
                      <span>·</span>
                      <span>
                        {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {" "}
                        <span className="opacity-60">
                          {d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </span>
                    </>
                  );
                })()}
              </div>

              <h1 className="text-xl font-bold text-foreground tracking-tight leading-tight">
                {project.projectHeader?.title}
              </h1>

              {project.projectHeader?.tagline && (
                <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                  {project.projectHeader.tagline}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
                {[
                  { icon: Clock,     value: project.projectHeader?.duration },
                  { icon: Users,     value: project.projectHeader?.teamSize },
                  { icon: GlobeIcon, value: project.projectHeader?.domain },
                  ...(project.projectHeader?.role ? [{ icon: Target, value: project.projectHeader.role }] : []),
                ]
                  .filter((s) => s.value)
                  .map((stat, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <stat.icon className="h-3.5 w-3.5 text-[#458fff]/70" />
                      <span className="text-xs">{stat.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Mobile TOC */}
          <MobileTOCBar sections={project.sections} />

          {/* Sections */}
          <div className="divide-y divide-border">
            {project.sections?.map((section, idx) => (
              <SectionBlock key={section.key} section={section} index={idx + 1} />
            ))}
            <div className="px-4 py-4 sm:px-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/50 rounded-b-xl">
              <Sparkles className="h-3 w-3 text-[#458fff]" />
              <span className="font-medium">HireShade AI</span>
              <span>·</span>
              <span>AI-Generated Project Portfolio</span>
              {position && <><span>·</span><span>{position}</span></>}
            </div>
          </div>
        </div>

        {/* ── Right: Sticky TOC ──────────────────────────────────────── */}
        <StickyTOCPanel sections={project.sections} />
      </div>
    </div>
  );
}
