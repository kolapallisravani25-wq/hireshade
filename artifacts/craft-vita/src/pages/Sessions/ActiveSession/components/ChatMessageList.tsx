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
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

  // Scroll to bottom using bottom anchor element
  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "end",
    });
  }, []);

  // Auto-scroll when messages change (new message added)
  useEffect(() => {
    const messageCount = messages.length;
    
    // Always scroll when messages are added
    if (messageCount > lastMessageCountRef.current) {
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
    
    lastMessageCountRef.current = messageCount;
  }, [messages.length, scrollToBottom]);

  // Auto-scroll during streaming updates
  useEffect(() => {
    if (!isStreaming) return;
    // Use requestAnimationFrame to prevent rapid scroll updates during streaming
    // Use instant scroll (auto behavior) to prevent flickering
    const rafId = requestAnimationFrame(() => {
      scrollToBottom(false);
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isStreaming, scrollToBottom]);

  return (
    <div className="flex-1 overflow-y-auto p-8 relative no-scrollbar">
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
