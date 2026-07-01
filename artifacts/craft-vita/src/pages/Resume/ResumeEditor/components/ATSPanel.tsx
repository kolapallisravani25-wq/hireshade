import React, { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { setActiveSection, setJobContext } from "@/store/resumeBuilderSlice";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@clerk/clerk-react";
import { ENDPOINTS } from "@/lib/endpoints";
import { postCreditedAi, createIdempotencyKey, InsufficientCreditsError } from "@/lib/creditedAi";
import { useFeatureCosts, FEATURE_KEYS } from "@/hooks/useFeatureCosts";
import { useCreditsBalance, setOptimisticBalance } from "@/hooks/useCreditsBalance";
import { toast } from "sonner";
import {
  Target, Sparkles, FileText, Loader2, CheckCircle2,
  AlertTriangle, XCircle, ChevronRight, TrendingUp,
  FileSearch, AlertCircle, Maximize2, Zap, LayoutPanelLeft,
} from "lucide-react";
import { SECTION_LABEL } from "../types";
import { Switch } from "@/components/ui/switch";

export function ATSPanel() {
  const savedResumeId  = useSelector((s: RootState) => s.resumeBuilder.savedResumeId);
  const isDirty        = useSelector((s: RootState) => s.resumeBuilder.isDirty);
  const jobDescription = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const { getToken }   = useAuth();

  type AtsResult = {
    score: number;
    grade: string;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    missingKeywords: string[];
    suggestions: string[];
    sectionScores: Record<string, number>;
  };

  // ── localStorage helpers (keyed per resume) ──────────────────────────────
  const lsKey = savedResumeId ? `ats_cache_${savedResumeId}` : null;

  const readCache = React.useCallback((): { result: AtsResult; checkedAt: string } | null => {
    if (!lsKey) return null;
    try {
      const raw = localStorage.getItem(lsKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [lsKey]);

  const writeCache = React.useCallback((result: AtsResult, checkedAt: string) => {
    if (!lsKey) return;
    try { localStorage.setItem(lsKey, JSON.stringify({ result, checkedAt })); } catch { /* quota */ }
  }, [lsKey]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [result, setResult]           = React.useState<AtsResult | null>(null);
  const [isScoring, setIsScoring]     = React.useState(false);
  const [scoreError, setScoreError]   = React.useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<string | null>(null);
  const [isLoadingExisting, setIsLoadingExisting] = React.useState(false);
  
  // New JD-specific states
  const [isJdEnabled, setIsJdEnabled] = React.useState(!!jobDescription);
  const [jdText, setJdText]           = React.useState(jobDescription);

  // Sync JD text if it changes in global state
  React.useEffect(() => { 
    if (jobDescription && !jdText) {
      setJdText(jobDescription);
      setIsJdEnabled(true);
    }
  }, [jobDescription]);

  // ── Load existing result: localStorage first (instant), then DB ───────────
  React.useEffect(() => {
    if (!savedResumeId) return;
    let cancelled = false;

    const cached = readCache();
    if (cached) {
      setResult(cached.result);
      setLastCheckedAt(cached.checkedAt);
      return;
    }

    setIsLoadingExisting(true);
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.resumeBuilderGet(savedResumeId), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const resume = json.data ?? json;
        if (resume.lastAtsResult && !cancelled) {
          const at = resume.lastAtsAt ?? resume.updatedAt ?? new Date().toISOString();
          setResult(resume.lastAtsResult as AtsResult);
          setLastCheckedAt(at);
          writeCache(resume.lastAtsResult as AtsResult, at);
        }
      } catch { /* silently ignore */ }
      finally { if (!cancelled) setIsLoadingExisting(false); }
    })();
    return () => { cancelled = true; };
  }, [savedResumeId, getToken, readCache, writeCache]);

  // ── Run scan ──────────────────────────────────────────────────────────────
  const handleRunScan = React.useCallback(async () => {
    if (!savedResumeId || isScoring) return;
    setIsScoring(true);
    setScoreError(null);
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.resumeBuilderAtsScore(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          resumeId: savedResumeId,
          jobDescription: isJdEnabled ? jdText : undefined
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "ATS scan failed");
      const data = json.data as AtsResult;
      const at = new Date().toISOString();
      setResult(data);
      setLastCheckedAt(at);
      writeCache(data, at);
      toast.success(`ATS score: ${data.score}/100`);
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "ATS scan failed");
      toast.error("ATS scan failed");
    } finally {
      setIsScoring(false);
    }
  }, [savedResumeId, isScoring, getToken, writeCache, isJdEnabled, jdText]);

  const score = result?.score ?? 0;
  const ringColor =
    score >= 85 ? "#10b981" :
    score >= 70 ? "#3b82f6" :
    score >= 55 ? "#f59e0b" :
    "#ef4444";

  const sectionEntries = result?.sectionScores
    ? Object.entries(result.sectionScores).filter(([, v]) => typeof v === "number")
    : [];

  const formatRelative = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "moments ago";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
    return new Date(iso).toLocaleString();
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">

      {/* ── Header Area ── */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
              <FileSearch className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900">ATS Compatibility Score</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">Evaluate how well your resume parses through screening</p>
            </div>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100">FREE</span>
        </div>

        {/* JD Toggle Card */}
        <div className="space-y-3">
          <div className="bg-slate-50/80 border border-slate-100 rounded-2xl p-4 transition-all">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-bold text-slate-900">Score against a Job Description</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Optional — refines keyword scoring</p>
              </div>
              <Switch checked={isJdEnabled} onCheckedChange={setIsJdEnabled} />
            </div>
            
            {isJdEnabled && (
              <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <Textarea 
                  value={jdText} 
                  onChange={(e) => setJdText(e.target.value)} 
                  placeholder="Paste the target job description here..."
                  className="min-h-[100px] max-h-[200px] resize-none text-[13px] leading-relaxed p-3 rounded-xl border-slate-200 bg-white focus-visible:ring-violet-500/20 focus-visible:border-violet-400 placeholder:text-slate-300 shadow-sm"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
             {lastCheckedAt ? (
               <div className="flex items-center gap-2">
                 <div className="h-2 w-2 rounded-full bg-emerald-500" />
                 <span className="text-[11px] text-slate-400 font-medium">
                   Last check: {formatRelative(lastCheckedAt)}
                   {isDirty && <span className="ml-1 text-amber-600">· stale</span>}
                 </span>
               </div>
             ) : (
               <div className="flex items-center gap-2 text-slate-400">
                 <LayoutPanelLeft className="h-3.5 w-3.5" />
                 <span className="text-[11px] font-medium">No scan run yet</span>
               </div>
             )}
             
             <Button 
               onClick={handleRunScan}
               disabled={!savedResumeId || isScoring || isLoadingExisting}
               className="h-9 px-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[13px] font-bold shadow-lg shadow-emerald-600/10 active:scale-[0.98] transition-all"
             >
               {isScoring ? (
                 <>
                   <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                   Scoring...
                 </>
               ) : (
                 <>
                   <Zap className="mr-2 h-3.5 w-3.5" />
                   Check Score
                 </>
               )}
             </Button>
          </div>
        </div>
      </div>

      {/* ── Results Area ── */}
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/30">
        
        {/* Quick Score Circle if result exists */}
        {result && !isScoring && (
          <div className="px-6 py-6 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-6">
              <div className="relative shrink-0">
                <svg width="84" height="84" viewBox="0 0 88 88">
                  <circle cx="44" cy="44" r="38" fill="none" stroke="hsl(var(--slate-100))" strokeWidth="8" />
                  <circle
                    cx="44" cy="44" r="38" fill="none"
                    stroke={ringColor}
                    strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 38}`}
                    strokeDashoffset={`${2 * Math.PI * 38 * (1 - score / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 44 44)"
                    style={{ transition: "stroke-dashoffset 1s ease-out" }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-black text-slate-900 leading-none tabular-nums tracking-tight">{score}</span>
                  <span className="text-[10px] text-slate-400 font-bold uppercase mt-0.5 tracking-wider">{result.grade}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-slate-600 leading-relaxed italic">
                  "{result.summary}"
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 space-y-4">
          {/* Loading skeleton */}
          {(isScoring || isLoadingExisting) && (
            <div className="space-y-4 animate-pulse">
              <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                <div className="h-3 bg-slate-100 rounded-full w-2/5" />
                <div className="h-2 bg-slate-50 rounded-full w-full" />
                <div className="h-2 bg-slate-50 rounded-full w-3/4" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[0, 1].map((i) => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
                    <div className="h-2.5 bg-slate-100 rounded-full w-1/2" />
                    <div className="h-2 bg-slate-50 rounded-full w-full" />
                    <div className="h-2 bg-slate-50 rounded-full w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actual Results Content */}
          {result && !isScoring && !isLoadingExisting && (
            <>
              {/* Section Scores */}
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-slate-50 bg-slate-50/30">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Section Breakdown</span>
                </div>
                <div className="divide-y divide-slate-50 p-1">
                  {sectionEntries.map(([key, val]) => {
                    const pct = Math.max(0, Math.min(100, val));
                    const barColor = pct >= 85 ? "bg-emerald-500" : pct >= 70 ? "bg-blue-500" : pct >= 55 ? "bg-amber-500" : "bg-rose-500";
                    return (
                      <div key={key} className="px-4 py-3 flex items-center gap-4 group hover:bg-slate-50/50 transition-colors rounded-xl">
                        <span className="text-[12.5px] font-bold text-slate-700 w-32 shrink-0">{SECTION_LABEL[key] ?? key}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all duration-700", barColor)} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[12px] font-black tabular-nums text-slate-900 w-8 text-right">{pct}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Strengths & Weaknesses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-700">Top Strengths</span>
                  </div>
                  <ul className="space-y-2.5">
                    {result.strengths.slice(0, 5).map((s, i) => (
                      <li key={i} className="text-[12px] text-slate-600 leading-relaxed flex items-start gap-2.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700">Areas for Improvement</span>
                  </div>
                  <ul className="space-y-2.5">
                    {result.weaknesses.slice(0, 5).map((w, i) => (
                      <li key={i} className="text-[12px] text-slate-600 leading-relaxed flex items-start gap-2.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Missing Keywords */}
              {result.missingKeywords.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-7 w-7 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                      <TrendingUp className="h-4 w-4 text-slate-400" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Missing Keywords</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {result.missingKeywords.slice(0, 18).map((kw, i) => (
                      <span key={i} className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100 text-slate-600 hover:bg-white hover:border-slate-200 transition-colors">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {result.suggestions.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                   <div className="flex items-center gap-2 mb-4">
                    <div className="h-7 w-7 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4 text-violet-600" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-violet-700">Critical Win Suggestions</span>
                  </div>
                  <div className="space-y-3">
                    {result.suggestions.slice(0, 6).map((s, i) => (
                      <div key={i} className="group p-3 rounded-xl bg-slate-50/50 border border-slate-100 hover:bg-white hover:border-slate-200 transition-all flex items-start gap-3">
                        <span className="h-5 w-5 rounded-lg bg-white border border-slate-100 text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5 text-slate-400 group-hover:text-violet-600 transition-colors shadow-sm">{i + 1}</span>
                        <p className="text-[12.5px] text-slate-700 leading-relaxed font-medium">{s}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Empty state placeholder */}
          {!result && !isScoring && !isLoadingExisting && (
            <div className="flex flex-col items-center justify-center min-h-[300px] text-center p-10 bg-white rounded-[32px] border border-dashed border-slate-200">
              <div className="h-14 w-14 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-6">
                <FileSearch className="h-7 w-7 text-slate-300" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Ready to Scan</h3>
              <p className="text-[13px] text-slate-400 mt-2 leading-relaxed max-w-[240px]">
                Toggle the switch above if you want to score against a specific job description.
              </p>
            </div>
          )}
          
          {!savedResumeId && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-bold text-amber-900 leading-tight">Save Required</p>
                <p className="text-[11px] text-amber-700/80 mt-1 leading-relaxed">
                  Please save your resume before running an ATS scan. This allows the AI to analyze your latest draft.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TextPreviewDialog({ title, text, label }: { title: string; text: string; label: string }) {
  if (!text || text === "—") return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          title={`Preview full ${label.toLowerCase()}`}
          className="h-5 w-5 rounded flex items-center justify-center bg-white/50 border border-slate-200/60 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 overflow-hidden shadow-2xl">
        <DialogHeader className="px-5 py-4 border-b border-border bg-slate-50/50 shrink-0">
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mt-1">{label}</p>
        </DialogHeader>
        <div className="p-5 overflow-y-auto">
          <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
