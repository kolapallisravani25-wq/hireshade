import { lazy, memo, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const LazyTranscriptCodeBlock = lazy(
  () => import("./TranscriptCodeBlock"),
);

export const TranscriptAnswerMarkdown = memo(function TranscriptAnswerMarkdown({
  answer,
}: {
  answer: string;
}) {
  return (
    <div className="prose prose-slate max-w-none text-[15px] leading-7 text-slate-900">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 text-[15px] leading-7">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-[15px] leading-7">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-slate-950">{children}</strong>
          ),
          code({ inline, className, children, ...props }: any) {
            if (!inline) {
              return (
                <Suspense
                  fallback={
                    <pre className="my-3 overflow-x-auto rounded-md bg-zinc-950 p-4 text-xs text-zinc-100">
                      {String(children)}
                    </pre>
                  }
                >
                  <LazyTranscriptCodeBlock
                    className={className}
                    code={String(children).replace(/\n$/, "")}
                  />
                </Suspense>
              );
            }
            return (
              <code
                className="rounded bg-slate-100 px-1 py-0.5 text-[13px] text-slate-800"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {answer}
      </ReactMarkdown>
    </div>
  );
});
