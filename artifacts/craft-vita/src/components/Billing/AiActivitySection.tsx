 ;

import { useState } from "react";
import { useCreditsUsage } from "@/hooks/useCreditsUsage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

// Map operation keys → friendly labels
const OPERATION_LABELS: Record<string, string> = {
  resume_generate:        "Resume Generate",
  resume_enhance_section: "Section Enhance",
  resume_tailor:          "Tailor to JD",
  resume_extract_fields:  "Extract Fields",
};

const OPERATION_FILTERS: { value: string; label: string }[] = [
  { value: "",                       label: "All AI operations" },
  { value: "resume_generate",        label: "Resume Generate" },
  { value: "resume_enhance_section", label: "Section Enhance" },
  { value: "resume_tailor",          label: "Tailor to JD" },
  { value: "resume_extract_fields",  label: "Extract Fields" },
];

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AiActivitySection() {
  const [filter, setFilter] = useState<string>("");
  const { entries, pagination, isLoading, page, setPage, setOperation } =
    useCreditsUsage(10);

  const handleFilter = (op: string) => {
    setFilter(op);
    setOperation(op || undefined);
    setPage(1);
  };

  const totalPages = pagination?.pages ?? 1;

  return (
    <section className="rounded-3xl border border-slate-200/60 bg-white/95 p-6 sm:p-7 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 ring-1 ring-violet-200/60 grid place-items-center text-violet-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">AI Activity</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">
              Per-operation breakdown of credits charged for AI features.
              Cached responses are served free.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {OPERATION_FILTERS.map((f) => (
            <Button
              key={f.value || "all"}
              variant={filter === f.value ? "default" : "outline"}
              size="sm"
              onClick={() => handleFilter(f.value)}
              className="h-8 text-[12px]"
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading AI activity…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Sparkles className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No AI operations recorded yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Use AI Enhance, Tailor to JD, or Extract Fields in the Resume Builder to see activity here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-slate-200/70">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Operation</th>
                  <th className="px-4 py-2.5 text-left font-semibold">When</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Credits</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {entries.map((e) => {
                  const credits = Number(e.creditsUsed);
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {OPERATION_LABELS[e.operation] ?? e.operation}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {fmtDateTime(e.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {e.cached ? (
                          <span className="text-emerald-600 font-medium">FREE</span>
                        ) : (
                          <span className="text-slate-900 font-semibold">{credits.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {e.cached ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-[10px] gap-1">
                            <Zap className="h-3 w-3" /> Cached
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-violet-700 border-violet-300 bg-violet-50 text-[10px]">
                            Charged
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages} · {pagination?.total ?? 0} total
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
