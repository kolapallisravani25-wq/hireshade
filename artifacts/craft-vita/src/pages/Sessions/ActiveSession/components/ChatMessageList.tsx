import { useRef, useEffect, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { Message } from "../Transcript";
import { ChatMessage } from "./ChatMessage";
import { cn } from "@/lib/utils";

interface ChatMessageListProps {
  messages: Message[];
  isStreaming: boolean;
  isFullscreen?: boolean;
  onRegenerate?: (messageId: string) => void;
  onMessageInteract?: (messageId: string) => void;
  disableRegenerate?: boolean;
}

export const ChatMessageList = ({
  messages,
  isStreaming,
  isFullscreen = false,
  onRegenerate,
  onMessageInteract,
  disableRegenerate = false,
}: ChatMessageListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  // Whether the user is parked near the bottom. Starts true so the first
  // answer scrolls into view; flips to false the moment the user scrolls up
  // to read history, which suppresses streaming auto-scroll (issue: answer
  // card jumping while the user is reading an earlier answer).
  const isNearBottomRef = useRef(true);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  // Track the user's scroll position so we only auto-scroll when they are
  // already following the latest content. ~120px tolerance treats "close to
  // the bottom" as "wants to stay pinned".
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  // A brand-new answer card was added → always jump to it (a new answer
  // starting is an explicit "show me this" event regardless of scroll pos).
  useEffect(() => {
    const messageCount = messages.length;
    if (messageCount > lastMessageCountRef.current) {
      isNearBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom(true));
    }
    lastMessageCountRef.current = messageCount;
  }, [messages.length, scrollToBottom]);

  // Streaming content grows → follow it ONLY if the user is still near the
  // bottom. Depend on the last message's text so this re-runs on every chunk
  // (message.length alone never changes mid-stream). Instant (non-smooth)
  // scroll avoids the flicker/fighting of smooth-scroll during rapid updates.
  const lastMessageText = messages[messages.length - 1]?.text ?? "";
  useEffect(() => {
    if (!isStreaming) return;
    if (!isNearBottomRef.current) return;
    const rafId = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(rafId);
  }, [isStreaming, lastMessageText, scrollToBottom]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-8 relative no-scrollbar"
    >
      {messages.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-12">
          <div className="h-12 w-12 rounded-2xl bg-brand/10 flex items-center justify-center mb-4">
            <Sparkles className="h-6 w-6 text-brand" />
          </div>
          <h3 className={cn(
            "text-lg font-bold mb-1",
            isFullscreen ? "text-white" : "text-slate-700"
          )}>
            No messages yet.
          </h3>
          <p className={cn(
            "text-sm font-medium",
            isFullscreen ? "text-slate-300" : "text-slate-400"
          )}>
            Click "AI Answer" to start!
          </p>
        </div>
      ) : (
        <>
          {messages.map((chat) => (
            <ChatMessage
              key={chat.id}
              message={chat}
              isFullscreen={isFullscreen}
              isStreaming={
                isStreaming && chat.id === messages[messages.length - 1].id
              }
              onRegenerate={onRegenerate ? () => onRegenerate(chat.id) : undefined}
              regenerateDisabled={disableRegenerate}
              onInteract={onMessageInteract}
            />
          ))}
          {/* Bottom anchor element for reliable scrolling */}
          <div ref={bottomRef} className="h-0" />
        </>
      )}
    </div>
  );
};
