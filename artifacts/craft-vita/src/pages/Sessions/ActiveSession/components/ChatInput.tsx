import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  placeholder?: string;
  isFullscreen?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ChatInput = ({
  value,
  onChange,
  onSend,
  placeholder = "Type a manual message...",
  isFullscreen = false,
  disabled = false,
  className,
}: ChatInputProps) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend?.();
    }
  };

  return (
    <div
      className={cn("flex gap-3 mb-4 transition-all duration-300", className)}
    >
      <div className="flex-1 relative group">
        <input
          className={cn(
            "w-full h-12 rounded-xl px-5 text-sm font-semibold transition-all focus:outline-none focus:ring-2 disabled:opacity-50",
            isFullscreen
              ? "bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:ring-white/20 backdrop-blur-md"
              : "bg-slate-50 border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-brand/20 shadow-inner",
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <div
          className={cn(
            "absolute inset-0 rounded-xl pointer-events-none transition-opacity duration-300 opacity-0 group-focus-within:opacity-100 ring-2",
            isFullscreen ? "ring-white/10" : "ring-brand/5",
          )}
        />
      </div>
      <Button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className={cn(
          "h-12 w-12 rounded-xl transition-all active:scale-95 shadow-lg border-none shrink-0",
          isFullscreen
            ? "bg-white/20 text-white hover:bg-white/30 backdrop-blur-md"
            : "bg-brand text-white hover:bg-brand/90 hover:shadow-brand/20 hover:-translate-y-0.5",
        )}
      >
        <Send className={cn("h-5 w-5", !value.trim() && "opacity-50")} />
      </Button>
    </div>
  );
};
