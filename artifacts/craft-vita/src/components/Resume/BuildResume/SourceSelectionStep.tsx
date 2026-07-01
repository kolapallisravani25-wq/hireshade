 ;

import { FileText, Type, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceSelectionStepProps {
  sourceType: "resume" | "scratch" | null;
  onSelect: (type: "resume" | "scratch") => void;
}

interface OptionCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}

function OptionCard({ selected, onClick, icon, title, description }: OptionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-4 w-full text-left rounded-xl px-4 py-3.5 transition-all duration-150 outline-none",
        "border focus-visible:ring-2 focus-visible:ring-blue-500/50",
        selected
          ? "border-blue-400/60 bg-blue-50/60 shadow-[0_0_0_3px_rgba(59,130,246,0.08)]"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex items-center justify-center h-9 w-9 rounded-lg shrink-0 transition-colors duration-150",
          selected
            ? "bg-blue-100 text-blue-600"
            : "bg-slate-100 text-slate-500",
        )}
      >
        {icon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          "text-[14px] font-semibold leading-snug transition-colors duration-150",
          selected ? "text-slate-900" : "text-slate-700",
        )}>
          {title}
        </p>
        <p className="mt-0.5 text-[12px] text-slate-400 leading-snug">
          {description}
        </p>
      </div>

      {/* Selection indicator */}
      <div
        className={cn(
          "flex items-center justify-center h-5 w-5 rounded-full border-2 shrink-0 transition-all duration-150",
          selected
            ? "border-blue-500 bg-blue-500"
            : "border-slate-300 bg-white",
        )}
      >
        {selected && <Check className="h-3 w-3 text-white" strokeWidth={2.5} />}
      </div>
    </button>
  );
}

export function SourceSelectionStep({
  sourceType,
  onSelect,
}: SourceSelectionStepProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <OptionCard
        selected={sourceType === "resume"}
        onClick={() => onSelect("resume")}
        icon={<FileText className="h-4 w-4" />}
        title="Use Existing Resume"
        description="Extract data from your uploaded files for a quick start."
      />

      {/* OR Divider */}
      <div className="flex items-center gap-3 py-0.5">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[10px] font-semibold text-slate-400 tracking-widest uppercase">
          or
        </span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <OptionCard
        selected={sourceType === "scratch"}
        onClick={() => onSelect("scratch")}
        icon={<Type className="h-4 w-4" />}
        title="Start from Scratch"
        description="AI builds your resume from the job description or role you provide."
      />
    </div>
  );
}
