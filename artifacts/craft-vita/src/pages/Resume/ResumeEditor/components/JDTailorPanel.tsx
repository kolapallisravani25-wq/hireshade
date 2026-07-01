import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import {
  applyTailoredFields, revertTailor, setJobContext, recordAiActivity, setIsEnhancing,
} from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Check, X, ChevronRight, Maximize2,
  Wand2, Target, AlertCircle, FileText, AlertTriangle,
} from "lucide-react";
import { SECTION_LABEL } from "../types";
import { AIToolStepHeader } from "./AIToolStepHeader";
import { TextPreviewDialog } from "./TextPreviewDialog";

export function JDTailorPanel({
  onDone,
  hasFreeRegenerate,
  onTailorRunSuccess,
}: {
  onDone?: () => void;
  hasFreeRegenerate?: boolean;
  onTailorRunSuccess?: () => void;
} = {}) {
  const dispatch       = useDispatch<AppDispatch>();
  const jobDescription = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const jobTitle       = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const company        = useSelector((s: RootState) => s.resumeBuilder.company);
  const savedResumeId  = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const fields         = useSelector((s: RootState) => s.resumeBuilder.fields);
  const preTailorSnapshot       = useSelector((s: RootState) => s.resumeBuilder.preTailorSnapshot);
  const [jdText, setJdText] = React.useState(jobDescription);
  const [isTailoring, setIsTailoring] = React.useState(false);
  const [isSavingSuggestions, setIsSavingSuggestions] = React.useState(false);
  const [tailorError, setTailorError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"input" | "loading" | "review">("input");
  const charCount = jdText.length;
  const { getToken, userId: clerkUserId } = useAuth();
  const { refresh: refreshBalance } = useCreditsBalance();
  const { costFor } = useFeatureCosts();
  const tailorCost = costFor(FEATURE_KEYS.RESUME_TAILOR, 4);

  type TailorSuggestionStatus = "pending" | "selected" | "skipped" | "applied";

  interface TailorSuggestionItem {
    id: string;
    field: keyof ResumeFields;
    sectionId: string;
    title: string;
    before: string;
    after: string;
    reason: string;
    status: TailorSuggestionStatus;
  }

  interface TailorReviewState {
    analysedAt: string;
    matchScore: number | null;
    keywordsMatched: string[];
    keywordsMissing: string[];
    suggestions: TailorSuggestionItem[];
    cached: boolean;
    creditsUsed: number;
  }

  const [reviewState, setReviewState] = React.useState<TailorReviewState | null>(null);

  const TAILOR_FIELD_META: Partial<
    Record<keyof ResumeFields, { sectionId: string; title: string }>
  > = {
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

  React.useEffect(() => { setJdText(jobDescription); }, [jobDescription]);
  React.useEffect(() => {
    if (step === "review" && !reviewState) setStep("input");
  }, [reviewState, step]);

  const buildReason = React.useCallback((before: string, after: string, jdKeywords: string[]): string => {
    const beforeLower = before.toLowerCase();
    const afterLower = after.toLowerCase();
    const addedKeywords = jdKeywords
      .filter((kw) => kw && afterLower.includes(kw.toLowerCase()) && !beforeLower.includes(kw.toLowerCase()))
      .slice(0, 2);

    if (addedKeywords.length > 0) {
      return `Added JD keyword${addedKeywords.length > 1 ? "s" : ""}: ${addedKeywords.join(", ")}`;
    }
    if (after.length > before.length + 30) {
      return "Expanded this section with more role-specific detail.";
    }
    return "Rephrased this section for tighter ATS alignment with the JD.";
  }, []);

  const buildSuggestions = React.useCallback(
    (tailoredFields: Partial<ResumeFields>, sourceFields: ResumeFields, jdKeywords: string[]): TailorSuggestionItem[] => {
      const list: TailorSuggestionItem[] = [];
      (Object.keys(tailoredFields) as Array<keyof ResumeFields>).forEach((field) => {
        const meta = TAILOR_FIELD_META[field];
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
          reason: buildReason(before, after, jdKeywords),
          status: "pending",
        });
      });
      return list;
    },
    [buildReason],
  );

  const handleTailor = React.useCallback(async () => {
    if (isTailoring || charCount < 50) return;
    setIsTailoring(true);
    setStep("loading");
    setTailorError(null);
    setReviewState(null);
    dispatch(setJobContext({ jobDescription: jdText }));
    // Per-click idempotency key. Server-side cache means the same JD text on
    // the same resume within 24h is served free regardless of this key, so
    // the user can hit "Regenerate" without paying again.
    const idempotencyKey = createIdempotencyKey();
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();

      // For manual (unsaved) resumes, pass current fields directly instead of a DB resumeId.
      // The backend handles both paths: DB lookup when resumeId is set, inline fields when absent.
      const payload: Record<string, unknown> = {
        userId,
        jobDescription: jdText,
      };
      // Always send target role + company so the backend prompt has its PRIMARY
      // signals. Even empty strings are better than undefined (backend uses ?? fallback).
      payload.jobTitle = (jobTitle ?? "").trim();
      payload.company  = (company  ?? "").trim();
      if (savedResumeId) {
        payload.resumeId = savedResumeId;
      } else {
        payload.fields = fields;
      }

      const { data, creditsUsed, creditsRemaining, cached } = await postCreditedAi<{
        tailoredFields: Partial<ResumeFields>;
        keywordsMatched?: string[];
        keywordsMissing?: string[];
        matchScore?: number;
      }>(
        ENDPOINTS.resumeBuilderTailor(),
        payload,
        { token, idempotencyKey },
      );

      const keywordsMatched = data.keywordsMatched ?? [];
      const keywordsMissing = data.keywordsMissing ?? [];
      const suggestions = buildSuggestions(
        data.tailoredFields ?? {},
        fields,
        [...new Set([...keywordsMatched, ...keywordsMissing])],
      );

      if (suggestions.length === 0) {
        toast.info("No meaningful section rewrites were found for this JD.");
      }

      setReviewState({
        analysedAt: new Date().toISOString(),
        matchScore: typeof data.matchScore === "number" ? data.matchScore : null,
        keywordsMatched,
        keywordsMissing,
        suggestions,
        cached,
        creditsUsed,
      });
      setStep("review");
      onTailorRunSuccess?.();

      if (cached) {
        toast.success("JD analysed from cache · no credits used");
      } else if (creditsUsed > 0) {
        toast.success(
          `JD analysed · ${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used · ${creditsRemaining.toFixed(2)} remaining`,
        );
      }
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      dispatch(recordAiActivity({
        operation: "resume_tailor",
        label: "JD Tailor",
        creditsUsed,
        cached,
        status: "success",
      }));
      refreshBalance();
    } catch (err) {
      setStep("input");
      if (err instanceof InsufficientCreditsError) {
        setTailorError(`Need ${tailorCost} credits to tailor. Top up to continue.`);
      } else {
        setTailorError(err instanceof Error ? err.message : "Tailoring failed. Please try again.");
      }
      dispatch(recordAiActivity({
        operation: "resume_tailor",
        label: "JD Tailor",
        creditsUsed: 0,
        cached: false,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setIsTailoring(false);
    }
  }, [isTailoring, charCount, getToken, savedResumeId, fields, jdText, jobTitle, company, refreshBalance, tailorCost, dispatch, buildSuggestions, onTailorRunSuccess]);

  const updateSuggestionStatus = React.useCallback((id: string, status: TailorSuggestionStatus) => {
    setReviewState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) => (s.id === id ? { ...s, status } : s)),
      };
    });
  }, []);

  const applySuggestions = React.useCallback((mode: "selected" | "all") => {
    if (!reviewState || isSavingSuggestions) return;

    const candidates = reviewState.suggestions.filter((s) => {
      if (s.status === "applied") return false;
      if (mode === "selected") return s.status === "selected";
      return s.status !== "skipped";
    });

    if (candidates.length === 0) {
      toast.info(mode === "selected" ? "Select at least one change first." : "No remaining changes to apply.");
      return;
    }

    const tailoredFields: Partial<ResumeFields> = {};
    candidates.forEach((item) => {
      tailoredFields[item.field] = item.after;
    });

    setIsSavingSuggestions(true);
    dispatch(
      applyTailoredFields({
        tailoredFields,
        keywordsMatched: reviewState.keywordsMatched,
        keywordsMissing: reviewState.keywordsMissing,
        matchScore: typeof reviewState.matchScore === "number" ? reviewState.matchScore : undefined,
      }),
    );

    setReviewState((prev) => {
      if (!prev) return prev;
      const appliedIds = new Set(candidates.map((c) => c.id));
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) =>
          appliedIds.has(s.id) ? { ...s, status: "applied" } : s,
        ),
      };
    });

    setIsSavingSuggestions(false);
    toast.success(`${candidates.length} change${candidates.length === 1 ? "" : "s"} applied to your resume.`);
  }, [reviewState, isSavingSuggestions, dispatch]);

  const selectedCount = reviewState?.suggestions.filter((s) => s.status === "selected").length ?? 0;
  const pendingCount = reviewState?.suggestions.filter((s) => s.status === "pending").length ?? 0;
  const appliedCount = reviewState?.suggestions.filter((s) => s.status === "applied").length ?? 0;
  const skippedCount = reviewState?.suggestions.filter((s) => s.status === "skipped").length ?? 0;

  const sectionLabelMap: Record<string, string> = {
    personalInfo: "Personal Info",
    summary: "Summary",
    experience: "Work Experience",
    skills: "Skills",
    projects: "Projects",
    education: "Education",
    certifications: "Certifications",
    publications: "Publications",
  };

  const isManualResume = !savedResumeId;
  const hasReview = !!reviewState;
  const canRegenerateFree = hasReview || !!hasFreeRegenerate;
  const stepItems = React.useMemo(
    () => [
      { id: "input", label: "Job Description" },
      { id: "loading", label: "Analyzing" },
      { id: "review", label: "Select Changes" },
    ],
    [],
  );
  const reviewScore = typeof reviewState?.matchScore === "number" ? Math.max(0, Math.min(100, Math.round(reviewState.matchScore))) : 0;
  const scoreDashArray = 188;
  const scoreDashOffset = scoreDashArray - (scoreDashArray * reviewScore) / 100;
  const reviewGrade = reviewScore >= 85 ? "Strong match" : reviewScore >= 70 ? "Decent match" : reviewScore >= 50 ? "Needs improvement" : "Low match";
  const reviewHint = reviewScore >= 85
    ? "Your resume is already well aligned to this JD."
    : reviewScore >= 70
      ? "Apply suggested changes to push above 90%."
      : "Applying the suggestions should significantly improve ATS alignment.";

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Fixed top: header + inputs + JD textarea + action ── */}
      <div className="shrink-0 bg-background px-6 pt-6 pb-5 space-y-5 border-b border-border/50">

        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-slate-100 border border-border flex items-center justify-center shrink-0">
              <Wand2 className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">JD Tailor</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {isManualResume ? "Build a complete resume tailored to the target job" : "Rewrite every section to match a specific job posting"}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 border border-violet-200/80 shrink-0 mt-0.5 whitespace-nowrap">{tailorCost} cr · regen free</span>
        </div>

        <AIToolStepHeader steps={stepItems} current={step} />

        {step === "input" && (
          <>
            {isManualResume && (
              <div className="flex items-start gap-2.5 bg-slate-50 border border-border rounded-xl px-4 py-3">
                <Sparkles className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  <span className="font-medium text-foreground">Building from scratch.</span> AI will craft a complete, ATS-optimised resume from the job description — summary, experience, skills, projects and more.
                </p>
              </div>
            )}

            {/* Target role inputs — clean, no heavy card bg */}
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Target Role</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1.5 block">Job Title <span className="text-destructive">*</span></label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => dispatch(setJobContext({ jobTitle: e.target.value }))}
                    placeholder="e.g. Senior Data Engineer"
                    className={cn(
                      "w-full h-9 px-3 text-[13px] bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors",
                      !jobTitle.trim() ? "border-destructive/40" : "border-border"
                    )}
                  />
                  {!jobTitle.trim() && <p className="text-[11px] text-destructive mt-1">Required to tailor your resume</p>}
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1.5 block">Company</label>
                  <input
                    type="text"
                    value={company}
                    onChange={(e) => dispatch(setJobContext({ company: e.target.value }))}
                    placeholder="e.g. Netflix"
                    className="w-full h-9 px-3 text-[13px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring transition-colors"
                  />
                </div>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Rewrites <strong className="text-foreground font-medium">summary, experience, skills, and projects</strong>. Company names, titles, and dates are preserved.
              </p>
            </div>

            {/* JD textarea — borderless inner, clean outer container */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/60 bg-muted/20 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Job Description</span>
                <span className="text-[10px] text-muted-foreground">{charCount > 0 ? `${charCount} chars` : "Paste JD"}</span>
              </div>
              <Textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the full job description here. We'll analyse keywords, extract requirements, and rewrite your resume sections to maximise ATS match rate…"
                className="border-none rounded-none min-h-[110px] max-h-[190px] overflow-y-auto resize-none text-[13px] bg-background focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-3.5 placeholder:text-muted-foreground/40 leading-relaxed"
              />
            </div>

            {/* CTA row */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTailor}
                  disabled={charCount < 50 || isTailoring || !jobTitle.trim()}
                  className={cn(
                    "flex items-center gap-2 px-5 h-9 rounded-lg text-[13px] font-semibold transition-colors",
                    charCount >= 50 && !isTailoring && jobTitle.trim()
                      ? "bg-slate-900 hover:bg-slate-700 text-white"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  {isTailoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                  {isTailoring ? "Tailoring…" : canRegenerateFree ? "Regenerate (free)" : "Tailor My Resume"}
                </button>
                {!jobTitle.trim() && <p className="text-[12px] text-muted-foreground">Enter a job title to continue</p>}
                {jobTitle.trim() && charCount > 0 && charCount < 50 && !isTailoring && (
                  <p className="text-[12px] text-muted-foreground">Paste at least 50 characters</p>
                )}
              </div>
              {tailorError && (
                <p className="text-[12px] text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{tailorError}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Scrollable results: review state + how-it-works ── */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/40 px-6 py-5 space-y-3">
        {step === "loading" && (
          <div className="rounded-xl border border-border bg-white p-6">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-50 border border-violet-200 flex items-center justify-center shrink-0">
                <Loader2 className="h-4 w-4 animate-spin text-violet-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Analyzing JD and generating section-level rewrites</p>
                <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                  Matching keywords, extracting intent, and preparing before/after suggestions for each section.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full w-2/3 bg-violet-400 animate-pulse" />
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full w-1/2 bg-violet-400 animate-pulse" />
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full w-3/4 bg-violet-400 animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {step === "review" && hasReview && reviewState && (
          <div className="rounded-xl border border-border bg-white p-5 space-y-4">
            <div className="rounded-xl border border-border bg-slate-50/60 p-4 flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 70 70" aria-hidden="true">
                  <circle cx="35" cy="35" r="30" stroke="currentColor" strokeWidth="6" fill="none" className="text-slate-200" />
                  <circle
                    cx="35"
                    cy="35"
                    r="30"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={scoreDashArray}
                    strokeDashoffset={scoreDashOffset}
                    strokeLinecap="round"
                    className="text-amber-500 transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-bold tabular-nums text-foreground">{reviewScore}%</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Match</span>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground">{reviewGrade}</p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">{reviewHint}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Analysed {new Date(reviewState.analysedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {reviewState.cached ? " · cache hit (free)" : ""}
                </p>
              </div>
            </div>

            {(reviewState.keywordsMatched.length > 0 || reviewState.keywordsMissing.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {reviewState.keywordsMatched.length > 0 && (
                  <div className="rounded-lg bg-slate-50 border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Matched keywords ({reviewState.keywordsMatched.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {reviewState.keywordsMatched.slice(0, 12).map((k) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-border text-slate-600">{k}</span>
                      ))}
                      {reviewState.keywordsMatched.length > 12 && <span className="text-[10px] text-muted-foreground">+{reviewState.keywordsMatched.length - 12}</span>}
                    </div>
                  </div>
                )}
                {reviewState.keywordsMissing.length > 0 && (
                  <div className="rounded-lg bg-slate-50 border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 mb-1.5">Still missing ({reviewState.keywordsMissing.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {reviewState.keywordsMissing.slice(0, 12).map((k) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-200 text-amber-700">{k}</span>
                      ))}
                      {reviewState.keywordsMissing.length > 12 && <span className="text-[10px] text-muted-foreground">+{reviewState.keywordsMissing.length - 12}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
                Suggested changes ({reviewState.suggestions.length})
              </p>

              {reviewState.suggestions.length === 0 ? (
                <div className="rounded-lg border border-border bg-slate-50 p-4 text-[12px] text-muted-foreground">
                  No section-level rewrites were returned for this JD.
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

              <button onClick={() => onDone?.()} className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-border bg-white text-foreground hover:bg-slate-50 transition-colors">Done</button>

              {preTailorSnapshot && Object.keys(preTailorSnapshot).length > 0 && (
                <button
                  onClick={() => {
                    if (confirm("Revert tailored changes? Your pre-tailor content will be restored.")) {
                      dispatch(revertTailor());
                      toast.success("Tailored changes reverted");
                    }
                  }}
                  className="text-[12px] font-semibold px-3 h-8 rounded-lg border border-border bg-white text-foreground hover:bg-slate-50 transition-colors"
                >
                  Revert
                </button>
              )}
            </div>
          </div>
        )}

        {step === "input" && (
          <div className="rounded-xl border border-border bg-white p-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">How it works</p>
            <div className="space-y-2.5">
              {[
                { n: "1", text: "Paste the job description from any job board" },
                { n: "2", text: "AI extracts required skills, keywords, and tone" },
                { n: "3", text: "Review section-wise suggested rewrites with before/after" },
                { n: "4", text: "Apply selected changes or apply all, then save to resume" },
              ].map((step) => (
                <div key={step.n} className="flex items-start gap-3">
                  <span className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-border w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5">{step.n}</span>
                  <p className="text-[13px] text-muted-foreground leading-snug">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── RightPanel ───────────────────────────────────────────────────────────────

/** Scales the A4 iframe (794 × 1123 px) to fill the preview container.
 *
 * RAF throttling: ResizeObserver can fire many times per frame (e.g. on window
 * resize). We cancel any pending RAF before scheduling a new one so we process
 * at most one update per animation frame — this eliminates the "stutter"
 * caused by rapid consecutive React state updates.                (rerender-use-ref-transient-values)
 *
 * Guard: only calls setState when the scale changes by > 0.001 to avoid
 * unnecessary re-renders for sub-pixel width fluctuations.
 */
