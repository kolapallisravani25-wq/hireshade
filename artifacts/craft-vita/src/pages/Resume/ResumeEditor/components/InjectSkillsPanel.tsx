import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import {
  updateField, applyRewrittenFields, recordAiActivity,
} from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, X, Plus, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { SkillSuggestion } from "../types";
import { TextPreviewDialog as SkillPreviewDialog } from "./TextPreviewDialog";

export function InjectSkillsPanel({ onDone }: { onDone?: () => void } = {}) {
  const dispatch      = useDispatch<AppDispatch>();
  const fields        = useSelector((s: RootState) => s.resumeBuilder.fields);
  const savedResumeId = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const jobTitle      = useSelector((s: RootState) => s.resumeBuilder.jobTitle);
  const jobDescription= useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const { getToken, userId: clerkUserId } = useAuth();
  const { refresh: refreshBalance } = useCreditsBalance();
  const { costFor } = useFeatureCosts();
  const injectCost = costFor(FEATURE_KEYS.RESUME_INJECT_SKILLS, 1);
  
  const [jd, setJd] = React.useState(jobDescription);
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"input" | "loading" | "review">("input");
  const [suggestions, setSuggestions] = React.useState<SkillSuggestion[]>([]);
  const [selectedSkills, setSelectedSkills] = React.useState<Set<string>>(new Set());

  const handleInject = React.useCallback(async () => {
    setError(null);
    setSuggestions([]);
    setSelectedSkills(new Set());
    setStep("loading");
    
    const idempotencyKey = createIdempotencyKey();
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();
      const { data, creditsUsed, creditsRemaining, cached } = await postCreditedAi<{ suggestions: SkillSuggestion[] }>(
        ENDPOINTS.resumeBuilderInjectSkills(), { userId, resumeId: savedResumeId ?? undefined, jobDescription: jd || undefined, jobTitle: jobTitle || undefined, fields }, { token, idempotencyKey });
      
      const sugs = data.suggestions ?? [];
      setSuggestions(sugs);
      // Auto-select all by default
      setSelectedSkills(new Set(sugs.map(s => s.skill)));
      
      dispatch(recordAiActivity({ operation: "resume_inject_skills", label: "Inject Skills", creditsUsed, cached, status: "success" }));
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      toast.success(cached ? "From cache · no credits used" : `${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used`);
      refreshBalance();
      setStep("review");
    } catch (err) {
      setError(err instanceof InsufficientCreditsError ? `Need ${injectCost} credits. Top up to continue.` : err instanceof Error ? err.message : "Skill injection failed.");
      dispatch(recordAiActivity({ operation: "resume_inject_skills", label: "Inject Skills", creditsUsed: 0, cached: false, status: "error", errorMessage: err instanceof Error ? err.message : String(err) }));
      setStep("input");
    }
  }, [jd, jobTitle, savedResumeId, fields, getToken, clerkUserId, dispatch, refreshBalance, injectCost]);

  const handleApplySelected = () => {
    const selectedSuggestions = suggestions.filter(s => selectedSkills.has(s.skill));
    if (selectedSuggestions.length === 0) return;

    const updates: Partial<ResumeFields> = {};
    for (const cat of ["skillsLanguages", "skillsFrameworks", "skillsDatabases", "skillsTools"]) {
      const skillsForCat = selectedSuggestions.filter(s => s.categoryKey === cat).map(s => s.skill);
      if (skillsForCat.length > 0) {
        const existing = fields[cat as keyof ResumeFields] as string || "";
        const existingArr = existing.split(",").map(s => s.trim()).filter(Boolean);
        const newArr = Array.from(new Set([...existingArr, ...skillsForCat]));
        updates[cat as keyof ResumeFields] = newArr.join(", ");
      }
    }

    dispatch(applyRewrittenFields({ fields: updates }));
    toast.success(`${selectedSuggestions.length} skills added successfully!`);
    onDone?.();
  };

  const toggleSkill = (skill: string) => {
    const newSet = new Set(selectedSkills);
    if (newSet.has(skill)) newSet.delete(skill);
    else newSet.add(skill);
    setSelectedSkills(newSet);
  };

  const existingSkills = [fields.skillsLanguages, fields.skillsFrameworks, fields.skillsDatabases, fields.skillsTools]
    .flatMap((s) => s?.split(",").map((x) => x.trim()).filter(Boolean) ?? []);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      {step === "input" && (
        <>
          <div className="shrink-0 px-6 pt-6 pb-5 space-y-5 border-b border-border bg-slate-50/50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
                  <Zap className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900">Inject Role-Aware Skills</h2>
                  <p className="text-[13px] text-slate-500 mt-0.5">We'll suggest high-signal skills aligned to your target role and JD.</p>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200 shrink-0">{injectCost} cr</span>
            </div>
            
            <div className="rounded-xl border border-border overflow-hidden bg-white shadow-sm">
              <div className="px-4 py-3 border-b border-border/60 bg-slate-50/50 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Job Description</span>
                <span className="text-[11px] text-slate-400">Optional</span>
              </div>
              <Textarea value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste job description for highly targeted suggestions, or leave empty for general role skills…"
                className="border-none rounded-none min-h-[120px] max-h-[200px] overflow-y-auto resize-none text-[13px] bg-white focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-3.5 placeholder:text-slate-400 leading-relaxed" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Current skills</p>
                {existingSkills.length > 0 && <span className="text-[11px] text-slate-500 font-medium">{existingSkills.length} listed</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[70px] overflow-y-auto p-1 -m-1">
                {existingSkills.length > 0
                  ? existingSkills.map((sk, i) => <span key={i} className="text-[11px] px-2 py-1 rounded-md bg-white text-slate-600 border border-slate-200 shadow-sm">{sk}</span>)
                  : <span className="text-[13px] text-slate-400 italic">No skills listed yet in your resume</span>}
              </div>
            </div>
          </div>
          
          <div className="flex-1 bg-white p-6 flex flex-col justify-end">
            <div className="flex flex-col gap-3">
              {error && <p className="text-[13px] text-red-600 font-medium flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-100"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
              <Button onClick={handleInject} size="lg" className="w-full text-[14px] font-semibold h-11 bg-slate-900 hover:bg-slate-800 text-white shadow-md">
                <Zap className="h-4 w-4 mr-2" />
                Find Missing Skills
              </Button>
            </div>
          </div>
        </>
      )}

      {step === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50/50">
          <div className="relative">
            <div className="h-16 w-16 rounded-2xl bg-violet-100 border-2 border-violet-200 flex items-center justify-center shadow-inner relative z-10">
              <Zap className="h-8 w-8 text-violet-600 animate-pulse" />
            </div>
            <div className="absolute inset-0 bg-violet-400 blur-xl opacity-20 animate-pulse rounded-full" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 mt-6">Analyzing JD & Role</h3>
          <p className="text-[13px] text-slate-500 mt-2 text-center max-w-[280px]">Cross-referencing your resume with industry requirements to find high-signal missing skills...</p>
        </div>
      )}

      {step === "review" && (
        <div className="flex flex-col flex-1 min-h-0 bg-white">
          <div className="shrink-0 px-6 py-5 border-b border-border bg-white flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">Inject Role-Aware Skills</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Select the skills you want to add to your resume.</p>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {suggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <CheckCircle2 className="h-12 w-12 text-emerald-400 mb-3" />
                <p className="text-[15px] font-semibold text-slate-900">Your skills are well-aligned!</p>
                <p className="text-[13px] text-slate-500 mt-1 max-w-[300px]">We couldn't find any major high-signal skills missing based on your role and JD.</p>
                <Button onClick={() => onDone?.()} variant="outline" className="mt-6">Close</Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-border">
                      <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-widest text-slate-500 w-[25%]">Skill</th>
                      <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-widest text-slate-500 w-[20%]">Category</th>
                      <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-widest text-slate-500 w-[40%]">Why Suggested</th>
                      <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-widest text-slate-500 w-[15%] text-right">Add</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s, i) => {
                      const isSelected = selectedSkills.has(s.skill);
                      return (
                        <tr key={i} className="border-b border-border last:border-0 hover:bg-slate-50/50 transition-colors">
                          <td className="py-3.5 px-4">
                            <span className="text-[13px] font-semibold text-slate-900">{s.skill}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="text-[12px] text-slate-500">{s.categoryLabel}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <p className="text-[12px] text-slate-600 leading-relaxed">{s.reason}</p>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <Button 
                              onClick={() => toggleSkill(s.skill)} 
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              className={cn("h-7 px-3 text-[12px] font-semibold transition-all shadow-none", isSelected ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600" : "text-slate-600 hover:text-emerald-700 hover:border-emerald-600")}
                            >
                              {isSelected ? "Added" : "Add"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
          {suggestions.length > 0 && (
            <div className="shrink-0 p-5 bg-slate-50 border-t border-border flex items-center justify-between rounded-b-2xl">
              <p className="text-[13px] font-medium text-slate-600">
                <span className="text-slate-900 font-bold">{selectedSkills.size}</span> of {suggestions.length} selected
              </p>
              <div className="flex gap-3">
                <Button onClick={() => setStep("input")} variant="ghost" className="text-slate-500 hover:text-slate-900">Back</Button>
                <Button onClick={handleApplySelected} disabled={selectedSkills.size === 0} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md px-6">
                  Add Selected ({selectedSkills.size})
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── InjectKeywordsPanel ─────────────────────────────────────────────────────────────────────────────

