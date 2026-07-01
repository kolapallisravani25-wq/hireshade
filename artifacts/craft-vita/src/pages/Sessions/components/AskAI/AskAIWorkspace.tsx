 ;

import { useState, useEffect, useRef } from "react";
import {
  Send,
  Sparkles,
  Trash2,
  Loader2,
  Copy,
  Check,
  Code2,
  BarChart2,
  FileSearch,
  Lightbulb,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChatMessage } from "./types";
import { useAuth } from "@clerk/clerk-react";

interface AskAIWorkspaceProps {
  sessionId: string;
  internalUserId?: string;
  onNavigateToTimeline: (questionId: string) => void;
}

// ── Inline code block ───────────────────────────────────────────────────────
function DocCodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-zinc-200 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-50 border-b border-zinc-200">
        <div className="flex items-center gap-1.5">
          <Code2 className="w-3 h-3 text-zinc-400" />
          <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wide">
            {language || "code"}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language || "text"}
          style={oneLight}
          PreTag="div"
          customStyle={{ margin: 0, padding: "1rem", fontSize: "12px", lineHeight: "1.6", background: "#fafafa" }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// ── Document markdown components ─────────────────────────────────────────────
const DOC_COMPONENTS = {
  h1: ({ children }: any) => (
    <h1 className="text-[20px] font-bold text-zinc-900 mt-0 mb-3 leading-tight">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-[15px] font-bold text-zinc-800 mt-5 mb-2">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-[14px] font-semibold text-zinc-700 mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: any) => (
    <p className="text-[14px] leading-relaxed text-zinc-600 my-2">{children}</p>
  ),
  strong: ({ children }: any) => (
    <strong className="font-semibold text-zinc-800">{children}</strong>
  ),
  em: ({ children }: any) => <em className="italic text-zinc-600">{children}</em>,
  ul: ({ children }: any) => (
    <ul className="my-2 pl-5 space-y-1 list-disc marker:text-zinc-400">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="my-2 pl-5 space-y-1 list-decimal marker:text-zinc-500 marker:font-medium">{children}</ol>
  ),
  li: ({ children }: any) => (
    <li className="text-[14px] text-zinc-600 leading-relaxed pl-0.5">{children}</li>
  ),
  blockquote: ({ children }: any) => (
    <blockquote className="my-3 pl-4 border-l-2 border-zinc-300 text-[13px] italic text-zinc-500">
      {children}
    </blockquote>
  ),
  table: ({ children }: any) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-zinc-50 text-zinc-500 text-[11px] uppercase tracking-wide">{children}</thead>,
  tbody: ({ children }: any) => <tbody className="divide-y divide-zinc-100">{children}</tbody>,
  tr: ({ children }: any) => <tr className="hover:bg-zinc-50/50">{children}</tr>,
  th: ({ children }: any) => <th className="px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }: any) => <td className="px-3 py-2 text-zinc-600">{children}</td>,
  hr: () => <hr className="my-5 border-zinc-200" />,
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const value = String(children).replace(/\n$/, "");
    if (!inline && match) return <DocCodeBlock language={match[1]} value={value} />;
    return (
      <code className="text-[12px] font-mono bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded" {...props}>
        {children}
      </code>
    );
  },
  a: ({ href, children }: any) => (
    <span className="text-blue-600 underline decoration-blue-200 cursor-default" title={href}>{children}</span>
  ),
};

// ── Suggested prompts ────────────────────────────────────────────────────────
const SUGGESTED_PROMPTS = [
  { icon: BarChart2,  label: "Summarize weak answers" },
  { icon: FileSearch, label: "Extracted technologies?" },
  { icon: Lightbulb,  label: "Key areas to improve" },
  { icon: BookOpen,   label: "Next interview prep" },
];

