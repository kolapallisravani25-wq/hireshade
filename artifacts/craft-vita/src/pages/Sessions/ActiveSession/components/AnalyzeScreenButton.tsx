import { Button } from "@/components/ui/button";
import { Monitor } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AnalyzeScreenButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  isFullscreen?: boolean;
  className?: string;
}

export const AnalyzeScreenButton = ({
  onClick,
  disabled = false,
  isLoading = false,
  isFullscreen = false,
  className,
}: AnalyzeScreenButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={onClick}
          disabled={disabled || isLoading}
          variant="outline"
          className={cn(
            "flex-1 h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all duration-300 disabled:opacity-50",
            isFullscreen
              ? "bg-white/5 border-white/20 text-white hover:bg-white/10 backdrop-blur-md"
              : "border-slate-200 hover:bg-slate-50 text-slate-700",
            className,
          )}
        >
          {isLoading ? (
            <div className="h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Monitor
              className={cn(
                "h-4 w-4",
                isFullscreen ? "text-white/70" : "text-slate-400",
              )}
            />
          )}
          Analyze Screen
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="p-0 bg-transparent border-none shadow-none"
      >
        <kbd className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs font-bold text-slate-900 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)]">
          <span className="text-base leading-none opacity-50">⌘</span>
          <span className="opacity-30 font-light">+</span>
          <span>K</span>
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
};
