import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AIAnswerButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  isFullscreen?: boolean;
  className?: string;
}

export const AIAnswerButton = ({
  onClick,
  disabled = false,
  isLoading = false,
  isFullscreen = false,
  className,
}: AIAnswerButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={onClick}
          disabled={disabled || isLoading}
          aria-disabled={disabled || isLoading}
          className={cn(
            "flex-1 h-10 rounded-xl text-xs font-bold flex items-center justify-center gap-2 relative overflow-hidden group transition-all duration-300 disabled:opacity-50 disabled:pointer-events-none",
            isFullscreen
              ? "bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-xl"
              : "bg-[#1a1c23] hover:bg-[#252830] text-white shadow-[0_8px_16px_-4px_rgba(69,143,255,0.15)]",
            className,
          )}
        >
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-brand group-hover:h-1 transition-all" />
          {isLoading ? (
            <div className="h-4 w-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-brand fill-brand group-hover:scale-110 transition-transform" />
          )}
          {isLoading ? "Generating..." : "AI Answer"}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="p-0 bg-transparent border-none shadow-none"
      >
        <kbd className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs font-bold text-slate-900 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.1)]">
          <span className="text-base leading-none opacity-50">⌘</span>
          <span className="opacity-30 font-light">+</span>
          <span>G</span>
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
};
