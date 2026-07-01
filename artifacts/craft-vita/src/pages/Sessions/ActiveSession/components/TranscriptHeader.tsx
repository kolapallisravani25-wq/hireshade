import { X, ExternalLink, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface TranscriptHeaderProps {
  isConnecting?: boolean;
  isTabTranscribing?: boolean;
  isMicTranscribing?: boolean;
  error?: string | null;
  onToggleMic: () => void;
  onClear: () => void;
  onOpenOverlay?: () => void;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
  isFullscreen?: boolean;
  onMinimize?: () => void;
  onChangeTab?: () => void;
  currentMicDevice?: string;
}

export const TranscriptHeader = ({
  isConnecting = false,
  isTabTranscribing = false,
  isMicTranscribing = false,
  error = null,
  onToggleMic,
  onClear,
  onOpenOverlay,
  autoScroll,
  setAutoScroll,
  isFullscreen = false,
  onMinimize,
  currentMicDevice,
  onChangeTab,
}: TranscriptHeaderProps) => {
  const statusText = isConnecting
    ? "Connecting to Remote..."
    : isTabTranscribing
      ? "Remote user streaming"
      : "Remote user inactive";

  return (
    <div
      className={cn(
        "flex flex-col border-b shrink-0 transition-all duration-300",
        isFullscreen
          ? "bg-transparent drop-shadow-lg border-white/10"
          : "bg-white border-slate-200/50",
      )}
    >
      <div className="px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <h2
              className={cn(
                "text-sm font-black uppercase tracking-wider",
                isFullscreen ? "text-white" : "text-slate-800",
              )}
            >
              Live Transcript
            </h2>
            <StatusBadge
              status={statusText}
              isActive={isTabTranscribing}
              isConnecting={isConnecting}
              error={error}
              isFullscreen={isFullscreen}
            />
          </div>

          <div className="h-8 w-px bg-slate-100 hidden sm:block" />

          <div className="flex items-center gap-3 group">
            <div className="flex flex-col items-end">
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-tighter transition-colors",
                  isFullscreen ? "text-white/60" : "text-slate-400",
                )}
              >
                Your Mic
              </span>
              {currentMicDevice && (
                <span
                  className={cn(
                    "text-[9px] font-medium transition-colors",
                    isFullscreen ? "text-white/50" : "text-slate-400",
                  )}
                >
                  • {currentMicDevice}
                </span>
              )}
              <span
                className={cn(
                  "text-[10px] font-extrabold uppercase transition-colors",
                  isMicTranscribing
                    ? isFullscreen
                      ? "text-emerald-400"
                      : "text-brand"
                    : isFullscreen
                      ? "text-white/40"
                      : "text-slate-400",
                )}
              >
                {isMicTranscribing ? "Enabled" : "Disabled"}
              </span>
            </div>
            <Switch
              checked={isMicTranscribing}
              onCheckedChange={onToggleMic}
              disabled={isConnecting}
              className="data-[state=checked]:bg-brand"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onOpenOverlay && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenOverlay}
              className={cn(
                "h-8 gap-2 rounded-xl text-xs font-bold transition-all",
                isFullscreen
                  ? "text-white/80 hover:bg-white/10 hover:translate-y-[-1px]"
                  : "hover:bg-slate-100 text-slate-500",
              )}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Transcript
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className={cn(
              "h-8 gap-2 rounded-xl text-xs font-bold transition-all",
              isFullscreen
                ? "text-white/80 hover:bg-white/10 hover:translate-y-[-1px]"
                : "hover:bg-slate-100 text-slate-500",
            )}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>

          <div
            className={cn(
              "flex items-center gap-2 ml-2 pl-4 border-l transition-colors",
              isFullscreen ? "border-white/10" : "border-slate-100",
            )}
          >
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-tight",
                isFullscreen ? "text-white/60" : "text-slate-400",
              )}
            >
              Scroll
            </span>
            <Switch
              checked={autoScroll}
              onCheckedChange={setAutoScroll}
              className="scale-75"
            />
          </div>
        </div>
      </div>

      {isFullscreen && (
        <div className="px-5 pb-3 flex items-center gap-2 animate-in slide-in-from-top-1 duration-300">
          <Button
            onClick={onMinimize}
            className="h-8 gap-2 rounded-xl text-xs font-bold px-4 bg-rose-500 hover:bg-rose-600 text-white shadow-[0_4px_12px_rgba(244,63,94,0.3)] border-none"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            Minimize
          </Button>
          <Button
            onClick={onChangeTab}
            className="h-8 gap-2 rounded-xl text-xs font-bold px-4 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white border border-white/20"
          >
            Change Tab
          </Button>
        </div>
      )}
    </div>
  );
};
