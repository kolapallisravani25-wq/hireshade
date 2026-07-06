 ;

import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FilePlus, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENDPOINTS } from "@/lib/endpoints";
import {
  postCreditedAi,
  createIdempotencyKey,
  InsufficientCreditsError,
} from "@/lib/creditedAi";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { toast } from "sonner";

// Step sub-components
import { SourceSelectionStep } from "./BuildResume/SourceSelectionStep";
import { ExtractionStep } from "./BuildResume/ExtractionStep";
import { JDStep, type JDStepData } from "./BuildResume/JDStep";
import { TemplateSelectionStep, type Template } from "./BuildResume/TemplateSelectionStep";
import { ProcessingStep, type ProcessingStatus } from "./BuildResume/ProcessingStep";
import { type Resume } from "@/components/Resume/ResumeSelector";

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceType = "resume" | "scratch";

/**
 * Step machine:
 *   Path A (resume):  1 Source → 2 Extract → 3 JD → 4 Template → 5 Processing
 *   Path B (scratch): 1 Source → 2 JD       → 3 Template → 4 Processing
 *
 * We encode steps as semantic names rather than numbers so the progress
 * indicator can always reflect the correct position.
 */
type StepId = "source" | "extract" | "jd" | "template" | "processing";

function getSteps(source: SourceType | null): StepId[] {
  if (source === "resume") return ["source", "extract", "jd", "template", "processing"];
  return ["source", "jd", "template", "processing"];
}

const STEP_TITLES: Record<StepId, string> = {
  source:     "Start Your Resume",
  extract:    "Select Data to Extract",
  jd:         "Target Role",
  template:   "Choose a Template",
  processing: "Building Your Resume",
};