// ── Main Component ────────────────────────────────────────────────────────────
export function AskAIWorkspace({ sessionId, internalUserId, onNavigateToTimeline }: AskAIWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { getToken, userId: clerkUserId } = useAuth();

  useEffect(() => { fetchHistory(); }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const fetchHistory = async () => {
    try {
      const token = await getToken();
      const uId = internalUserId || clerkUserId;
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/ask-ai/${sessionId}/history?userId=${uId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setMessages(data.data.map((m: any, idx: number) => ({
          ...m,
          id: m.id || `hist-${idx}`,
          timestamp: new Date().toISOString(),
        })));
      }
    } catch (err) {
      console.error("Failed to fetch chat history", err);
    }
  };

  const handleSend = async (queryText?: string) => {
    const text = queryText || input;
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setIsTyping(true);

    try {
      const token = await getToken();
      const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/ask-ai/${sessionId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: text, userId: internalUserId || clerkUserId }),
      });

      if (!response.ok) throw new Error("Failed to query AI");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";
      const assistantMsgId = (Date.now() + 1).toString();

      setMessages(prev => [...prev, {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
      }]);
      setIsTyping(false);

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantContent += data.content;
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId ? { ...m, content: assistantContent } : m
                ));
              }
            } catch { /* partial chunk */ }
          }
        }
      }

      fetchHistory();
    } catch (err) {
      console.error("Chat error:", err);
      setMessages(prev => [...prev, {
        id: "err-" + Date.now(),
        role: "assistant",
        content: "**Error:** Failed to connect to the AI service. Please try again.",
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm("Clear chat history?")) return;
    try {
      const token = await getToken();
      const uId = internalUserId || clerkUserId;
      await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/ask-ai/${sessionId}/history?userId=${uId}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
      );
      setMessages([]);
    } catch (err) {
      console.error("Failed to clear history", err);
    }
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Scrollable content ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-7 py-5 space-y-0">

        {/* Empty state */}
        {messages.length === 0 && !isTyping && (
          <div className="flex flex-col items-center justify-center h-full py-16 animate-in fade-in duration-400">
            <div className="size-10 rounded-xl bg-zinc-100 flex items-center justify-center mb-4">
              <Sparkles className="size-4.5 text-zinc-400" />
            </div>
            <p className="text-[13px] font-semibold text-zinc-700 mb-1">Ask anything about this session</p>
            <p className="text-[12px] text-zinc-400 mb-6 text-center max-w-[240px]">
              Weak points, tech stack, patterns, prep tips — all based on your transcript.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map(({ icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={() => handleSend(label)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-200 bg-white hover:bg-zinc-50 text-[12px] text-zinc-600 hover:text-zinc-900 transition-all"
                >
                  <Icon className="size-3 text-zinc-400" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => {
          const isUser = msg.role.toLowerCase() === "user";

          if (isUser) {
            return (
              <div key={msg.id} className={cn("pt-6", i === 0 && "pt-2")}>
                <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">You</p>
                <p className="text-[14px] text-zinc-700 font-medium leading-relaxed">{msg.content}</p>
                <div className="mt-4 border-t border-zinc-100" />
              </div>
            );
          }

          return (
            <div key={msg.id} className="group relative pt-4 pb-2">
              {/* Copy button — top right, visible on hover */}
              {msg.content && (
                <button
                  onClick={() => copyText(msg.id, msg.content)}
                  className={cn(
                    "absolute top-4 right-0 flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 transition-all",
                    copiedId === msg.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  {copiedId === msg.id
                    ? <><Check className="size-3 text-emerald-500" /> Copied</>
                    : <><Copy className="size-3" /> Copy</>
                  }
                </button>
              )}

              {/* Document content */}
              {msg.content ? (
                <div className="pr-16">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={DOC_COMPONENTS as any}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                /* Streaming: blinking cursor */
                <div className="flex items-center gap-2 py-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <span className="text-[12px] text-zinc-400">Thinking…</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator (before assistant message is added) */}
        {isTyping && (
          <div className="pt-4 flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <span className="text-[12px] text-zinc-400">Thinking…</span>
          </div>
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="flex-shrink-0 border-t border-zinc-100 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleSend(); }
            }}
            placeholder="Type your question here..."
            className="flex-1 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2.5 text-[13px] text-zinc-800 placeholder:text-zinc-400 outline-none focus:border-zinc-300 focus:bg-white transition-all"
          />
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="p-2.5 rounded-lg text-zinc-300 hover:text-red-400 hover:bg-red-50 transition-all"
              title="Clear history"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-[13px] font-semibold transition-all"
          >
            {isLoading
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Send className="size-3.5" />
            }
            Send
          </button>
        </div>
      </div>

    </div>
  );
}
