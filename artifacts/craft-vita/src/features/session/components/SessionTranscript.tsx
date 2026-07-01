import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TranscriptBubble } from "./TranscriptBubble";

export interface TranscriptMessage {
  id: string;
  sender: "User" | "Interviewer";
  text: string;
  timestamp: number;
  originalText?: string;
  patchedText?: string;
  patchedAt?: number;
  patchedByUser?: boolean;
}

export interface SessionTranscriptProps {
  messages: TranscriptMessage[];
  micInterim?: string;
  tabInterim?: string;
  onPatchMessage?: (messageId: string, patchedText: string) => void;
}

export const SessionTranscript: React.FC<SessionTranscriptProps> = ({
  messages,
  micInterim = "",
  tabInterim = "",
  onPatchMessage,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const interimText = micInterim || tabInterim;
  const isYouInterim = !!micInterim;

  // Interim bubble occupies one extra virtual slot at the end
  const count = messages.length + (interimText ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 52,
    overscan: 4,
  });

  // Scroll to bottom when messages or interim change
  useEffect(() => {
    if (count > 0 && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, interimText, count]);

  if (count === 0) {
    return (
      <div className="border-b border-white/10 max-h-52 overflow-y-auto no-scrollbar px-3 py-2.5">
        <p className="text-[11px] text-white/30 text-center py-2">No transcript yet…</p>
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="border-b border-white/10 max-h-52 overflow-y-auto no-scrollbar px-3 py-2.5"
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((item) => {
          const isInterim = item.index === messages.length;
          const m = isInterim ? null : messages[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                transform: `translateY(${item.start}px)`,
                width: "100%",
                paddingBottom: "10px",
              }}
            >
              {isInterim ? (
                <TranscriptBubble
                  sender={isYouInterim ? "User" : "Interviewer"}
                  text={interimText}
                  isInterim
                />
              ) : (
                <TranscriptBubble
                  id={m!.id}
                  sender={m!.sender}
                  text={m!.patchedText || m!.text}
                  patchedByUser={m!.patchedByUser}
                  isInterim={false}
                  onPatch={onPatchMessage}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