const EXTRACTION_FIELDS = [
  { id: "personalInfo",  label: "Personal Information"  },
  { id: "summary",       label: "Professional Summary"  },
  { id: "experience",    label: "Work Experience"        },
  { id: "education",     label: "Education"              },
  { id: "skills",        label: "Skills"                 },
  { id: "projects",      label: "Projects"               },
  { id: "certifications",label: "Certifications"         },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function BuildResumeDialog() {
  const navigate = useNavigate();
  const { getToken, userId: clerkUserId } = useAuth();
  const { refresh: refreshBalance } = useCreditsBalance();
  const [open, setOpen] = React.useState(false);

  // Step machine
  const [stepId, setStepId] = React.useState<StepId>("source");
  const [sourceType, setSourceType] = React.useState<SourceType | null>(null);

  // Step 2 (extract — path A)
  const [selectedResume, setSelectedResume] = React.useState<Resume | null>(null);
  const [extractionOptions, setExtractionOptions] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(EXTRACTION_FIELDS.map((f) => [f.id, true])),
  );

  // Step JD
  const [jdData, setJdData] = React.useState<JDStepData>({
    jobDescription: "",
    jobTitle: "",
    company: "",
  });

  // Step template
  const [selectedTemplate, setSelectedTemplate] = React.useState<Template | null>(null);

  // Processing state
  const [processingStatus, setProcessingStatus] = React.useState<ProcessingStatus>("loading");
  const [processingError, setProcessingError] = React.useState<string | null>(null);

  // ── Derived step list ──────────────────────────────────────────────────────

  const steps = getSteps(sourceType);
  const stepIndex = steps.indexOf(stepId);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goNext = () => {
    const next = steps[stepIndex + 1];
    if (!next) return;
    if (next === "processing") {
      setStepId("processing");
      startProcessing();
    } else {
      setStepId(next);
    }
  };

  const isNextDisabled = (): boolean => {
    switch (stepId) {
      case "source":   return sourceType === null;
      case "extract":  return selectedResume === null;
      case "jd":       return false; // always skippable
      case "template": return selectedTemplate === null;
      default:         return false;
    }
  };

  const goBack = () => {
    const prev = steps[stepIndex - 1];
    if (prev) setStepId(prev);
  };

  // ── Processing ─────────────────────────────────────────────────────────────

  /** Build a clean, short resume title from available data. Priority:
   *  1. extracted fields.name + fields.role (most accurate)
   *  2. JD jobTitle + company (truncated)
   *  3. Fallback "My Resume"
   */
  function buildResumeTitle(fields?: Record<string, string>): string {
    const cap = (s: string, max = 60) =>
      s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;

    // Priority 1 — AI-extracted name + role (most accurate)
    const extractedName = fields?.name?.trim();
    const extractedRole = fields?.role?.trim();
    if (extractedName && extractedRole)
      return cap(`${extractedName} – ${extractedRole}`);
    if (extractedRole) return cap(extractedRole);
    if (extractedName) return cap(extractedName);

    // Priority 2 — JD job title + company
    // Guard: if jobTitle > 120 chars the user pasted a JD there — skip it
    const rawJobTitle = jdData.jobTitle?.trim();
    const jobTitleClean = rawJobTitle && rawJobTitle.length <= 120
      ? rawJobTitle.split("\n")[0].trim()
      : undefined;
    const companyClean  = jdData.company?.trim()?.split("\n")?.[0]?.trim()
      ?.split(" ").slice(0, 3).join(" ");
    if (jobTitleClean && companyClean)
      return cap(`${jobTitleClean} – ${companyClean}`);
    if (jobTitleClean) return cap(jobTitleClean);

    return "My Resume";
  }

  const navigateToEditor = React.useCallback(async (fields?: Record<string, string>) => {
    const resumeTitle = buildResumeTitle(fields);

    // Save a draft record immediately so the editor can auto-save to the same ID
    // and the mark-complete flow has a resumeId to work with.
    let savedResumeId: string | null = null;
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();
      const defaultSections = [
        { id: "personalInfo",   label: "Personal Info",   required: true,  enabled: true  },
        { id: "summary",        label: "Summary",          required: true,  enabled: true  },
        { id: "experience",     label: "Work Experience",  required: true,  enabled: true  },
        { id: "skills",         label: "Skills",           required: true,  enabled: true  },
        { id: "projects",       label: "Projects",         required: false, enabled: true  },
        { id: "education",      label: "Education",        required: true,  enabled: true  },
        { id: "certifications", label: "Certifications",   required: false, enabled: false },
        { id: "publications",   label: "Publications",     required: false, enabled: false },
      ];
      const emptyFields = {
        name: "", role: "", email: "", phone: "", location: "", links: "",
        summary: "", experience: "", skillsLanguages: "", skillsFrameworks: "",
        skillsDatabases: "", skillsTools: "", projects: "", education: "",
        certifications: "", publications: "",
      };
      // Sanitize: if jobTitle > 120 chars user pasted JD there — use AI-extracted role or skip
      const sanitizedJobTitle = (() => {
        const raw = jdData.jobTitle?.trim() ?? "";
        if (!raw || raw.length > 120) return fields?.role?.trim() || undefined;
        return raw || undefined;
      })();
      const res = await fetch(ENDPOINTS.resumeBuilderSave(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId,
          title:          resumeTitle,
          templateId:     selectedTemplate?.id ?? "classic",
          fields:         fields ?? emptyFields,
          sections:       defaultSections,
          jobDescription: jdData.jobDescription || undefined,
          jobTitle:       sanitizedJobTitle,
          company:        jdData.company        || undefined,
          status:         "draft",
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) savedResumeId = data.id;
    } catch {
      // Non-fatal: editor will create its own record on first save
    }

    setOpen(false);
    navigate("/resume/editor", {
      state: {
        config: {
          // When fields are provided (AI-extracted), use "builder" sourceType so
          // the editor uses them directly without re-parsing resumeContext.
          sourceType:        fields ? "builder" : sourceType,
          resumeId:          savedResumeId,
          resumeContext:     fields ? undefined : selectedResume?.resumeContext,
          fields:            fields ?? undefined,
          extractionOptions,
          jobDescription:    jdData.jobDescription,
          jobTitle:          jdData.jobTitle,
          company:           jdData.company,
          resumeTitle,
          templateId:        selectedTemplate?.id,
          templateCode:      selectedTemplate?.code,
        },
      },
    });
  }, [navigate, getToken, sourceType, selectedResume, extractionOptions, jdData, selectedTemplate]);

  const startProcessing = React.useCallback(async () => {
    setProcessingStatus("loading");
    setProcessingError(null);

    // ── Path B (scratch): fetch user name/email from DB, then call AI tailor ──
    if (sourceType === "scratch") {
      try {
        const userId = localStorage.getItem("userId") ?? clerkUserId;
        const token  = await getToken();

        // 1. Fetch user profile for name + email seed
        let userName  = "";
        let userEmail = "";
        try {
          const meRes = await fetch(ENDPOINTS.authMe(), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (meRes.ok) {
            const me = await meRes.json();
            userName  = me.name  ?? "";
            userEmail = me.email ?? "";
          }
        } catch {
          // Non-fatal — AI will build without name/email seed
        }

        // 2. If a job description was provided, call AI tailor to build the resume
        if (jdData.jobDescription.trim().length >= 50) {
          const idempotencyKey = createIdempotencyKey();
          const { data, creditsUsed, creditsRemaining, cached } =
            await postCreditedAi<{ tailoredFields: Record<string, string> }>(
              ENDPOINTS.resumeBuilderTailor(),
              {
                userId,
                jobDescription: jdData.jobDescription,
                jobTitle:       jdData.jobTitle  || undefined,
                company:        jdData.company   || undefined,
                // Seed with real name/email so AI puts them in the right spots
                fields: { name: userName, email: userEmail },
              },
              { token, idempotencyKey },
            );

          if (!cached && creditsUsed > 0) {
            toast.success(
              `Resume built · ${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used · ${creditsRemaining.toFixed(2)} remaining`,
            );
          }
          if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
          refreshBalance();

          // Navigate with AI-generated fields (force "builder" sourceType so editor doesn't re-parse)
          const generatedFields: Record<string, string> = {
            ...(data.tailoredFields as Record<string, string>),
            // Always keep real name/email from DB, not whatever AI wrote
            name:  userName  || (data.tailoredFields as Record<string, string>).name  || "",
            email: userEmail || (data.tailoredFields as Record<string, string>).email || "",
          };
          await navigateToEditor(generatedFields);
        } else {
          // No JD or too short: open editor blank but pre-seed name/email
          const seedFields = userName || userEmail
            ? { name: userName, email: userEmail }
            : undefined;
          await navigateToEditor(seedFields as never);
        }
      } catch (err) {
        const message = err instanceof InsufficientCreditsError
          ? "Not enough credits to build this resume — top up to continue."
          : err instanceof Error ? err.message : "Something went wrong";
        setProcessingStatus("error");
        setProcessingError(message);
      }
      return;
    }

    // ── Path A (resume): extract factual anchors → full JD-rewrite if role/JD provided ──
    const resumeContext = selectedResume?.resumeContext;
    if (!resumeContext) {
      // Fallback: no resume text available, navigate without AI-extracted fields.
      await navigateToEditor();
      return;
    }

    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();

      // ── Step 1: Parse uploaded resume into structured fields (factual anchors) ──
      const extractKey = createIdempotencyKey();
      const {
        data: extractData,
        creditsUsed: extractCredits,
        creditsRemaining: extractRemaining,
        cached: extractCached,
      } = await postCreditedAi<{ fields: Record<string, string> }>(
        ENDPOINTS.resumeBuilderExtractFields(),
        {
          userId,
          // Backend route reads `body.text` (or falls back to `body.resumeId`);
          // sending the raw resumeContext under a "resumeContext" key matched
          // neither, so resumeText was always "" and the route 400'd with
          // "No resume text available to extract from" for every existing-resume
          // extraction attempt. Key must be `text`.
          text: resumeContext,
          // Pass JD context so the extractor can orient the summary, but this
          // is a weak hint only — the full rewrite happens in step 2 below.
          jobDescription: jdData.jobDescription || undefined,
          jobTitle:       jdData.jobTitle.trim() || undefined,
          company:        jdData.company.trim()  || undefined,
        },
        { token, idempotencyKey: extractKey },
      );

      const extractedFields = extractData.fields as Record<string, string>;
      console.log("[wizard] ✅ extracted role:", extractedFields.role);

      if (!isNaN(extractRemaining)) setOptimisticBalance(extractRemaining);
      refreshBalance();

      // ── Step 2: Full JD-based rewrite when target role or JD is provided ──
      // This is the core HireShade feature: extraction gives us the factual
      // skeleton (companies, dates, degrees) and the tailor engine rewrites
      // every editable field (role, summary, bullets, skills, projects)
      // for the exact target role. Never skip this step when job context exists.
      const hasJobContext =
        jdData.jobTitle.trim().length > 0 ||
        jdData.jobDescription.trim().length >= 50;

      if (hasJobContext) {
        console.log("[wizard] 🔄 running full rewrite for target role:", jdData.jobTitle);
        // Re-fetch the token — extract-fields can take 60-120 seconds and the
        // short-lived Clerk JWT may have expired by the time tailor is called.
        const tailorToken = await getToken();
        const tailorKey = createIdempotencyKey();
        const {
          data: tailorData,
          creditsUsed: tailorCredits,
          creditsRemaining: tailorRemaining,
        } = await postCreditedAi<{ tailoredFields: Record<string, string> }>(
          ENDPOINTS.resumeBuilderTailor(),
          {
            userId,
            // No resumeId — pass extracted fields inline so tailor treats them
            // as the source resume and rewrites editable sections for the JD.
            fields:         extractedFields,
            jobDescription: jdData.jobDescription.trim() || jdData.jobTitle.trim(),
            // Always send as strings — never undefined — so the backend audit log
            // shows actual values and resolvedJobTitle extraction from JD works correctly.
            jobTitle:       jdData.jobTitle.trim(),
            company:        jdData.company.trim(),
          },
          { token: tailorToken, idempotencyKey: tailorKey },
        );

        const totalCredits = extractCredits + tailorCredits;
        if (totalCredits > 0) {
          toast.success(
            `Resume built · ${totalCredits} credit${totalCredits === 1 ? "" : "s"} used · ${tailorRemaining.toFixed(2)} remaining`,
          );
        }
        if (!isNaN(tailorRemaining)) setOptimisticBalance(tailorRemaining);
        refreshBalance();

        const tailoredFields = tailorData.tailoredFields as Record<string, string>;
        console.log("[wizard] ✅ tailor returned role:", tailoredFields.role);

        // Merge: rewritten editable fields from tailor, factual personal info
        // (name, email, phone, location) force-kept from extraction so they
        // are never hallucinated by the AI.
        const finalFields: Record<string, string> = {
          ...extractedFields,
          ...tailoredFields,
          name:     extractedFields.name     || tailoredFields.name     || "",
          email:    extractedFields.email    || tailoredFields.email    || "",
          phone:    extractedFields.phone    || tailoredFields.phone    || "",
          location: extractedFields.location || tailoredFields.location || "",
        };

        await navigateToEditor(finalFields);
        return;
      }

      // No job context — open editor with raw extracted fields (user fills role manually)
      if (!extractCached && extractCredits > 0) {
        toast.success(
          `Resume parsed · ${extractCredits} credit${extractCredits === 1 ? "" : "s"} used · ${extractRemaining.toFixed(2)} remaining`,
        );
      }
      await navigateToEditor(extractedFields);
    } catch (err) {
      const message = err instanceof InsufficientCreditsError
        ? "Not enough credits to process this resume — top up to continue."
        : err instanceof Error ? err.message : "Something went wrong";
      setProcessingStatus("error");
      setProcessingError(message);
    }
  }, [getToken, sourceType, selectedResume, jdData, navigateToEditor, refreshBalance]);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const resetDialog = () => {
    setStepId("source");
    setSourceType(null);
    setSelectedResume(null);
    setExtractionOptions(Object.fromEntries(EXTRACTION_FIELDS.map((f) => [f.id, true])));
    setJdData({ jobDescription: "", jobTitle: "", company: "" });
    setSelectedTemplate(null);
    setProcessingStatus("loading");
    setProcessingError(null);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setTimeout(resetDialog, 300);
  };

  // ── Source selection handler ───────────────────────────────────────────────

  const handleSelectSource = (type: SourceType) => {
    setSourceType(type);
    // Recompute step list with new source so next press goes to right place
  };

  // ── Progress dots ──────────────────────────────────────────────────────────
  // Show dots for all steps except "processing" (which is the terminal state)
  const progressSteps = steps.filter((s) => s !== "processing");
  const progressIndex = Math.min(stepIndex, progressSteps.length - 1);

  // ── Step title ─────────────────────────────────────────────────────────────
  const title = STEP_TITLES[stepId];

  const showFooter = stepId !== "processing";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 transition-all duration-150 font-medium text-sm shadow-sm">
          <FilePlus className="h-4 w-4" />
          Build Resume
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[520px] border border-slate-200/80 shadow-[0_8px_40px_rgba(0,0,0,0.10)] rounded-[18px] p-0 overflow-hidden bg-white gap-0 [&>button]:hidden flex flex-col max-h-[min(90vh,720px)]">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="px-7 pt-6 pb-5 shrink-0">
          <div className="flex items-start justify-between mb-1">
            <div>
              <DialogTitle className="text-[17px] font-semibold tracking-tight text-slate-900 leading-snug">
                {title}
              </DialogTitle>
              <p className="mt-0.5 text-[13px] text-slate-400 font-normal leading-snug">
                {stepId === "source" && "Choose how you want to create your resume"}
                {stepId === "extract" && "Select the data to pull from your file"}
                {stepId === "jd" && "Tell us about the role you're targeting"}
                {stepId === "template" && "Pick a layout for your resume"}
                {stepId === "processing" && "AI is analyzing and generating your resume structure"}
              </p>
            </div>
            <button
              onClick={() => handleOpenChange(false)}
              className="mt-0.5 ml-4 flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors duration-150 shrink-0"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Segmented progress bar */}
          {stepId !== "processing" && (
            <div className="flex items-center gap-1.5 mt-4">
              {progressSteps.map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    "h-[3px] flex-1 rounded-full transition-all duration-300",
                    i <= progressIndex
                      ? "bg-blue-500"
                      : "bg-slate-200",
                  )}
                />
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100 shrink-0" />

        {/* ── Step content ────────────────────────────────────────────── */}
        <div className="px-7 py-5 flex-1 min-h-0 overflow-y-auto">
          {stepId === "source" && (
            <SourceSelectionStep
              sourceType={sourceType}
              onSelect={handleSelectSource}
            />
          )}

          {stepId === "extract" && (
            <ExtractionStep
              onSelectResume={setSelectedResume}
              options={extractionOptions}
              onChangeOption={(id, checked) =>
                setExtractionOptions((prev) => ({ ...prev, [id]: checked }))
              }
              fields={EXTRACTION_FIELDS}
            />
          )}

          {stepId === "jd" && (
            <JDStep data={jdData} onChange={setJdData} />
          )}

          {stepId === "template" && (
            <TemplateSelectionStep
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelect={setSelectedTemplate}
            />
          )}

          {stepId === "processing" && (
            <ProcessingStep
              status={processingStatus}
              error={processingError}
              onRetry={() => startProcessing()}
              onSkip={() => { void navigateToEditor(); }}
              mode={
                sourceType === "scratch" ||
                (sourceType === "resume" &&
                  (jdData.jobTitle.trim().length > 0 || jdData.jobDescription.trim().length >= 50))
                  ? "scratch"
                  : "extract"
              }
            />
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        {showFooter && (
          <>
            <div className="h-px bg-slate-100 shrink-0" />
            <div className="flex items-center justify-between px-7 py-4 shrink-0">
              <button
                onClick={goBack}
                disabled={stepIndex === 0}
                className="flex items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-700 disabled:opacity-0 disabled:pointer-events-none transition-colors duration-150"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>

              <div className="flex items-center gap-2">
                {stepId === "jd" && (
                  <button
                    onClick={goNext}
                    className="text-[13px] font-medium text-slate-400 hover:text-slate-600 transition-colors duration-150 px-3 py-1.5"
                  >
                    Skip
                  </button>
                )}

                <button
                  onClick={goNext}
                  disabled={isNextDisabled()}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 active:scale-[0.98]"
                >
                  {stepId === "template" ? "Generate Resume" : "Continue"}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
