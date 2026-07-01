import { useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssistantChat, AssistantMessage } from "../hooks/useAssistant";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";
import { ModelSelector } from "./ModelSelector";
import { SessionPicker } from "./SessionPicker";
import { SuggestionChips } from "./SuggestionChips";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  chat: AssistantChat | null;
  messages: AssistantMessage[];
  isStreaming: boolean;
  isLoading: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: (query: string, aiModel?: string) => void;
  onScopeChange: (chatId: string, sessionId: string | null) => void;
}

export function ChatWindow({
  chat,
  messages,
  isStreaming,
  isLoading,
  inputValue,
  onInputChange,
  onSend,
  onScopeChange,
}: Props) {
  const [model, setModel] = useState("auto");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) return;
    onSend(inputValue, model === "auto" ? undefined : model);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex flex-col min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">
            {chat?.title ?? "HireShade Assistant"}
          </h2>
          {chat?.sessionId && (
            <p className="text-[10px] text-brand mt-0.5">Scoped to session</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {chat && (
            <SessionPicker
              value={chat.sessionId ?? null}
              onChange={(sid) => onScopeChange(chat.id, sid)}
            />
          )}
          <ModelSelector value={model} onChange={setModel} />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex flex-col gap-4 p-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={cn("flex gap-3", i % 2 === 0 ? "flex-row-reverse" : "")}>
                <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
                <Skeleton className={cn("h-16 rounded-2xl", i % 2 === 0 ? "w-2/3" : "w-3/4")} />
              </div>
            ))}
          </div>
        ) : !hasMessages ? (
          <EmptyState onSuggestion={(text) => onSend(text, model === "auto" ? undefined : model)} />
        ) : (
          <div className="flex flex-col gap-4 p-6">
            {messages.map((msg, idx) => {
              const isLastAssistant =
                msg.role === "ASSISTANT" &&
                idx === messages.length - 1 &&
                isStreaming;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={isLastAssistant}
                />
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Suggestion chips when there are messages */}
      {hasMessages && !isLoading && (
        <div className="px-6 pb-2 flex-shrink-0">
          <SuggestionChips
            onSelect={(text) => onSend(text, model === "auto" ? undefined : model)}
          />
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 pt-2 flex-shrink-0 border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-end gap-2 bg-muted/40 border border-border rounded-xl px-3 py-2 focus-within:border-brand/50 focus-within:bg-background transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your sessions, transcripts, or interview data…"
            rows={1}
            maxLength={4000}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none min-h-[36px] max-h-[200px] overflow-y-auto leading-6 pt-1"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 200) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
            className={cn(
              "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200",
              inputValue.trim() && !isStreaming
                ? "bg-brand text-white hover:bg-brand/90 cursor-pointer"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 px-0.5">
          <p className="text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter for new line
          </p>
          {inputValue.length > 0 && (
            <span
              className={cn(
                "text-[10px] tabular-nums transition-colors",
                inputValue.length >= 3900
                  ? "text-destructive font-medium"
                  : inputValue.length >= 3500
                  ? "text-amber-500"
                  : "text-muted-foreground",
              )}
            >
              {inputValue.length}/4000
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
