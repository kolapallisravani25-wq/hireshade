import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { clearAiActivity } from "@/store/resumeBuilderSlice";
import {
  Activity, Sparkles, Zap, XCircle, CheckCircle2,
  ChevronRight, Trash2,
} from "lucide-react";

/**
 * Compact "AI" pill shown in the TopBar — tracks every billable AI action this
 * session with credits used, cache hits, and errors.
 */
export function AiActivityButton() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const log = useSelector((s: RootState) => s.resumeBuilder.aiActivityLog);
  const [open, setOpen] = useState(false);

  const totalCredits = log.reduce((sum, e) => sum + (e.status === "success" ? e.creditsUsed : 0), 0);
  const successCount = log.filter((e) => e.status === "success").length;
  const cachedCount  = log.filter((e) => e.cached).length;
  const errorCount   = log.filter((e) => e.status === "error").length;

  const formatRelative = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 5_000) return "just now";
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="AI activity this session"
          className={cn(
            "flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-[12px] font-medium transition-colors duration-150 shrink-0",
            log.length > 0
              ? "border-violet-200/70 bg-violet-50/60 text-violet-700 hover:bg-violet-50"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
          )}
        >
          <Activity className={cn("h-3.5 w-3.5", log.length > 0 && "text-violet-500")} />
          <span>AI</span>
          {log.length > 0 && (
            <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
              {log.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-br from-violet-50/40 via-white to-indigo-50/30">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-900 leading-tight">AI activity</p>
              <p className="text-[10.5px] text-slate-500 mt-0.5">This editor session</p>
            </div>
            {log.length > 0 && (
              <button onClick={() => dispatch(clearAiActivity())} title="Clear session log" className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              { label: "Used",    value: totalCredits.toFixed(2), cls: "text-slate-900" },
              { label: "Actions", value: successCount,             cls: "text-slate-900" },
              { label: "Cached",  value: cachedCount,              cls: "text-emerald-600" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-white border border-slate-200/70 px-2 py-1.5">
                <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold">{stat.label}</div>
                <div className={cn("text-[14px] font-semibold tabular-nums", stat.cls)}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto px-2 py-2">
          {log.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center mb-2.5">
                <Zap className="h-4 w-4 text-slate-400" />
              </div>
              <p className="text-[12px] font-medium text-slate-700">No AI actions yet</p>
              <p className="text-[10.5px] text-slate-500 mt-1 leading-relaxed">
                Use AI Enhance or JD Tailor — every charge will appear here.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {log.map((entry) => {
                const isErr = entry.status === "error";
                return (
                  <li
                    key={entry.id}
                    className={cn(
                      "px-2.5 py-2 rounded-md border text-[11.5px] flex items-start gap-2.5",
                      isErr ? "bg-rose-50/60 border-rose-200/70"
                        : entry.cached ? "bg-emerald-50/40 border-emerald-200/60"
                        : "bg-white border-slate-200/70",
                    )}
                  >
                    <div className={cn(
                      "h-5 w-5 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                      isErr ? "bg-rose-100 text-rose-600"
                        : entry.cached ? "bg-emerald-100 text-emerald-600"
                        : "bg-violet-100 text-violet-600",
                    )}>
                      {isErr ? <XCircle className="h-3 w-3" />
                        : entry.cached ? <CheckCircle2 className="h-3 w-3" />
                        : <Sparkles className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800 truncate">{entry.label || entry.operation}</span>
                        <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{formatRelative(entry.createdAt)}</span>
                      </div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {isErr ? (
                          <span className="text-rose-700 truncate">{entry.errorMessage || "Failed"}</span>
                        ) : entry.cached ? (
                          <span className="text-emerald-700 font-medium">Cached · 0 credits</span>
                        ) : (
                          <span>
                            <span className="font-semibold text-slate-700 tabular-nums">{entry.creditsUsed}</span>{" "}
                            credit{entry.creditsUsed === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-3 py-2.5 border-t border-slate-200/70 bg-slate-50/60 flex items-center justify-between">
          <span className="text-[10.5px] text-slate-500">
            {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"} · ` : ""}Session-only
          </span>
          <button
            onClick={() => { setOpen(false); navigate("/billing"); }}
            className="text-[11px] font-semibold text-violet-600 hover:text-violet-800 flex items-center gap-1"
          >
            Full history <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
