import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Bot, User, Copy, Check, Code2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";  
import { AssistantMessage } from "../hooks/useAssistant";

// ── Code block component with syntax highlighting + copy ────────────────────
function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-border bg-[#1e1e2e] text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-border">
        <div className="flex items-center gap-1.5">
          <Code2 className="w-3 h-3 text-brand" />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {language || "code"}
          </span>
        </div>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted/30"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language || "text"}
          style={oneDark}
          customStyle={{
            margin: 0,
            padding: "1rem",
            background: "transparent",
            fontSize: "0.78rem",
            lineHeight: "1.6",
          }}
          wrapLongLines={false}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// ── Citation badge ───────────────────────────────────────────────────────────
function CitationBadge({
  question,
  sessionId,
  companyName,
}: {
  question?: string;
  sessionId?: string;
  companyName?: string | null;
}) {
  const company = companyName?.trim();
  let prefix: string;
  let name: string;

  if (sessionId && company) {
    prefix = "session";
    name = company;
  } else if (question && company) {
    prefix = "question";
    name = company;
  } else if (sessionId) {
    prefix = "session";
    name = sessionId.slice(0, 6);
  } else {
    prefix = "transcript";
    name = "chunk";
  }

  const label = `${prefix}-${name}`;
  const tooltip = question ? `${question.slice(0, 120)}${question.length > 120 ? "…" : ""}` : label;

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] bg-muted/60 border border-border rounded-full px-2 py-0.5 text-muted-foreground hover:bg-muted transition-colors cursor-default font-mono"
      title={tooltip}
    >
      <MessageSquare className="w-2.5 h-2.5 flex-shrink-0 text-brand" />
      {label}
    </span>
  );
}

// ── ReactMarkdown component map ──────────────────────────────────────────────
const markdownComponents = {
  // Code: fenced code blocks → CodeBlock, inline code → styled span
  code({ node, className, children, ...props }: any) {
    const isInline = !className;
    const lang = (className ?? "").replace("language-", "");
    const value = String(children).replace(/\n$/, "");
    if (!isInline && (className || value.includes("\n"))) {
      return <CodeBlock language={lang} value={value} />;
    }
    return (
      <code
        className="px-1.5 py-0.5 rounded bg-muted text-brand text-[0.8em] font-mono border border-border/60"
        {...props}
      >
        {children}
      </code>
    );
  },
  // Headings
  h1: ({ children }: any) => (
    <h1 className="text-lg font-bold text-foreground mt-5 mb-2 pb-1.5 border-b border-border first:mt-0">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-semibold text-foreground mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  // Paragraph
  p: ({ children }: any) => (
    <p className="text-sm text-foreground leading-7 my-2 first:mt-0 last:mb-0">{children}</p>
  ),
  // Lists
  ul: ({ children }: any) => (
    <ul className="my-2 ml-4 space-y-1 list-disc [&>li]:text-sm [&>li]:text-foreground [&>li]:leading-6">{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol className="my-2 ml-4 space-y-1 list-decimal [&>li]:text-sm [&>li]:text-foreground [&>li]:leading-6">{children}</ol>
  ),
  li: ({ children }: any) => <li className="pl-1">{children}</li>,
  // Blockquote
  blockquote: ({ children }: any) => (
    <blockquote className="my-3 pl-3 border-l-2 border-brand/60 bg-brand/5 rounded-r-lg py-2 pr-3 text-sm text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  // Table
  table: ({ children }: any) => (
    <div className="my-3 w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }: any) => <tbody className="divide-y divide-border">{children}</tbody>,
  tr: ({ children }: any) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
  th: ({ children }: any) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-foreground whitespace-nowrap">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="px-3 py-2 text-xs text-foreground">{children}</td>
  ),
  // Horizontal rule
  hr: () => <hr className="my-4 border-border" />,
  // Strong / em
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-muted-foreground">{children}</em>,
  // Links — open in system browser, not inline nav
  a: ({ href, children }: any) => (
    <span
      className="text-brand underline underline-offset-2 cursor-default"
      title={href}
    >
      {children}
    </span>
  ),
};

// ── Main component ───────────────────────────────────────────────────────────
interface Props {
  message: AssistantMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "USER";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("flex gap-3 group w-full", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 ring-2",
          isUser
            ? "bg-brand text-white ring-brand/20"
            : "bg-gradient-to-br from-brand/20 to-purple-500/20 text-brand ring-brand/10",
        )}
      >
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "flex flex-col gap-2 min-w-0",
          isUser ? "items-end max-w-[75%]" : "items-start max-w-[88%] flex-1",
        )}
      >
        <div
          className={cn(
            "rounded-2xl text-sm",
            isUser
              ? "bg-brand text-white px-4 py-2.5 rounded-tr-sm"
              : "bg-card border border-border text-foreground px-5 py-4 rounded-tl-sm shadow-sm",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words leading-7">{message.content}</p>
          ) : (
            <div className="min-w-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.content ?? ""}
              </ReactMarkdown>

              {/* Streaming indicators */}
              {isStreaming && !message.content && (
                <span className="inline-flex gap-1 items-center text-muted-foreground py-1">
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              )}
              {isStreaming && message.content && (
                <span className="inline-block w-0.5 h-[1em] bg-brand animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Actions row — copy button */}
        {!isUser && message.content && !isStreaming && (
          <div className="flex items-center gap-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
            >
              {copied
                ? <><Check className="w-3 h-3 text-green-500" /> Copied!</>
                : <><Copy className="w-3 h-3" /> Copy response</>}
            </button>
          </div>
        )}

        {/* Citation badges */}
        {!isUser && message.citations && message.citations.length > 0 && !isStreaming && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-0.5">
            {message.citations.slice(0, 5).map((c, i) => (
              <CitationBadge key={c.id ?? i} question={c.question} sessionId={c.sessionId} companyName={c.companyName} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
