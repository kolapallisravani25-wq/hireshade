import { useState, useCallback, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import {
  Sparkles,
  Briefcase,
  GraduationCap,
  ListChecks,
  FileText,
  AlertCircle,
  Wand2,
  BookOpen,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label }    from "@/components/ui/label";
import { Input }    from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResumeSelector, Resume } from "@/components/Resume/ResumeSelector";
import { AIProjectsTable, ActiveJob } from "@/components/AI projects/AIProjectsTable";
import { ENDPOINTS } from "@/lib/endpoints";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import type { RootState, AppDispatch } from "@/store/store";
import {
  setFormPosition,
  setFormIndustry,
  setFormExperienceLevel,
  setFormJobDescription,
  setFormResumeId,
  setFormGenerationMode,
  startGeneration,
  addStreamedProject,
  finishGeneration,
  setGenerationError,
  resetGeneration,
  finishRegenJob,
  errorRegenJob as errorRegenJobAction,
} from "@/store/aiProjectsSlice";
import type { ProjectResponse } from "@/components/AI projects/ProjectReportView";

// ─── Pending generation persistence ──────────────────────────────────────────────
const PENDING_GEN_KEY = "cv_pending_gen";
const GEN_TOAST_ID    = "cv-ai-gen";
const MAX_POLL_MS     = 10 * 60 * 1000; // 10 minutes

