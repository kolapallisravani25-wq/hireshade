import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "../Transcript";
import { cn } from "@/lib/utils";
import { Copy, Check, MessageSquare, Star, Terminal, RefreshCw } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vscDarkPlus,
  prism,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { parseAnswerContent } from "@/hooks/useAIChat";

const CopyButton = ({
  text,
  label,
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof text === "string") {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex items-center justify-center p-1.5 rounded-md transition-all active:scale-95",
        "bg-white hover:bg-slate-50 text-slate-400 border border-slate-200 shadow-sm",
        className,
      )}
      title={label ? `Copy ${label}` : "Copy"}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
};

const CodeBlock = ({
  children,
  isFullscreen,
  language,
}: {
  children: any;
  isFullscreen: boolean;
  language?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text =
      children?.[0]?.props?.children || children?.props?.children || children;
    const finalContent = Array.isArray(text) ? text.join("") : text;

    if (typeof finalContent === "string") {
      navigator.clipboard.writeText(finalContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden max-w-full my-4 border",
        isFullscreen
          ? "bg-black/40 border-white/10"
          : "bg-slate-50/50 border-slate-200",
      )}
    >
      <div
        className={cn(
          "px-3 py-1.5 flex items-center justify-between border-b",
          isFullscreen
            ? "bg-white/5 border-white/10"
            : "bg-slate-100/50 border-slate-200",
        )}
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            {language || "code"}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-slate-200 rounded transition-colors"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-slate-400" />
          )}
        </button>
      </div>
      <div className="relative max-w-full overflow-x-auto overflow-y-auto text-[13px] leading-relaxed [scrollbar-gutter:stable]">{children}</div>
    </div>
  );
};

