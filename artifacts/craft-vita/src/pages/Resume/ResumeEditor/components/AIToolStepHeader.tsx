import React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

/** Step indicator header shown inside multi-step AI tool dialogs. */
export function AIToolStepHeader({
  steps,
  current,
}: {
  steps: Array<{ id: string; label: string }>;
  current: string;
}) {
  const currentIndex = Math.max(0, steps.findIndex((s) => s.id === current));
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {steps.map((step, idx) => {
        const done   = idx < currentIndex;
        const active = idx === currentIndex;
        return (
          <React.Fragment key={step.id}>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-5 w-5 rounded-full border text-[10px] font-semibold flex items-center justify-center",
                  done   && "bg-emerald-500 border-emerald-500 text-white",
                  active && "bg-violet-100 border-violet-300 text-violet-700",
                  !done && !active && "bg-slate-50 border-border text-slate-500",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : idx + 1}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && <span className="text-slate-300 text-[10px]">›</span>}
          </React.Fragment>
        );
      })}
    </div>
  );
}
