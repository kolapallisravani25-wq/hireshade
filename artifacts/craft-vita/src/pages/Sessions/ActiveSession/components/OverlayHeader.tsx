import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface OverlayHeaderProps {
  onClose?: () => void;
  title?: string;
  className?: string;
}

export const OverlayHeader = ({
  onClose = () => window.close(),
  title = "HireShade Overlay",
  className,
}: OverlayHeaderProps) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between mb-4 pointer-events-none transition-all duration-300",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse" />
        <h1 className="text-xs font-bold text-white/50 uppercase tracking-widest">
          {title}
        </h1>
      </div>
      <button
        onClick={onClose}
        className="p-1.5 hover:bg-white/10 rounded-xl transition-all text-slate-400 hover:text-white pointer-events-auto active:scale-95"
      >
        <X size={16} />
      </button>
    </div>
  );
};