const MarkdownListItem = ({ children, ordered }: { children: React.ReactNode; ordered?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const textContent = Array.isArray(children)
    ? children.map((c) => (typeof c === "string" ? c : (c as any)?.props?.children || "")).join("")
    : String(children);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (ordered) {
    return (
      <li className="group/li relative -ml-8 pl-8 mb-4 last:mb-0">
        <div className="absolute left-0 top-0.5 opacity-0 group-hover/li:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-slate-100 rounded border border-slate-200 bg-white shadow-sm transition-all active:scale-95"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-slate-400" />}
          </button>
        </div>
        <div className="font-bold text-slate-900 leading-snug text-[15.5px]">{children}</div>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 group/bul mb-2 last:mb-0">
      <div className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
      <div className="flex-1 text-[14px] leading-relaxed text-slate-700">{children}</div>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover/bul:opacity-100 transition-opacity p-0.5 hover:bg-slate-100 rounded text-slate-400"
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
      </button>
    </li>
  );
};

export const ChatMessage = ({
  message,
  isStreaming,
  isFullscreen = false,
  onRegenerate,
  onInteract,
  regenerateDisabled = false,
}: ChatMessageProps) => {
  const isAI = message.sender !== "User";

  const enforceHierarchicalAnswerMarkdown = (answer: string): string => {
    const raw = (answer || "").trim();
    if (!raw) return raw;
    if (/^\s*[-*]\s+/m.test(raw) || /^\s*\d+\.\s+/m.test(raw)) return raw;
    if (/\*\*🔹/.test(raw) || /\n\s*\*\*[^*\n]+:\*\*/.test(raw)) return raw;

    const paragraphs = raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return raw;

    const splitSentences = (text: string): string[] =>
      (text.match(/[^.!?]+(?:[.!?](?=\s|$)|$)/g) || [])
        .map((s) => s.trim())
        .filter(Boolean);

    const first = paragraphs[0];
    const firstSentences = splitSentences(first);
    const summary = firstSentences[0] || first;
    const sections: string[] = [];
    const keyBullets: string[] = [];

    for (const s of firstSentences.slice(1)) {
      if (s.length > 2) keyBullets.push(`- ${s}`);
    }

    for (const paragraph of paragraphs.slice(1)) {
      const forMatch = paragraph.match(/^For\s+([^,:.\n]{3,60})\s*[:,]\s*([\s\S]*)$/i);
      const label = forMatch?.[1]?.trim();
      const body = (forMatch?.[2] || paragraph).trim();
      const sentences = splitSentences(body);
      if (sentences.length === 0) continue;

      if (label) {
        sections.push(`**🔹 ${label}:**`);
        for (const sentence of sentences) {
          if (sentence.length > 2) sections.push(`- ${sentence}`);
        }
        sections.push("");
      } else {
        for (const sentence of sentences) {
          if (sentence.length > 2) keyBullets.push(`- ${sentence}`);
        }
      }
    }

    if (keyBullets.length > 0) {
      sections.unshift("**🔹 Key Points:**", ...keyBullets, "");
    }
    return sections.length > 0 ? `${summary}\n\n${sections.join("\n").trim()}` : raw;
  };

  const sanitize = (raw: string): string => {
    if (!raw) return raw;
    let out = raw;
    out = out.replace(/\*{1,2}\s*$/g, "");
    out = out.replace(/^\s*\*{1,3}\s*$/gm, "");
    out = out.replace(/(\*\*(?:QUESTION|ANSWER):\*\*)\s*\*{1,3}\s*/gi, "$1 ");
    out = out.replace(/\s*\*{1,3}\s*$/gm, "");
    out = out
      .split("\n")
      .map((line) => {
        const count = (line.match(/\*\*/g) || []).length;
        if (count % 2 === 1) {
          const idx = line.lastIndexOf("**");
          return line.slice(0, idx) + line.slice(idx + 2);
        }
        return line;
      })
      .join("\n");
    if (out.includes("•")) {
      out = out
        .split(/\n{2,}/)
        .map((para) => {
          if (/^\s*[-*]\s/m.test(para)) return para;
          if (!para.includes("•")) return para;
          const parts = para.split(/\s*•\s+/);
          if (parts.length < 2) return para;
          const intro = parts[0].trim();
          const items = parts.slice(1).map((s) => `- ${s.trim()}`).join("\n");
          return intro ? `${intro}\n\n${items}` : items;
        })
        .join("\n\n");
    }
    out = out.replace(/^\s+/, "");
    return out;
  };

  // Remove the NEXT_QUESTION segment separator if somehow present in text
  const baseText = (message.text || "").replace(/\n?={3,}NEXT_QUESTION={3,}\n?/g, "\n");

  // Use the shared parseAnswerContent utility — the single source of truth
  // for parsing question/answer from raw AI text. This guarantees identical
  // rendering for initial answers, regenerated answers, and restored history.
  const { question: parsedQuestion, answer: parsedAnswer } = parseAnswerContent(
    baseText,
    message.question,
  );

  // Prefer the cleanly extracted question from the AI response (set by parseAnswerContent);
  // fall back to the message's stored question (set by handleAiAnswerSingle at card creation time).
  const displayQuestion =
    message.questionMeta?.displayQuestion ||
    parsedQuestion ||
    message.question?.trim();
  const questionMeta = message.questionMeta;

  // The answer is what parseAnswerContent returned — already stripped of labels.
  // Apply the markdown sanitizer to clean up stray asterisks / bullet chars.
  const displayAnswer = sanitize(
    isStreaming
      ? baseText
      : enforceHierarchicalAnswerMarkdown(parsedAnswer),
  );

  const markdownComponents = {
    p: ({ children }: any) => (
      <p className="mb-4 last:mb-0 leading-relaxed text-slate-700">{children}</p>
    ),
    ol: ({ children }: any) => (
      <ol className="mb-6 space-y-6 list-none">{children}</ol>
    ),
    ul: ({ children }: any) => (
      <ul className="mb-4 mt-2 space-y-2 list-none">{children}</ul>
    ),
    li: ({ children, ordered }: any) => (
      <MarkdownListItem ordered={ordered}>{children}</MarkdownListItem>
    ),
    strong: ({ children }: any) => (
      <strong className={cn(
        "font-bold",
        isFullscreen ? "text-white" : "text-slate-900"
      )}>
        {children}
      </strong>
    ),
    code(props: any) {
      const { children, className, node, ...rest } = props;
      const match = /language-(\w+)/.exec(className || "");

      if (!match) {
        return (
          <code
            className={cn(
              "px-1.5 py-0.5 rounded text-[13px] font-mono font-medium bg-slate-100 text-slate-800",
              isFullscreen && "bg-white/10 text-slate-200",
            )}
          >
            {children}
          </code>
        );
      }

      return (
        <CodeBlock isFullscreen={isFullscreen} language={match[1]}>
          <SyntaxHighlighter
            {...rest}
            PreTag="div"
            children={String(children).replace(/\n$/, "")}
            language={match[1]}
            style={isFullscreen ? vscDarkPlus : prism}
            customStyle={{
              margin: 0,
              background: "transparent",
              padding: "1.25rem",
              fontSize: "13px",
              lineHeight: "1.6",
              borderRadius: "0",
              overflowX: "auto",
              whiteSpace: "pre",
              wordBreak: "normal",
            }}
          />
        </CodeBlock>
      );
    },
  };

  if (!isAI) {
    return (
      <div className="mb-6 flex justify-end">
        <div className="bg-slate-100 rounded-2xl px-4 py-2 max-w-[80%] text-[14px] text-slate-700 shadow-sm border border-slate-200/50">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-8 animate-in fade-in slide-in-from-bottom-2"
      onClick={() => onInteract?.(message.id)}
      onFocusCapture={() => onInteract?.(message.id)}
      tabIndex={-1}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0">
          <Star className="h-4.5 w-4.5 fill-amber-400 text-amber-400" />
        </div>
        <div className={cn(
          "flex-1 min-w-0 rounded-xl border p-4 break-words [overflow-wrap:anywhere]",
          isFullscreen
            ? "border-white/10 bg-white/5"
            : "border-slate-200 bg-white"
        )}>
          {isStreaming ? (
            !baseText.trim() ? (
              <div className="flex items-center gap-2 text-slate-500 py-2">
                <div className="h-4 w-4 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
                <span className="text-sm">Generating answer...</span>
              </div>
            ) : (
              <div
                className={cn(
                  "text-[15px] leading-relaxed space-y-4",
                  isFullscreen ? "text-slate-100" : "text-slate-800",
                )}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {baseText}
                </ReactMarkdown>
                <span className="ml-1 inline-block h-4 w-1.5 bg-brand/60 animate-pulse rounded-full align-middle" />
              </div>
            )
          ) : (
            <>
              {/* Question Section */}
              {displayQuestion && (
                <>
                  <div className="group/ques relative flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <span className={cn(
                        "font-bold tracking-wide text-[15px]",
                        isFullscreen ? "text-white" : "text-slate-900"
                      )}>
                        QUESTION:
                      </span>
                      <span className={cn(
                        "ml-2 text-[15px] leading-relaxed font-medium",
                        isFullscreen ? "text-slate-100" : "text-slate-700"
                      )}>
                        {displayQuestion}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover/ques:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          onInteract?.(message.id);
                          navigator.clipboard.writeText(displayQuestion);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-all active:scale-95 bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        Copy Question
                      </button>
                    </div>
                  </div>

                  {questionMeta && (
                    <div
                      className={cn(
                        "mb-4 rounded-md border px-3 py-2 text-xs",
                        isFullscreen
                          ? "border-white/10 bg-white/5 text-slate-200"
                          : "border-slate-200 bg-slate-50 text-slate-600",
                      )}
                    >
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>Confidence: {Math.round(questionMeta.confidence * 100)}%</span>
                        <span>Source: {questionMeta.source.replace(/_/g, " ")}</span>
                        <span>Topic: {questionMeta.topic}</span>
                        <span>{questionMeta.isFollowUp ? "Follow-up" : "New question"}</span>
                      </div>
                      {questionMeta.corrections.length > 0 && (
                        <div className="mt-1">
                          Corrected:{" "}
                          {questionMeta.corrections
                            .slice(0, 3)
                            .map((correction) => `${correction.from} -> ${correction.to}`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  )}

                  <div className={cn(
                    "border-t my-4",
                    isFullscreen ? "border-white/10" : "border-slate-200"
                  )} />
                </>
              )}

              {/* Answer Section */}
              <div className="group/ans relative">
                <div className="flex items-start justify-between mb-3">
                  <span className={cn(
                    "font-bold tracking-wide text-[15px]",
                    isFullscreen ? "text-white" : "text-slate-900"
                  )}>
                    ANSWER:
                  </span>
                  <div className="flex items-center gap-2 opacity-0 group-hover/ans:opacity-100 transition-opacity">
                    {displayAnswer && (
                      <button
                        onClick={() => {
                          onInteract?.(message.id);
                          navigator.clipboard.writeText(displayAnswer);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-md transition-all active:scale-95 bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        Copy Answer
                      </button>
                    )}
	                    {onRegenerate && (
	                      <button
	                        onClick={onRegenerate}
	                        onMouseDown={() => onInteract?.(message.id)}
	                        disabled={regenerateDisabled}
	                        className={cn(
	                          "flex items-center justify-center p-1.5 rounded-md transition-all active:scale-95",
	                          isFullscreen
	                            ? "bg-white/10 hover:bg-white/20 text-white/60 border border-white/20"
	                            : "bg-white hover:bg-slate-50 text-slate-400 border border-slate-200 shadow-sm",
	                          regenerateDisabled && "cursor-not-allowed opacity-50 hover:bg-white"
	                        )}
	                        title={regenerateDisabled ? "Wait for the active answer to finish" : "Regenerate answer"}
	                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <CopyButton
                      text={displayQuestion && displayAnswer ? `QUESTION:\n${displayQuestion}\n\nANSWER:\n${displayAnswer}` : displayAnswer}
                      label="Copy All"
                    />
                  </div>
                </div>

                <div
                  className={cn(
                    "text-[15px] leading-relaxed space-y-4",
                    isFullscreen ? "text-slate-100" : "text-slate-800",
                  )}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {displayAnswer}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface ChatMessageProps {
  message: Message;
  isStreaming: boolean;
  isFullscreen?: boolean;
  onRegenerate?: () => void;
  onInteract?: (messageId: string) => void;
  regenerateDisabled?: boolean;
}
