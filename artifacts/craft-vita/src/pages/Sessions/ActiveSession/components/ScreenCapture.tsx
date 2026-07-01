import { Button } from "@/components/ui/button";
import { ScreenShare, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScreenCaptureProps {
  stream: MediaStream | null;
  // Callback ref from useScreenShare — re-attaches the stream whenever
  // this element mounts or remounts (e.g. after a fullscreen toggle).
  videoRef: React.RefCallback<HTMLVideoElement>;
  onChangeTab: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const ScreenCapture = ({
  stream,
  videoRef,
  onChangeTab,
  isFullscreen = false,
  onToggleFullscreen,
}: ScreenCaptureProps) => {
  return (
    <div
      className={cn(
        "bg-slate-900 overflow-hidden group/video",
        isFullscreen
          ? "fixed inset-0 z-0"
          : "relative h-full rounded-none border-b border-slate-200",
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          "w-full h-full object-contain bg-black",
          !stream && "hidden",
        )}
      />

      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-900">
          <div className="h-16 w-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
            <ScreenShare className="h-8 w-8 text-white/40" />
          </div>
          <p className="text-sm text-white/40 font-medium">
            No screen selected
          </p>
          {/* Must be a real button click — WKWebView rejects getDisplayMedia
              calls that don't originate from a direct user gesture. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onChangeTab}
            className="h-8 bg-white/15 backdrop-blur-md border border-white/20 text-white hover:bg-white/25 rounded-lg px-4 text-xs font-bold"
          >
            <ScreenShare className="h-3.5 w-3.5 mr-1.5" />
            Select Screen / Tab
          </Button>
          <p className="text-xs text-white/25 max-w-55 text-center leading-relaxed">
            Enable "Include audio" in the picker to capture tab audio
          </p>
        </div>
      )}

      {/* Floating Controls — always visible so user can toggle back */}
      <div className="absolute top-4 left-4 flex gap-2 z-10">
        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleFullscreen}
          className="h-8 bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 rounded-lg px-3 text-xs font-bold"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
          {isFullscreen ? "Exit Fullscreen" : "Full screen"}
        </Button>
        {!isFullscreen && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onChangeTab}
            className="h-8 bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 rounded-lg px-3 text-xs font-bold"
          >
            Change Tab
          </Button>
        )}
      </div>
    </div>
  );
};
