import React, { useCallback, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import {
  setActiveSection, addCustomSection, setAiSuggestion,
  setIsEnhancing, setSectionValidating, setSectionQuality,
  recordAiActivity,
} from "@/store/resumeBuilderSlice";
import type { SectionId } from "@/store/resumeBuilderSlice";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { toast } from "sonner";
import type { SectionQuality } from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { Sparkles, Plus, Loader2 } from "lucide-react";
import { SECTION_LABEL, AI_ENHANCEABLE, sectionAIText, AI_ENHANCE_FALLBACK_COST, getSectionIcon } from "../types";
import { SectionEditorFields } from "./SectionEditorFields";
import { AiDiffPanel, SectionQualityMeter } from "./EditorPanelWidgets";

export function CenterPanel() {
  const dispatch            = useDispatch<AppDispatch>();
  const activeSection       = useSelector((s: RootState) => s.resumeBuilder.activeSection);
  const sections            = useSelector((s: RootState) => s.resumeBuilder.sections);
  const customDefs          = useSelector((s: RootState) => s.resumeBuilder.customSectionDefs);
  const isEnhancing         = useSelector((s: RootState) => s.resumeBuilder.isEnhancing);
  const aiSuggestion        = useSelector((s: RootState) => s.resumeBuilder.aiSuggestion);
  const fields              = useSelector((s: RootState) => s.resumeBuilder.fields);
  const aiEnhancedSections  = useSelector((s: RootState) => s.resumeBuilder.aiEnhancedSections);
  const sectionValidation   = useSelector((s: RootState) => s.resumeBuilder.sectionValidation);
  const jobTitle            = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const company             = useSelector((s: RootState) => s.resumeBuilder.company);
  const jobDescription      = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const { balance, refresh: refreshBalance } = useCreditsBalance();
  const { costFor }         = useFeatureCosts();
  const { getToken, userId: clerkUserId } = useAuth();

  const enhanceCost     = costFor(FEATURE_KEYS.RESUME_ENHANCE_SECTION, AI_ENHANCE_FALLBACK_COST);
  const sectionMeta     = [...sections, ...customDefs].find((s) => s.id === activeSection);
  const Icon            = getSectionIcon(activeSection);
  const canAI           = AI_ENHANCEABLE.includes(activeSection);
  const credits         = balance ? parseFloat(balance.totalAvailable ?? "0") : null;
  const hasEnoughCredit = credits === null || credits >= enhanceCost;

  const isAiEnhanced    = aiEnhancedSections.includes(activeSection);
  const sweepKey        = `${activeSection}-${isAiEnhanced}`;
  const quality         = sectionValidation[activeSection];

  /** Debounced validation — fires 1.5s after user stops typing or switches section. */
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fieldsSnapshot = JSON.stringify(fields);

  useEffect(() => {
    // personalInfo has no long-form prose to validate — skip it
    if (!canAI || activeSection === "personalInfo") return;
    const text = sectionAIText(activeSection, fields);
    if (!text || text.trim().length < 15) return;

    dispatch(setSectionValidating({ sectionId: activeSection, isValidating: true }));
    clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(async () => {
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderValidateSection(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            sectionId: activeSection,
            currentText: text,
            jobTitle: jobTitle || undefined,
            company: company || undefined,
            resumeContext: fields.name ? `${fields.name}, ${fields.role}` : undefined,
          }),
        });
        if (!res.ok) throw new Error("Validation failed");
        const data = await res.json();
        dispatch(setSectionQuality({
          sectionId: activeSection,
          quality: {
            score:       data.score,
            status:      data.status,
            issues:      data.issues ?? [],
            suggestions: data.suggestions ?? [],
            constraints: data.constraints,
            wordCount:   data.wordCount,
          },
        }));
      } catch {
        dispatch(setSectionValidating({ sectionId: activeSection, isValidating: false }));
      }
    }, 1500);

    return () => clearTimeout(validateTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsSnapshot, activeSection]);

  const handleAIEnhance = useCallback(async () => {
    if (isEnhancing) return;
    dispatch(setIsEnhancing(true));
    // One idempotency key per click — replaces are server-deduplicated even
    // if React's state batching lets the user double-click before the
    // `isEnhancing` flag flips.
    const idempotencyKey = createIdempotencyKey();
    try {
      // Prefer the DB UUID from localStorage; fall back to the Clerk ID which
      // the server's resolveUserId middleware will convert automatically.
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const currentText = sectionAIText(activeSection, fields);
      if (!currentText?.trim()) {
        toast.error("Add some content to this section before enhancing");
        dispatch(setIsEnhancing(false));
        return;
      }
      const token = await getToken();
      const { data, creditsUsed, creditsRemaining, cached } =
        await postCreditedAi<{
          enhancedText: string;
          enhancedFields?: Partial<ResumeFields>;
          sectionId: string;
        }>(
          ENDPOINTS.resumeBuilderEnhanceSection(),
          {
            userId,
            sectionId: activeSection,
            currentText,
            resumeContext: fields.name ? `${fields.name}, ${fields.role}` : undefined,
            jobDescription: jobDescription || undefined,
            jobTitle:       jobTitle       || undefined,
            qualityIssues:       quality?.issues?.length       ? quality.issues       : undefined,
            qualitySuggestions:  quality?.suggestions?.length  ? quality.suggestions  : undefined,
          },
          { token, idempotencyKey },
        );
      dispatch(setAiSuggestion({
        sectionId: activeSection,
        suggestion: data.enhancedText,
        suggestionFields: data.enhancedFields,
      }));
      // Instantly update badge via optimistic write; no extra HTTP request needed.
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      // Surface the actual charge to the user. `cached` means a free replay
      // (idempotency or generation cache) — show a softer message.
      if (cached) {
        toast.success("Restored from cache (no credits charged)");
      } else if (creditsUsed > 0) {
        toast.success(
          `${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used · ${creditsRemaining.toFixed(2)} remaining`,
        );
      }
      dispatch(recordAiActivity({
        operation: "resume_enhance_section",
        label: SECTION_LABEL[activeSection] ?? activeSection,
        creditsUsed,
        cached,
        status: "success",
      }));
      refreshBalance();
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        toast.error("Not enough credits — top up to keep enhancing");
      } else {
        toast.error(err instanceof Error ? err.message : "Enhancement failed");
      }
      dispatch(recordAiActivity({
        operation: "resume_enhance_section",
        label: SECTION_LABEL[activeSection] ?? activeSection,
        creditsUsed: 0,
        cached: false,
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
      console.error("[AI Enhance]", err);
    } finally {
      dispatch(setIsEnhancing(false));
    }
  }, [dispatch, getToken, clerkUserId, activeSection, fields, isEnhancing, jobDescription, jobTitle, quality, refreshBalance]);

  return (
    <main className="flex-1 overflow-y-auto bg-slate-50/60">
      <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
        {/* Section header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Icon — glows violet when this section has AI-generated content */}
            <div className={cn(
              "h-10 w-10 rounded-2xl border flex items-center justify-center shrink-0 transition-all duration-500",
              isAiEnhanced
                ? "bg-gradient-to-br from-violet-100 to-indigo-100 border-violet-200/60 ai-icon-glow"
                : "bg-[var(--color-brand)]/10 border-[var(--color-brand)]/20"
            )}>
              <Icon className={cn(
                "h-4.5 w-4.5 transition-colors duration-500",
                isAiEnhanced ? "text-violet-500" : "text-slate-500"
              )} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{sectionMeta?.label}</h2>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                {canAI ? "AI-enhanced rewriting available" : "Edit your details below"}
                {isAiEnhanced && (
                  <span className="ai-enhanced-badge">✦ AI Enhanced</span>
                )}
              </p>
            </div>
          </div>

          {canAI && (
            <button
              onClick={handleAIEnhance}
              disabled={isEnhancing || !!aiSuggestion || !hasEnoughCredit}
              title={!hasEnoughCredit ? `Need ${enhanceCost} credit${enhanceCost === 1 ? "" : "s"}` : `Uses ${enhanceCost} credit${enhanceCost === 1 ? "" : "s"}`}
              className={cn(
                "flex items-center gap-2 px-3.5 h-8 rounded-lg text-[13px] font-medium transition-all shrink-0",
                "bg-slate-900 hover:bg-slate-700 text-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isEnhancing
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Sparkles className="h-3.5 w-3.5" />}
              {isEnhancing ? "Enhancing…" : "AI Enhance"}
              {!isEnhancing && (
                <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full">
                  {enhanceCost}cr
                </span>
              )}
            </button>
          )}
        </div>

        {/* Section-specific fields */}
        {isAiEnhanced ? (
          <div className="ai-gradient-border rounded-2xl p-[1.5px] shadow-sm">
            <div className="relative bg-background rounded-[14px] p-6 overflow-hidden">
              <div key={sweepKey} className="ai-sweep-container">
                <div className="ai-sweep-ray" />
              </div>
              <div className="relative z-10">
                <SectionEditorFields />
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <SectionEditorFields />
          </div>
        )}

        {/* Quality meter — only for AI-enhanceable sections */}
        {canAI && <SectionQualityMeter quality={quality} />}

        {/* AI diff review panel */}
        <AiDiffPanel />
      </div>
    </main>
  );
}

// ─── CenterPanel — ATS Score ─────────────────────────────────────────────────
