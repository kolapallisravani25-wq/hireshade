import { User, Headset } from "lucide-react";
import { cn } from "@/lib/utils";
import { Message } from "../Transcript";
import { InlineEditableTranscriptText } from "@/features/session/components/InlineEditableTranscriptText";

interface TranscriptMessageProps {
  message: Message;
  isFullscreen?: boolean;
  onPatchMessage?: (messageId: string, patchedText: string) => void;
}

export const TranscriptMessage = ({
  message,
  isFullscreen = false,
  onPatchMessage,
}: TranscriptMessageProps) => {
  const isUser = message.sender === "User";
  const displayText = message.patchedText || message.text;

  return (
    <div
      className={cn(
        "flex group max-w-[85%] duration-500",
        isUser ? "ml-auto flex-row-reverse" : "mr-auto flex-row",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-sm transition-transform group-hover:scale-110",
          isUser ? "ml-3 bg-brand/10 border border-brand/20" : "mr-3 bg-slate-100 border border-slate-200",
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-brand" />
        ) : (
          <Headset className="h-4 w-4 text-slate-500" />
        )}
      </div>

      <div
        className={cn(
          "flex flex-col",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div className="flex items-center gap-2 mb-1.5 px-1">
          <span className={cn(
            "text-[10px] font-extrabold uppercase tracking-widest transition-colors",
            isFullscreen ? "text-white/40" : "text-slate-400"
          )}>
            {isUser ? "You" : "Remote User"}
          </span>
          <span className={cn(
            "text-[9px] font-bold transition-colors",
            isFullscreen ? "text-white/20" : "text-slate-300"
          )}>
            {message.time}
          </span>
        </div>

        <div
          className={cn(
            "px-5 py-3 rounded-2xl text-[14px] font-medium leading-relaxed shadow-sm transition-all group-hover:shadow-md",
            isUser
              ? isFullscreen
                ? "bg-white/10 text-white rounded-tr-none border border-white/10 backdrop-blur-md"
                : "bg-white text-slate-700 rounded-tr-none border border-slate-100"
              : isFullscreen
                ? "bg-white/10 text-white rounded-tl-none border border-white/10 backdrop-blur-md"
                : "bg-white text-slate-700 rounded-tl-none border border-slate-100",
          )}
        >
          <InlineEditableTranscriptText
            value={displayText}
            patchedByUser={message.patchedByUser}
            onPatch={(next) => onPatchMessage?.(message.id, next)}
          />
        </div>
      </div>
    </div>
  );
};
