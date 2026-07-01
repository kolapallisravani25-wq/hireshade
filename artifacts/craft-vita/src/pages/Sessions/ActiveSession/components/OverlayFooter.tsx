import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface OverlayFooterProps {
  isMicActive: boolean;
  version?: string;
  className?: string;
}

export const OverlayFooter = ({
  isMicActive,
  version = "v0.1.0",
  className,
}: OverlayFooterProps) => {
  return (
    <div 
      data-tauri-drag-region 
      className={cn("mt-4 pt-3 border-t border-white/5 flex items-center justify-between transition-all duration-300", className)}
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-slate-500">
        <div className="relative">
          <Mic size={14} className={cn("transition-colors duration-300", isMicActive ? "text-blue-400" : "text-slate-600")} />
          {isMicActive && (
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-20" />
          )}
        </div>
        <span data-tauri-drag-region className={cn(
          "text-[10px] font-semibold tracking-wider transition-colors",
          isMicActive ? "text-blue-400" : "text-slate-600"
        )}>
          {isMicActive ? "LISTENING" : "IDLE"}
        </span>
      </div>
      <div data-tauri-drag-region className="text-[10px] font-bold text-white/20 uppercase tracking-tighter">
        {version}
      </div>
    </div>
  );
};
