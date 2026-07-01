/**
 * TranscriptBubble
 * ─────────────────────────────────────────────────────────────────────────────
 * A single message bubble inside the session transcript panel.
 *
 * "You" (mic / user) appears on the RIGHT with blue styling.
 * "System" (interviewer / tab audio) appears on the LEFT with purple styling.
 * This matches WhatsApp / Slack directionality so users instantly recognize
 * who is speaking.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { InlineEditableTranscriptText } from "./InlineEditableTranscriptText";

export interface TranscriptBubbleProps {
  id?: string;
  sender: "User" | "Interviewer";
  text: string;
  /** When true the bubble renders with italic text + reduced opacity (interim / streaming) */
  isInterim?: boolean;
  patchedByUser?: boolean;
  onPatch?: (messageId: string, patchedText: string) => void;
}

export const TranscriptBubble: React.FC<TranscriptBubbleProps> = ({
  id,
  sender,
  text,
  isInterim = false,
  patchedByUser = false,
  onPatch,
}) => {
  const isYou = sender === "User";

  return (
    <div
      className={cn(
        "flex gap-2 items-start",
        isInterim && "opacity-60",
        isYou ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Status dot */}
      <span
        className={cn(
          "shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full",
          isYou
            ? "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)]"
            : "bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.6)]",
          isInterim && "animate-pulse",
        )}
      />

      <div className={cn("flex flex-col max-w-[82%]", isYou ? "items-end" : "items-start")}>
        {/* Sender label */}
        <span
          className={cn(
            "text-[9px] font-bold uppercase tracking-[0.12em] mb-0.5",
            isYou ? "text-blue-400" : "text-purple-400",
          )}
        >
          {isYou ? "You" : "System"}
        </span>

        {/* Bubble */}
        <span
          className={cn(
            "px-3 py-1.5 rounded-2xl text-[12.5px] leading-snug font-medium break-words",
            isInterim && "italic",
            isYou
              ? "bg-blue-500/15 text-blue-50 rounded-tr-sm"
              : "bg-purple-500/15 text-purple-50 rounded-tl-sm",
          )}
        >
          {isInterim || !id ? (
            text
          ) : (
            <InlineEditableTranscriptText
              messageId={id}
              value={text}
              patchedByUser={patchedByUser}
              onPatch={(nextText) => onPatch?.(id, nextText)}
              className="text-[12.5px] leading-snug"
            />
          )}
        </span>
      </div>
    </div>
  );
};
