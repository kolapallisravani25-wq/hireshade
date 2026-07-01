import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface SessionTimerProps {
  timerText: string | null;
  isFreeSession?: boolean;
  isFullscreen?: boolean;
  isWarning?: boolean;
  className?: string;
}

export const SessionTimer = ({
  timerText,
  isFreeSession = false,
  isFullscreen = false,
  isWarning = false,
  className,
}: SessionTimerProps) => {
  if (!timerText) return null;

  const isAlert = isFreeSession || isWarning;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-1.5 border rounded-xl text-sm font-bold shadow-sm transition-all duration-300",
        isFullscreen
          ? "bg-black/40 border-white/20 text-white backdrop-blur-md"
          : "bg-white/40 border-slate-200/50 text-slate-600",
        isWarning && !isFullscreen && "border-amber-400/60 bg-amber-50/60 text-amber-700",
        isWarning && isFullscreen && "border-amber-400/60",
        className
      )}
    >
      <Clock className={cn("h-4 w-4", isAlert ? "text-rose-500" : "text-blue-500")} />
      <span>
        {timerText}
        {isFreeSession && <span className="text-slate-400 text-xs ml-1">(Free)</span>}
        {isWarning && !isFreeSession && <span className="text-amber-500 text-xs ml-1">low credits</span>}
      </span>
    </div>
  );
};
