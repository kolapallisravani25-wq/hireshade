import React, { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Search, Info, Map as MapIcon, List, Check, X, Loader2, AlertCircle, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RootState } from "@/store/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ENDPOINTS } from "@/lib/endpoints";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";

interface KeywordMatchResult {
  present: string[];
  missing: string[];
  matchScore: number;
  visualMap: Record<string, string[]>;
}

type ViewMode = "list" | "map";

interface KeywordMatchPanelProps {
  onDone?: () => void;
  onOpenTool?: (toolId: string) => void;
}

export function KeywordMatchPanel({ onDone, onOpenTool }: KeywordMatchPanelProps) {
  const fields = useSelector((s: RootState) => s.resumeBuilder.fields);
  const jobDescription = useSelector((s: RootState) => s.resumeBuilder.jobDescription);
  const { getToken } = useAuth();

  const [jd, setJd] = useState(jobDescription);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<KeywordMatchResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    setJd(jobDescription);
  }, [jobDescription]);

  const handleAnalyze = async () => {
    if (!jd.trim() || isAnalyzing) return;
    setIsAnalyzing(true);

    try {
      const token = await getToken();
      const resp = await fetch(ENDPOINTS.resumeBuilderKeywordMatch(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jobDescription: jd,
          fields,
        }),
      });

      if (!resp.ok) throw new Error("Failed to analyze keywords");

      const { data } = await resp.json();
      console.log("Keyword Match Result:", data);
      
      if (!data || typeof data !== "object") {
        throw new Error("Invalid response from server");
      }

      setResult(data);
    } catch (err) {
      console.error(err);
      toast.error("Analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sections = ["Summary", "Experience", "Projects", "Education", "Skills"];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
            <Search className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Keyword Match</h2>
            <p className="text-[12px] text-slate-500">Visualise keyword coverage across your resume sections. Free.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-6 space-y-6">
          {/* JD Input */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Job Description</label>
              {jd.length > 0 && <span className="text-[10px] text-slate-400">{jd.length} chars</span>}
            </div>
            <div className="relative group">
              <Textarea
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                placeholder="Paste the target Job Description here to analyze keyword match..."
                className="min-h-[160px] resize-none text-[13px] leading-relaxed p-4 rounded-2xl border-slate-200 focus-visible:ring-blue-500/20 focus-visible:border-blue-400 transition-all placeholder:text-slate-300"
              />
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || jd.trim().length < 10}
                className="absolute bottom-3 right-3 h-8 bg-slate-900 hover:bg-slate-800 text-white rounded-lg px-4 text-[12px] font-bold shadow-lg shadow-slate-900/10 transition-all active:scale-[0.98]"
              >
                {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                Analyze Coverage
              </Button>
            </div>
          </div>

          {result && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
              {/* Summary Stats */}
              <div className="flex items-center justify-between bg-slate-50/50 border border-slate-100 rounded-2xl p-4">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-[13px] font-bold text-slate-900">{result.present.length} <span className="font-medium text-slate-500 ml-1">Present</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-rose-400" />
                    <span className="text-[13px] font-bold text-slate-900">{result.missing.length} <span className="font-medium text-slate-500 ml-1">Missing</span></span>
                  </div>
                </div>

                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                  <button
                    onClick={() => setViewMode("list")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all",
                      viewMode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                    List
                  </button>
                  <button
                    onClick={() => setViewMode("map")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all",
                      viewMode === "map" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    Visual Map
                  </button>
                </div>
              </div>

              {viewMode === "list" ? (
                <div className="flex flex-wrap gap-2">
                  {Object.keys(result.visualMap || {}).map((kw) => {
                    const isPresent = result.present.includes(kw);
                    return (
                      <div
                        key={kw}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-all select-none",
                          isPresent
                            ? "bg-emerald-50/50 border-emerald-200 text-emerald-700"
                            : "bg-rose-50/50 border-rose-100 text-rose-500"
                        )}
                      >
                        {kw}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-200">
                          <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left min-w-[140px]">Keyword</th>
                          {sections.map(s => (
                            <th key={s} className="px-2 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">{s}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.entries(result.visualMap || {}).map(([kw, foundIn]) => (
                          <tr key={kw} className="hover:bg-slate-50/30 transition-colors">
                            <td className="px-4 py-3 text-[12px] font-bold text-slate-700">{kw}</td>
                            {sections.map(s => {
                              const isFound = foundIn.includes(s);
                              return (
                                <td key={s} className="px-2 py-3 text-center">
                                  <div className={cn(
                                    "h-5 w-5 rounded-md mx-auto flex items-center justify-center transition-all",
                                    isFound ? "bg-emerald-100 text-emerald-600" : "bg-rose-50 text-rose-200"
                                  )}>
                                    {isFound ? <Check className="h-3 w-3" strokeWidth={3} /> : <div className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action Footer */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <span>Want to fix these automatically?</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenTool?.("injectkeywords")}
                  className="h-8 rounded-lg text-[11px] font-bold border-amber-200 bg-amber-50/50 text-amber-700 hover:bg-amber-100 hover:border-amber-300"
                >
                  Open Bulk Keywords Tool
                </Button>
              </div>
            </div>
          )}

          {!result && !isAnalyzing && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mb-4">
                <Info className="h-6 w-6 text-slate-300" />
              </div>
              <p className="text-[13px] font-medium text-slate-500">Paste a Job Description above to see your keyword coverage.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
