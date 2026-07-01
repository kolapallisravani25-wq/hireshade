import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isTauri } from "@/lib/utils";


interface CodeBlockProps {
  children: string;
  className?: string;
}

const CodeBlock = ({ children, className }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g., "language-js")
  const language = className ? className.replace(/language-/, "") : "code";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };

  return (
    <div className="relative group my-6 overflow-hidden rounded-xl border border-light-code-border bg-light-code-bg shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-light-code-header border-b border-light-code-border">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-brand" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">
            {language}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 px-2 text-slate-400 hover:text-brand transition-all hover:bg-white flex items-center gap-1.5 border border-transparent hover:border-light-code-border shadow-none hover:shadow-xs"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[10px] font-bold">COPIED!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                COPY
              </span>
            </>
          )}
        </Button>
      </div>
      <div className="p-4 overflow-x-hidden bg-white/50">
        <pre className="text-sm font-mono text-light-code-text leading-relaxed font-medium whitespace-pre-wrap wrap-break-word">
          <code>{children.trim()}</code>
        </pre>
      </div>
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function highlightWebOnlyTextNode(text: string): React.ReactNode {
  // Only highlight on web. Tauri should keep native styling.
  if (isTauri()) return text;

  const markers = [
    { raw: "QUESTION:", label: "QUESTION:" },
    { raw: "ANSWER:", label: "ANSWER:" },
    { raw: "Q:", label: "Q:" },
    { raw: "A:", label: "A:" },
  ];

  const upper = text.toUpperCase();
  if (!markers.some((m) => upper.includes(m.raw))) return text;

  // Highlight only exact marker tokens.
  const patterns = markers.map((m) => m.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${patterns.join("|")})`, "gi");

  const parts = text.split(re);
  if (parts.length <= 1) return text;

    return parts.map((part, idx) => {
    const isMarker = markers.some((m) => part.toUpperCase() === m.raw.toUpperCase());
    if (!isMarker) return <span key={idx}>{part}</span>;
    return (
      <span

        key={idx}
        className="px-1.5 py-0.5 rounded bg-brand-muted text-brand-active font-bold border border-brand-subtle"
      >
        {part}
      </span>
    );
  });
}


export const MarkdownRenderer = ({
  content,
  className = "",
}: MarkdownRendererProps) => {
  const isWeb = !isTauri();
  const enhancedClassName = isWeb
    ? `${className} web-generated-markdown`
    : className;

  return (
    <div className={`markdown-content ${enhancedClassName}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Highlight web-only markers inside text.
          // ReactMarkdown calls `text` for plain text nodes.
          text({ children }: any) {
            return typeof children === "string" ? highlightWebOnlyTextNode(children) : children;
          },
          // Use the custom CodeBlock for multi-line code

          code({ node, inline, className, children, ...props }: any) {
            return !inline ? (
              <CodeBlock className={className}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            ) : (
              <code
                className="bg-brand-muted text-brand-active px-1.5 py-0.5 rounded text-sm font-semibold border border-brand-subtle"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Custom heading styles
          h1: ({ children }) => (

            <h1 className="text-2xl font-bold mt-8 mb-4 text-gray-900 border-b border-gray-100 pb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-8 mb-4 text-gray-900 uppercase tracking-wide text-sm font-bold">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-lg mt-6 mb-3 text-gray-900 font-bold">
              {children}
            </h3>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc pl-6 my-4 space-y-2 text-gray-700">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 my-4 space-y-2 text-gray-700">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-base text-gray-700 font-medium">{children}</li>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p className="mb-4 text-gray-700 leading-relaxed text-base font-medium">
              {children}
            </p>
          ),
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-6 rounded-xl border border-gray-200 shadow-sm">
              <table className="w-full text-sm text-left">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-900 uppercase">
              {children}
            </thead>
          ),
          th: ({ children }) => <th className="px-6 py-3">{children}</th>,
          td: ({ children }) => (
            <td className="px-6 py-4 border-b border-gray-50">{children}</td>
          ),
          // Bold/Italic
          strong: ({ children }) => (
            <strong className="font-bold text-gray-900">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-gray-700 opacity-90">{children}</em>
          ),
          // Horizontal rules
          hr: () => <hr className="my-8 border-gray-100" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
