import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  isActive?: boolean;
  isConnecting?: boolean;
  error?: string | null;
  className?: string;
  isFullscreen?: boolean;
}

export const StatusBadge = ({
  status,
  isActive = false,
  isConnecting = false,
  error = null,
  className,
  isFullscreen = false,
}: StatusBadgeProps) => {
  return (
    <div className={cn("flex items-center gap-2 mt-1", className)}>
      <div
        className={cn(
          "w-2 h-2 rounded-full transition-all duration-500",
          error
            ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
            : isConnecting
            ? "bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)]"
            : isActive
            ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            : "bg-slate-300",
        )}
      />
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-tight transition-colors duration-300",
          error
            ? "text-rose-400"
            : isFullscreen
            ? "text-white/70"
            : "text-slate-500",
        )}
      >
        {error ? `Error: ${error}` : status}
      </span>
    </div>
  );
};
