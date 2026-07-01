import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import {
  updateField, setIsRewriting, applyRewrittenFields, recordAiActivity, setJobContext,
} from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, X, ChevronRight, Wand2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { AIToolStepHeader } from "./AIToolStepHeader";
import { TextPreviewDialog } from "./TextPreviewDialog";

export function FullRewritePanel({ onDone }: { onDone?: () => void } = {}) {
  const dispatch       = useDispatch<AppDispatch>();
  const fields         = useSelector((s: RootState) => s.resumeBuilder.fields);
  const savedResumeId  = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const isRewriting    = useSelector((s: RootState) => s.resumeBuilder.isRewriting);
  const jobTitle       = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const company        = useSelector((s: RootState) => s.resumeBuilder.company);
  const { getToken, userId: clerkUserId } = useAuth();
  const { refresh: refreshBalance } = useCreditsBalance();
  const { costFor } = useFeatureCosts();
  const rewriteCost = costFor(FEATURE_KEYS.RESUME_REWRITE, 4);

  const [targetTitle, setTargetTitle] = React.useState(jobTitle);
  const [targetCompany, setTargetCompany] = React.useState(company);
  const [targetLevel, setTargetLevel] = React.useState<string>("mid");
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"input" | "loading" | "review">("input");
  const [isSavingSuggestions, setIsSavingSuggestions] = React.useState(false);

  type SuggestionStatus = "pending" | "selected" | "skipped" | "applied";

  interface SuggestionItem {
    id: string;
    field: keyof ResumeFields;
    sectionId: string;
    title: string;
    before: string;
    after: string;
    reason: string;
    status: SuggestionStatus;
  }

  interface ReviewState {
    analysedAt: string;
    suggestions: SuggestionItem[];
    cached: boolean;
    creditsUsed: number;
  }

  const [reviewState, setReviewState] = React.useState<ReviewState | null>(null);

  const FIELD_META: Partial<Record<keyof ResumeFields, { sectionId: string; title: string }>> = {
    role: { sectionId: "personalInfo", title: "Role headline" },
    location: { sectionId: "personalInfo", title: "Location" },
    summary: { sectionId: "summary", title: "Summary" },
    experience: { sectionId: "experience", title: "Work experience" },
    skillsLanguages: { sectionId: "skills", title: "Skills → Languages" },
    skillsFrameworks: { sectionId: "skills", title: "Skills → Frameworks" },
    skillsDatabases: { sectionId: "skills", title: "Skills → Databases" },
    skillsTools: { sectionId: "skills", title: "Skills → Tools" },
    projects: { sectionId: "projects", title: "Projects" },
    education: { sectionId: "education", title: "Education" },
    certifications: { sectionId: "certifications", title: "Certifications" },
    publications: { sectionId: "publications", title: "Publications" },
  };

  const sectionLabelMap: Record<string, string> = {
    personalInfo: "Header",
    summary: "Summary",
    experience: "Experience",
    skills: "Skills",
    projects: "Projects",
    education: "Education",
    certifications: "Certifications",
    publications: "Publications",
  };

  React.useEffect(() => { setTargetTitle(jobTitle); }, [jobTitle]);
  React.useEffect(() => { setTargetCompany(company); }, [company]);
  React.useEffect(() => {
    if (step === "review" && !reviewState) setStep("input");
  }, [reviewState, step]);

  const buildSuggestions = React.useCallback(
    (tailoredFields: Partial<ResumeFields>, sourceFields: ResumeFields): SuggestionItem[] => {
      const list: SuggestionItem[] = [];
      (Object.keys(tailoredFields) as Array<keyof ResumeFields>).forEach((field) => {
        const meta = FIELD_META[field];
        if (!meta) return;
        const next = tailoredFields[field];
        if (typeof next !== "string") return;
        const before = (sourceFields[field] ?? "").trim();
        const after = next.trim();
        if (!after || before === after) return;
        list.push({
          id: `${String(field)}-${list.length}`,
          field,
          sectionId: meta.sectionId,
          title: meta.title,
          before,
          after,
          reason: "Rewritten to match the target role and seniority.",
          status: "pending",
        });
      });
      return list;
    },
    [],
  );

  const handleRewrite = React.useCallback(async () => {
    if (isRewriting || !targetTitle.trim()) return;
    setError(null);
    setStep("loading");
    setReviewState(null);
    dispatch(setIsRewriting(true));
    const idempotencyKey = createIdempotencyKey();
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();
      const payload: Record<string, unknown> = { userId, jobTitle: targetTitle.trim(), company: targetCompany.trim(), targetLevel };
      if (savedResumeId) payload.resumeId = savedResumeId; else payload.fields = fields;
      const { data, creditsUsed, creditsRemaining, cached } = await postCreditedAi<{ tailoredFields: Partial<ResumeFields> }>(
        ENDPOINTS.resumeBuilderRewrite(), payload, { token, idempotencyKey });
      
      const suggestions = buildSuggestions(data.tailoredFields ?? {}, fields);

      if (suggestions.length === 0) {
        toast.info("No meaningful section rewrites were found for this role.");
      }

      setReviewState({
        analysedAt: new Date().toISOString(),
        suggestions,
        cached,
        creditsUsed,
      });
      setStep("review");

      if (cached) {
        toast.success("Rewrite from cache · no credits used");
      } else if (creditsUsed > 0) {
        toast.success(`Resume rewritten · ${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used`);
      }
      
      dispatch(recordAiActivity({ operation: "resume_rewrite", label: "Full Rewrite", creditsUsed, cached, status: "success" }));
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      refreshBalance();
    } catch (err) {
      setStep("input");
      setError(err instanceof InsufficientCreditsError
        ? `Need ${rewriteCost} credits to rewrite. Top up to continue.`
        : err instanceof Error ? err.message : "Rewrite failed.");
      dispatch(recordAiActivity({ operation: "resume_rewrite", label: "Full Rewrite", creditsUsed: 0, cached: false, status: "error", errorMessage: err instanceof Error ? err.message : String(err) }));
    } finally { dispatch(setIsRewriting(false)); }
  }, [isRewriting, targetTitle, targetCompany, targetLevel, savedResumeId, fields, getToken, clerkUserId, dispatch, refreshBalance, rewriteCost, buildSuggestions]);

  const updateSuggestionStatus = React.useCallback((id: string, status: SuggestionStatus) => {
    setReviewState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) => (s.id === id ? { ...s, status } : s)),
      };
    });
  }, []);

  const applySuggestions = React.useCallback(
    async (mode: "all" | "selected") => {
      if (!reviewState || isSavingSuggestions) return;
      setIsSavingSuggestions(true);
      try {
        const toApply = reviewState.suggestions.filter(
          (s) => s.status === "pending" || s.status === "selected",
        );
        const active = mode === "selected" ? toApply.filter((s) => s.status === "selected") : toApply;
        if (active.length === 0) return;

        const partial: Partial<ResumeFields> = {};
        active.forEach((s) => {
          (partial as any)[s.field] = s.after;
        });

        dispatch(applyRewrittenFields({ fields: partial }));

        setReviewState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            suggestions: prev.suggestions.map((s) =>
              active.some((a) => a.id === s.id) ? { ...s, status: "applied" } : s,
            ),
          };
        });
        toast.success(`${active.length} section${active.length === 1 ? "" : "s"} updated`);
      } finally {
        setIsSavingSuggestions(false);
      }
    },
    [reviewState, isSavingSuggestions, dispatch],
  );

  const LEVELS = ["junior", "mid", "senior", "lead"] as const;

  const pendingCount = reviewState?.suggestions.filter((s) => s.status === "pending").length ?? 0;
  const selectedCount = reviewState?.suggestions.filter((s) => s.status === "selected").length ?? 0;
  const appliedCount = reviewState?.suggestions.filter((s) => s.status === "applied").length ?? 0;
  const skippedCount = reviewState?.suggestions.filter((s) => s.status === "skipped").length ?? 0;
  const hasReview = reviewState && reviewState.suggestions.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Fixed top: header + form inputs + action ── */}
      <div className="shrink-0 bg-background px-6 pt-6 pb-5 space-y-5 border-b border-border/50">

        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-slate-100 border border-border flex items-center justify-center shrink-0">
              <RefreshCw className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">Full Resume Rewrite</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">Rewrite all sections for a new role — no job description needed</p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-border shrink-0 mt-0.5 whitespace-nowrap">{rewriteCost} cr</span>
        </div>

        {step === "input" && (
          <>
            {/* Form inputs — flat, clean */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1.5 block">Target Job Title <span className="text-destructive">*</span></label>
                  <input type="text" value={targetTitle} onChange={(e) => setTargetTitle(e.target.value)} placeholder="e.g. Senior Data Engineer"
                    className={cn("w-full h-9 px-3 text-[13px] bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors", !targetTitle.trim() ? "border-destructive/40" : "border-border")} />
                  {!targetTitle.trim() && <p className="text-[11px] text-destructive mt-1">Required to rewrite your resume</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1.5 block">Company (optional)</label>
                  <input type="text" value={targetCompany} onChange={(e) => setTargetCompany(e.target.value)} placeholder="e.g. Netflix"
                    className="w-full h-9 px-3 text-[13px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground mb-1.5 block">Seniority Level</label>
                <div className="flex gap-2">
                  {LEVELS.map((lvl) => (
                    <button key={lvl} onClick={() => setTargetLevel(lvl)}
                      className={cn("px-3 h-8 rounded-lg text-[12px] font-medium border transition-colors", targetLevel === lvl ? "bg-slate-900 text-white border-slate-900" : "bg-background text-muted-foreground border-border hover:border-foreground/30")}>
                      {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Rewrites <strong className="text-foreground font-medium">summary, experience, skills, and projects</strong>. Employer names, job titles, and dates are never changed.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button onClick={handleRewrite} disabled={!targetTitle.trim() || isRewriting}
                className={cn("flex items-center gap-2 px-5 h-9 rounded-lg text-[13px] font-semibold transition-colors w-fit", targetTitle.trim() && !isRewriting ? "bg-slate-900 hover:bg-slate-700 text-white" : "bg-muted text-muted-foreground cursor-not-allowed")}>
                {isRewriting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {isRewriting ? "Rewriting…" : "Rewrite My Resume"}
              </button>
              {error && <p className="text-[12px] text-destructive flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
            </div>
          </>
        )}
      </div>

      {/* ── Scrollable area: loading & review ── */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/40 px-6 py-5 space-y-3">
        {step === "loading" && (
          <div className="rounded-xl border border-border bg-white p-6">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Rewriting resume sections</p>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                  Tailoring your experience, projects, and summary for a {targetLevel} {targetTitle} role.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full w-2/3 bg-slate-400 animate-pulse" /></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full w-1/2 bg-slate-400 animate-pulse" /></div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full w-3/4 bg-slate-400 animate-pulse" /></div>
            </div>
          </div>
        )}

        {step === "review" && hasReview && reviewState && (
          <div className="rounded-xl border border-border bg-white p-5 space-y-4">
            <div className="flex items-center gap-3 border-b border-border/50 pb-4">
              <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-foreground">Rewrite complete</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Analysed {new Date(reviewState.analysedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {reviewState.cached ? " · cache hit (free)" : ""}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
                Suggested changes ({reviewState.suggestions.length})
              </p>

              {reviewState.suggestions.length === 0 ? (
                <div className="rounded-lg border border-border bg-slate-50 p-4 text-[12px] text-muted-foreground">
                  No section-level rewrites were required.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {reviewState.suggestions.map((item) => {
                    const isApplied = item.status === "applied";
                    const isSkipped = item.status === "skipped";
                    const isSelected = item.status === "selected";
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-lg border p-3 transition-colors",
                          isApplied && "bg-emerald-50/50 border-emerald-200",
                          isSkipped && "bg-slate-50 border-slate-200 opacity-70",
                          !isApplied && !isSkipped && "bg-white border-border",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[13px] font-semibold text-foreground">{item.title}</p>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 border border-border text-slate-600">
                                {sectionLabelMap[item.sectionId] ?? item.sectionId}
                              </span>
                              {isApplied && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-200 text-emerald-700">
                                  Applied
                                </span>
                              )}
                              {isSkipped && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500">
                                  Skipped
                                </span>
                              )}
                            </div>
                            <p className="text-[12px] text-muted-foreground mt-1">{item.reason}</p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2.5">
                              <div className="group relative rounded-md border border-border bg-slate-50 px-2.5 py-2">
                                <div className="flex items-center justify-between mb-1 h-5">
                                  <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Before</p>
                                  <TextPreviewDialog title={item.title} label="Before" text={item.before || "—"} />
                                </div>
                                <div className="relative">
                                  <p className="text-[11px] text-slate-600 leading-relaxed max-h-16 overflow-hidden whitespace-pre-wrap">
                                    {item.before || "—"}
                                  </p>
                                  {(item.before || "").length > 150 && (
                                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none" />
                                  )}
                                </div>
                              </div>
                              <div className="group relative rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
                                <div className="flex items-center justify-between mb-1 h-5">
                                  <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">After</p>
                                  <TextPreviewDialog title={item.title} label="After" text={item.after} />
                                </div>
                                <div className="relative">
                                  <p className="text-[11px] text-emerald-800 leading-relaxed max-h-16 overflow-hidden whitespace-pre-wrap">
                                    {item.after}
                                  </p>
                                  {item.after.length > 150 && (
                                    <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-emerald-50/60 to-transparent pointer-events-none" />
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {!isApplied && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => updateSuggestionStatus(item.id, isSkipped ? "pending" : "skipped")}
                                className="text-[12px] font-semibold px-2.5 h-8 rounded-lg border border-border bg-white text-foreground hover:bg-slate-50 transition-colors"
                              >
                                {isSkipped ? "Undo" : "Skip"}
                              </button>
                              <button
                                onClick={() => updateSuggestionStatus(item.id, isSelected ? "pending" : "selected")}
                                className={cn(
                                  "text-[12px] font-semibold px-3 h-8 rounded-lg transition-colors",
                                  isSelected
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                    : "bg-emerald-600 text-white hover:bg-emerald-700",
                                )}
                              >
                                {isSelected ? "Selected" : "Apply"}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 pt-1 border-t border-border/60 pt-3">
              <span className="text-[11px] text-muted-foreground mr-auto">
                {appliedCount} applied · {selectedCount} selected · {pendingCount} pending · {skippedCount} skipped
              </span>

              <button
                onClick={() => applySuggestions("selected")}
                disabled={selectedCount === 0 || isSavingSuggestions}
                className={cn(
                  "text-[12px] font-semibold px-3 h-8 rounded-lg transition-colors",
                  selectedCount > 0 && !isSavingSuggestions
                    ? "bg-slate-900 text-white hover:bg-slate-700"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                Save Selected Changes
              </button>

              <button
                onClick={() => applySuggestions("all")}
                disabled={pendingCount === 0 || isSavingSuggestions}
                className={cn(
                  "text-[12px] font-semibold px-3 h-8 rounded-lg transition-colors",
                  pendingCount > 0 && !isSavingSuggestions
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                Apply All Changes
              </button>

              <button onClick={() => {
                setStep("input");
                setReviewState(null);
                onDone?.();
              }} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-border bg-white text-foreground hover:bg-slate-50 transition-colors">Done</button>
            </div>
          </div>
        )}

        {step === "input" && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="h-10 w-10 rounded-xl bg-slate-100 border border-border flex items-center justify-center mb-3">
              <RefreshCw className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-[13px] font-medium text-foreground">Enter a target role and click Rewrite</p>
            <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed max-w-[280px] mx-auto">AI rewrites every section to match your new role. Employer names, titles, and dates are never changed.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── InjectSkillsPanel ─────────────────────────────────────────────────────────────────────────────

// ─── SkillSuggestion type moved to ./types.ts ─────────────────────────────────