interface PendingGeneration {
  position:        string;
  industry:        string;
  experienceLevel: string;
  startedAt:       number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_TYPES = [
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "Data Engineer",
  "Machine Learning Engineer",
  "DevOps / Platform Engineer",
  "Mobile Developer",
  "Cloud Architect",
  "QA Engineer",
  "Technical Lead",
  "Marketing Manager",
  "Product Manager",
  "Data Analyst",
  "Business Analyst",
  "UX Designer",
  "Other",
];

const INDUSTRIES = [
  "Banking & Financial Services",
  "E-Commerce / Retail",
  "HealthTech / Healthcare",
  "EdTech / Education",
  "FinTech / Payments",
  "Logistics & Supply Chain",
  "SaaS / B2B Software",
  "Media & Entertainment",
  "Telecom",
  "Government / Public Sector",
  "Consumer Goods / FMCG",
  "Cybersecurity",
  "Real Estate / PropTech",
  "Energy / CleanTech",
  "Travel & Hospitality",
  "Other",
];

const EXPERIENCE_LEVELS = [
  "0–1 years (Fresher)",
  "1–3 years (Junior)",
  "3–5 years (Mid-level)",
  "5–8 years (Senior)",
  "8–12 years (Staff / Lead)",
  "12+ years (Principal / Architect)",
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AIProjectsPage() {
  const dispatch     = useDispatch<AppDispatch>();
  const { getToken } = useAuth();
  const { balance }  = useCreditsBalance();

  const {
    formPosition,
    formIndustry,
    formExperienceLevel,
    formJobDescription,
    formResumeId,
    formGenerationMode,
    generationStatus,
    generationError,
    streamingProjects,
    regenJob,
  } = useSelector((s: RootState) => s.aiProjects);

  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [refreshTrigger,  setRefreshTrigger]  = useState(0);
  const [customPosition,  setCustomPosition]  = useState("");
  const [customIndustry,  setCustomIndustry]  = useState("");
  /** True when we restored a pending generation from localStorage (poll-mode) */
  const [pollingMode,     setPollingMode]     = useState(false);
  const streamCountRef = useRef(0);

  // ── Keep streamCountRef in sync ────────────────────────────────────────
  useEffect(() => {
    streamCountRef.current = streamingProjects.length;
  }, [streamingProjects.length]);

  // ── Restore pending generation on mount (survives page refresh) ────────
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_GEN_KEY);
    if (!raw) return;
    try {
      const pending = JSON.parse(raw) as PendingGeneration;
      // If stale, discard
      if (Date.now() - pending.startedAt > MAX_POLL_MS) {
        localStorage.removeItem(PENDING_GEN_KEY);
        return;
      }
      // Restore form fields so the active-job row shows the right title
      dispatch(setFormPosition(pending.position));
      if (pending.industry)        dispatch(setFormIndustry(pending.industry));
      if (pending.experienceLevel) dispatch(setFormExperienceLevel(pending.experienceLevel));
      // Show in-progress row
      dispatch(startGeneration());
      setPollingMode(true);
      toast.loading("Checking generation status…", { id: GEN_TOAST_ID });
    } catch {
      localStorage.removeItem(PENDING_GEN_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // ── Poll when in polling mode (tab was refreshed mid-generation) ────────
  useEffect(() => {
    if (!pollingMode) return;

    let cancelled = false;

    const checkStatus = async () => {
      const raw = localStorage.getItem(PENDING_GEN_KEY);
      if (!raw) { setPollingMode(false); return; }

      const pending = JSON.parse(raw) as PendingGeneration;

      // Timeout guard
      if (Date.now() - pending.startedAt > MAX_POLL_MS) {
        if (cancelled) return;
        setPollingMode(false);
        localStorage.removeItem(PENDING_GEN_KEY);
        dispatch(setGenerationError("Generation timed out. Please try again."));
        toast.error("Generation timed out", { id: GEN_TOAST_ID });
        return;
      }

      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const res = await fetch(ENDPOINTS.projectsMine(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const projects: Array<{ id: string; createdAt: string }> = Array.isArray(data)
          ? data
          : Array.isArray((data as { data?: { id: string; createdAt: string }[] }).data)
          ? ((data as { data: { id: string; createdAt: string }[] }).data)
          : [];
        const newProject = projects.find(
          (p) => new Date(p.createdAt).getTime() > pending.startedAt,
        );
        if (newProject) {
          if (cancelled) return;
          setPollingMode(false);
          localStorage.removeItem(PENDING_GEN_KEY);
          dispatch(finishGeneration({ recordId: newProject.id }));
          toast.success("AI projects generated!", { id: GEN_TOAST_ID });
          setRefreshTrigger((k) => k + 1);
        }
      } catch { /* ignore network errors */ }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pollingMode, dispatch, getToken]);

  // Refresh the table when a background regen finishes (regenJob cleared → null)
  const prevRegenJobRef = useRef(regenJob);
  useEffect(() => {
    if (prevRegenJobRef.current !== null && regenJob === null) {
      setRefreshTrigger((k) => k + 1);
    }
    prevRegenJobRef.current = regenJob;
  }, [regenJob]);

  // ── Form validity ────────────────────────────────────────────────────
  const isFormValid = !!formResumeId;

  // ── Generate ───────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!isFormValid) return;

    // Close dialog immediately when generation starts
    setDialogOpen(false);
    dispatch(startGeneration());

    // Persist so the generating row survives a page refresh
    const pendingGen: PendingGeneration = {
      position:        formPosition,
      industry:        formIndustry,
      experienceLevel: formExperienceLevel,
      startedAt:       Date.now(),
    };
    localStorage.setItem(PENDING_GEN_KEY, JSON.stringify(pendingGen));
    toast.loading("Generating AI projects…", { id: GEN_TOAST_ID });

    try {
      const token = await getToken();
      const storedUserId = localStorage.getItem("userId") ?? undefined;
      const effectivePosition = formPosition === "Other" ? customPosition.trim() : formPosition;
      const effectiveIndustry  = formIndustry  === "Other" ? customIndustry.trim()  : formIndustry;

      const body: Record<string, string> = {
        generationMode: formGenerationMode,
      };
      if (storedUserId)        body.userId          = storedUserId;
      if (formResumeId)        body.resumeId        = formResumeId;
      if (effectivePosition)   body.position        = effectivePosition;
      if (formJobDescription.trim()) body.jobDescription = formJobDescription.trim();
      if (effectiveIndustry)   body.industry        = effectiveIndustry;
      if (formExperienceLevel) body.experienceLevel = formExperienceLevel;

      const res = await fetch(ENDPOINTS.projectsGenerate(), {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errMsg = (err as { error?: string }).error ?? "Generation failed";
        localStorage.removeItem(PENDING_GEN_KEY);
        dispatch(setGenerationError(errMsg));
        toast.error(errMsg, { id: GEN_TOAST_ID });
        return;
      }

      if (!res.body) {
        localStorage.removeItem(PENDING_GEN_KEY);
        dispatch(setGenerationError("ReadableStream not supported"));
        toast.error("ReadableStream not supported", { id: GEN_TOAST_ID });
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";
      const DELIM   = "|||PROJECT_END|||";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(DELIM);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const trimmed = part.trim().replace(/^```json\n?/i, "").replace(/\n?```$/i, "").trim();
          if (!trimmed) continue;
          try {
            dispatch(addStreamedProject(JSON.parse(trimmed) as ProjectResponse));
          } catch { /* skip malformed */ }
        }
      }

      localStorage.removeItem(PENDING_GEN_KEY);
      dispatch(finishGeneration({ recordId: undefined }));
      toast.success("AI projects generated!", { id: GEN_TOAST_ID });
      // Wait briefly for DB write to commit, then refresh the table
      setTimeout(() => setRefreshTrigger((k) => k + 1), 800);
      // Second refresh as safety net in case the first fires before the write lands
      setTimeout(() => setRefreshTrigger((k) => k + 1), 3000);
    } catch (err) {
      localStorage.removeItem(PENDING_GEN_KEY);
      const errMsg = (err as Error).message || "Unexpected error";
      dispatch(setGenerationError(errMsg));
      toast.error(errMsg, { id: GEN_TOAST_ID });
    }
  }, [dispatch, getToken, isFormValid, formPosition, customPosition, formJobDescription, formResumeId, formIndustry, customIndustry, formExperienceLevel, formGenerationMode]);

  const handleResumeSelect = (resume: Resume | null) => {
    dispatch(setFormResumeId(resume?.id ?? null));
  };

  const handleOpenDialog = () => {
    if (generationStatus !== "generating") dispatch(resetGeneration());
    setDialogOpen(true);
  };

  // Active job for the in-progress table row.
  // Priority: a regen started from the detail page wins over a fresh generation.
  const activeJob: ActiveJob | undefined = regenJob
    ? {
        position:  regenJob.position,
        industry:  regenJob.industry,
        status:    regenJob.status,
        count:     regenJob.count,
        error:     regenJob.error,
        onRetry:   () => { /* regen is fire-and-forget; user can open the record and retry */ },
        onDismiss: () => dispatch(finishRegenJob()),
      }
    : generationStatus === "generating" || generationStatus === "error"
    ? {
        position:  formPosition,
        industry:  formIndustry,
        status:    generationStatus as "generating" | "error",
        count:     streamingProjects.length,
        error:     generationError ?? undefined,
        onRetry:   handleGenerate,
        onDismiss: () => {
          localStorage.removeItem(PENDING_GEN_KEY);
          setPollingMode(false);
          toast.dismiss(GEN_TOAST_ID);
          dispatch(resetGeneration());
        },
      }
    : undefined;

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-7xl mx-auto w-full">

      {/* Toolbar row — Generate button aligned right above the table */}
      <div className="flex items-center justify-end">
        <Button
          onClick={handleOpenDialog}
          disabled={generationStatus === "generating"}
          className="gap-2 h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs tracking-wide shadow-md shadow-slate-900/10"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate Project
        </Button>
      </div>

      {/* Table — includes in-progress row and refreshes after generation */}
      <AIProjectsTable activeJob={activeJob} refreshTrigger={refreshTrigger} />

      {/* ── Generate Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => {
        setDialogOpen(o);
        if (!o) { setCustomPosition(""); setCustomIndustry(""); }
      }}>
        <DialogContent className="max-w-[95vw] sm:max-w-[600px] lg:max-w-[820px] rounded-3xl p-0 overflow-hidden gap-0 border-none shadow-2xl bg-background">

          {/* ── Header ── */}
          <DialogHeader className="px-6 pt-6 pb-5 border-b border-border/50 bg-gradient-to-br from-brand/5 via-transparent to-transparent">
            <div className="flex items-center gap-3.5">
              <div className="h-10 w-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-brand" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
                  Generate AI Project
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                  Tailored to your resume, role, and industry.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* ── Form ── */}
          <div className="overflow-y-auto max-h-[65vh]">
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-border/40">

              {/* ── Left column: mode + resume ── */}
              <div className="px-6 py-5 space-y-4">

                {/* Generation Mode toggle */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Generation Mode
                  </Label>
                  <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted border border-border/40">
                    <button
                      type="button"
                      onClick={() => dispatch(setFormGenerationMode("new"))}
                      className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all ${
                        formGenerationMode === "new"
                          ? "bg-background shadow-sm border border-border/60 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Wand2 className="h-4 w-4 shrink-0 mt-0.5 text-brand" />
                      <div>
                        <p className="text-xs font-semibold leading-tight">Create New</p>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                          Invent fresh projects based on your skills
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch(setFormGenerationMode("resume_enhanced"))}
                      className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all ${
                        formGenerationMode === "resume_enhanced"
                          ? "bg-background shadow-sm border border-border/60 text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <BookOpen className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                      <div>
                        <p className="text-xs font-semibold leading-tight">Enhance Resume</p>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                          Polish your existing experience in depth
                        </p>
                      </div>
                    </button>
                  </div>
                  {formGenerationMode === "resume_enhanced" && (
                    <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                      Your resume will be deeply analysed. Each project will be an enriched case-study of your real experience — upload a resume below for best results.
                    </p>
                  )}
                </div>

                {/* Resume */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3 w-3" />
                    Resume
                    <span className="text-destructive ml-0.5">*</span>
                    <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">required</span>
                  </Label>
                  <ResumeSelector onSelect={handleResumeSelect} onDeselect={() => dispatch(setFormResumeId(null))} value={formResumeId ?? undefined} />
                </div>
              </div>

              {/* ── Right column: targeting ── */}
              <div className="px-6 py-5 space-y-4 lg:bg-muted/[0.015]">

                {/* Target position */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Briefcase className="h-3 w-3" />
                    Target Position
                    <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">optional</span>
                  </Label>
                  <Select
                    value={formPosition}
                    onValueChange={(v) => {
                      dispatch(setFormPosition(v));
                      if (v !== "Other") setCustomPosition("");
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-border/60 bg-background">
                      <SelectValue placeholder="Select your target role…" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {formPosition === "Other" && (
                    <Input
                      autoFocus
                      placeholder="Enter your position…"
                      value={customPosition}
                      onChange={(e) => setCustomPosition(e.target.value)}
                      className="h-10 rounded-xl border-border/60 bg-background text-sm"
                    />
                  )}
                </div>

                {/* Industry + Experience — 2-col */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      Industry <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">optional</span>
                    </Label>
                    <Select
                      value={formIndustry}
                      onValueChange={(v) => {
                        dispatch(setFormIndustry(v));
                        if (v !== "Other") setCustomIndustry("");
                      }}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-border/60 bg-background">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {formIndustry === "Other" && (
                      <Input
                        autoFocus
                        placeholder="Enter your industry…"
                        value={customIndustry}
                        onChange={(e) => setCustomIndustry(e.target.value)}
                        className="h-10 rounded-xl border-border/60 bg-background text-sm"
                      />
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <GraduationCap className="h-3 w-3" />
                      Experience <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">optional</span>
                    </Label>
                    <Select value={formExperienceLevel} onValueChange={(v) => dispatch(setFormExperienceLevel(v))}>
                      <SelectTrigger className="h-10 rounded-xl border-border/60 bg-background">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPERIENCE_LEVELS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Job description */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <ListChecks className="h-3 w-3" />
                    Job Description
                    <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded-full">optional · boosts accuracy</span>
                  </Label>
                  <Textarea
                    placeholder="Paste the job description for more targeted project ideas…"
                    value={formJobDescription}
                    onChange={(e) => dispatch(setFormJobDescription(e.target.value))}
                    rows={5}
                    className="rounded-xl border-border/60 resize-none text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-border/50 bg-muted/30 flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-brand" />
                <span>4 credits</span>
              </div>
              {balance && parseFloat(balance.totalAvailable) < 5 ? (
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{parseFloat(balance.totalAvailable).toFixed(0)} credits remaining</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Runs in background</span>
              )}
              {!formResumeId && (
                <span className="text-xs text-amber-600">Select a resume to generate projects.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(false)}
                className="h-9 rounded-xl text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!isFormValid}
                size="sm"
                className="h-9 px-5 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold gap-2 disabled:opacity-40 shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

