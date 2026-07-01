import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { updateField, applyRewrittenFields, recordAiActivity, setIsInjectingKeywords } from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { toast } from "sonner";
import { Sparkles, Loader2, Check, Plus, X, Tag, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, SwitchCamera, Table as TableIcon, Zap } from "lucide-react";
import { AIToolStepHeader } from "./AIToolStepHeader";
import { TextPreviewDialog } from "./TextPreviewDialog";
import { Switch } from "@/components/ui/switch";

interface KeywordInjectionSuggestion {
  keyword: string;
  targetSection: string;
  suggestedContext: string;
  inject: boolean;
}

type Step = "input" | "select" | "done";

export function InjectKeywordsPanel({ onDone }: { onDone?: () => void } = {}) {
  const dispatch       = useDispatch<AppDispatch>();
  const fields         = useSelector((s: RootState) => s.resumeBuilder.fields);
  const savedResumeId  = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const isInjecting    = useSelector((s: RootState) => s.resumeBuilder.isInjectingKeywords);
  const jobDescription = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const { getToken, userId: clerkUserId } = useAuth();
  const { refresh: refreshBalance } = useCreditsBalance();
  const { costFor } = useFeatureCosts();
  const injectCost = costFor(FEATURE_KEYS.RESUME_INJECT_KEYWORDS, 2);
  
  const [step, setStep] = useState<Step>("input");
  const [jd, setJd] = useState(jobDescription);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<KeywordInjectionSuggestion[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [injected, setInjected] = useState<string[]>([]);

  React.useEffect(() => { setJd(jobDescription); }, [jobDescription]);

  // ─── Step 1: Analyze JD ───────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (isAnalyzing || jd.trim().length < 50) return;
    setError(null);
    setIsAnalyzing(true);
    const idempotencyKey = createIdempotencyKey();
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();
      
      const { data, creditsUsed, creditsRemaining, cached } = await postCreditedAi<{ suggestions: KeywordInjectionSuggestion[] }>(
        ENDPOINTS.resumeBuilderAnalyzeKeywords(), 
        { userId, jobDescription: jd, fields }, 
        { token, idempotencyKey }
      );
      
      setSuggestions(data.suggestions);
      // Default select all suggestions that have inject: true
      setSelectedKeywords(new Set(data.suggestions.filter(s => s.inject).map(s => s.keyword)));
      
      dispatch(recordAiActivity({ 
        operation: "resume_analyze_keywords", 
        label: "Keyword Analysis", 
        creditsUsed, 
        cached, 
        status: "success" 
      }));
      
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      toast.success(cached ? "From cache · no credits used" : `${creditsUsed} credit${creditsUsed === 1 ? "" : "s"} used`);
      refreshBalance();
      setStep("select");
    } catch (err) {
      setError(err instanceof InsufficientCreditsError ? `Need ${injectCost} credits. Top up to continue.` : err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Step 2: Inject Selected ───────────────────────────────────────────────
  const handleInject = async () => {
    if (isInjecting || selectedKeywords.size === 0) return;
    setError(null);
    dispatch(setIsInjectingKeywords(true));
    const idempotencyKey = createIdempotencyKey();
    try {
      const userId = localStorage.getItem("userId") ?? clerkUserId;
      const token = await getToken();
      
      const { data, creditsUsed, creditsRemaining, cached } = await postCreditedAi<{ injectedFields: Partial<ResumeFields>; injectedKeywords: string[] }>(
        ENDPOINTS.resumeBuilderInjectKeywords(), 
        { 
          userId, 
          resumeId: savedResumeId ?? undefined, 
          jobDescription: jd, 
          fields,
          selectedKeywords: Array.from(selectedKeywords)
        }, 
        { token, idempotencyKey }
      );
      
      dispatch(applyRewrittenFields({ fields: data.injectedFields ?? {} }));
      setInjected(data.injectedKeywords ?? []);
      
      dispatch(recordAiActivity({ 
        operation: "resume_inject_keywords", 
        label: "Bulk Keywords", 
        creditsUsed, 
        cached, 
        status: "success" 
      }));
      
      if (!isNaN(creditsRemaining)) setOptimisticBalance(creditsRemaining);
      // Injection step is free (analysis was already paid)
      toast.success("Keywords woven successfully");
      refreshBalance();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Keyword injection failed.");
    } finally {
      dispatch(setIsInjectingKeywords(false));
    }
  };

  const toggleKeyword = (kw: string) => {
    const next = new Set(selectedKeywords);
    if (next.has(kw)) next.delete(kw);
    else next.add(kw);
    setSelectedKeywords(next);
  };

  if (step === "done") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-10 py-12">
        <div className="h-16 w-16 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-6 animate-in zoom-in duration-300">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Injection Complete!</h2>
        <p className="text-slate-500 mt-2 leading-relaxed text-[14px]">
          We've successfully woven <span className="font-semibold text-slate-900">{injected.length} keywords</span> into your summary, experience, and project sections.
        </p>
        
        <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-sm">
          {injected.map((kw, i) => (
            <span key={i} className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium animate-in fade-in slide-in-from-bottom-1 duration-300" style={{ animationDelay: `${i * 30}ms` }}>
              {kw}
            </span>
          ))}
        </div>
        
        <Button 
          onClick={() => onDone?.()} 
          className="mt-10 bg-slate-900 hover:bg-slate-800 text-white px-8 h-10 rounded-xl"
        >
          Return to Editor
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      {/* ── Header ── */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
              <Tag className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">Inject Missing Keywords</h2>
              <p className="text-[12px] text-slate-500">Find and weave JD keywords into your resume</p>
            </div>
          </div>
          {step === "input" && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-100">
              <Sparkles className="h-3 w-3 text-amber-600" />
              <span className="text-[11px] font-bold text-amber-700 leading-none">{injectCost} credits</span>
            </div>
          )}
        </div>
        
        {/* Progress steps */}
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center gap-2 py-1 transition-opacity", step !== "input" && "opacity-40")}>
            <div className="h-5 w-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">1</div>
            <span className="text-[12px] font-semibold text-slate-900">Analysis</span>
          </div>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <div className={cn("flex items-center gap-2 py-1 transition-opacity", step !== "select" && "opacity-40")}>
            <div className={cn("h-5 w-5 rounded-full text-[10px] font-bold flex items-center justify-center", step === "select" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400")}>2</div>
            <span className={cn("text-[12px] font-semibold", step === "select" ? "text-slate-900" : "text-slate-400")}>Injection</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {step === "input" ? (
          <div className="p-6 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-bold text-slate-700 uppercase tracking-wider">Job Description</label>
                <span className="text-[11px] text-slate-400">{jd.length} chars</span>
              </div>
              <div className="relative group">
                <Textarea 
                  value={jd} 
                  onChange={(e) => setJd(e.target.value)} 
                  placeholder="Paste the target job description here. We'll analyze it to find keywords that are missing from your current resume..."
                  className="min-h-[240px] resize-none text-[14px] leading-relaxed p-4 rounded-2xl border-slate-200 focus-visible:ring-amber-500/20 focus-visible:border-amber-400 transition-all placeholder:text-slate-300" 
                />
                <div className="absolute top-4 right-4 opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none">
                  <div className="px-2 py-1 rounded bg-amber-50 text-[10px] font-bold text-amber-600 border border-amber-100">Ready to analyze</div>
                </div>
              </div>
              {jd.length > 0 && jd.length < 50 && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3 w-3" /> Please paste at least 50 characters to continue
                </p>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
                <TableIcon className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-slate-900 leading-tight">What happens next?</p>
                <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
                  The AI will find missing keywords and show you exactly where it suggests injecting them. You'll be able to toggle each keyword individually before applying.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[12px] font-medium text-slate-600 italic">
                Found {suggestions.length} high-value keywords missing from your resume.
              </p>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setStep("input")}
                className="h-8 text-[12px] font-semibold text-slate-500 hover:text-slate-900"
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Back to JD
              </Button>
            </div>
            
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 border-b border-slate-100">
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Keyword</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Target Section</th>
                    <th className="px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Suggested Context</th>
                    <th className="px-6 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Inject</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suggestions.map((item, i) => (
                    <tr key={i} className={cn("group hover:bg-slate-50/50 transition-colors", !selectedKeywords.has(item.keyword) && "bg-slate-50/20")}>
                      <td className="px-6 py-4">
                        <span className="text-[13px] font-bold text-slate-900 tracking-tight">{item.keyword}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[12px] text-slate-500 font-medium whitespace-nowrap">{item.targetSection}</span>
                      </td>
                      <td className="px-4 py-4 min-w-[200px]">
                        <p className="text-[12px] text-slate-400 italic leading-relaxed">{item.suggestedContext}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Switch 
                          checked={selectedKeywords.has(item.keyword)}
                          onCheckedChange={() => toggleKeyword(item.keyword)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Fixed Footer ── */}
      <div className="shrink-0 p-6 border-t border-slate-100 bg-white">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-[12px] flex items-center gap-2 animate-in slide-in-from-bottom-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}
        
        {step === "input" ? (
          <Button 
            onClick={handleAnalyze} 
            disabled={isAnalyzing || jd.trim().length < 50}
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[14px] font-bold shadow-lg shadow-slate-900/10 transition-all active:scale-[0.98]"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing JD Content...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Analyze Job Description
              </>
            )}
          </Button>
        ) : (
          <Button 
            onClick={handleInject} 
            disabled={isInjecting || selectedKeywords.size === 0}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[14px] font-bold shadow-lg shadow-emerald-600/10 transition-all active:scale-[0.98]"
          >
            {isInjecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Weaving Keywords into Sections...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Inject {selectedKeywords.size} Selected Keywords
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── KeywordMatchPanel ─────────────────────────────────────────────────────────────────────────────

