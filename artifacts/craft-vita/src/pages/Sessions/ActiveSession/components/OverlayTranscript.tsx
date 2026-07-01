import { useEffect, useRef, useMemo } from "react";
import { Mic, MicOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { detectIntent } from "@/lib/intent-detector";

interface OverlayTranscriptProps {
  transcript: string;
  interimTranscript?: string;
  isMicActive?: boolean;
  className?: string;
}

export const OverlayTranscript = ({
  transcript,
  interimTranscript,
  isMicActive,
  className,
}: OverlayTranscriptProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Apply intent detection to clean up speech recognition artifacts
  const cleanedTranscript = useMemo(() => {
    if (!transcript?.trim()) return "";
    const intent = detectIntent(transcript);
    return intent.cleanedQuestion || transcript;
  }, [transcript]);

  // Apply intent detection to interim transcript for cleaner display
  const cleanedInterim = useMemo(() => {
    if (!interimTranscript?.trim()) return "";
    const intent = detectIntent(interimTranscript);
    return intent.cleanedQuestion || interimTranscript;
  }, [interimTranscript]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [cleanedTranscript, cleanedInterim]);

  return (
    <div
      data-tauri-drag-region
      className={cn("flex-1 overflow-hidden flex flex-col gap-2", className)}
    >
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto pr-2 scrollbar-hide text-sm leading-relaxed selection:bg-blue-500/30"
      >
        {cleanedTranscript || cleanedInterim ? (
          <p className="italic">
            <span className="text-white/70 font-medium">{cleanedTranscript}</span>
            {cleanedInterim && (
              <span className="text-white/30 ml-1">{cleanedInterim}</span>
            )}
          </p>
        ) : (
          <span className="text-white/20 italic animate-pulse">
            {isMicActive ? "Listening for speech..." : "Waiting for audio..."}
          </span>
        )}
      </div>
    </div>
  );
};
