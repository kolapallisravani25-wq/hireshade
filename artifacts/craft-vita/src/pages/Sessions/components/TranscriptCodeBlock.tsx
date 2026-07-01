import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

export default function TranscriptCodeBlock({
  className,
  code,
}: {
  className?: string;
  code: string;
}) {
  const language = className?.replace("language-", "") || "text";
  return (
    <SyntaxHighlighter
      style={oneDark}
      language={language}
      PreTag="div"
      customStyle={{
        margin: "0.75rem 0",
        borderRadius: "0.375rem",
        padding: "1rem",
        fontSize: "12px",
        lineHeight: "1.6",
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
}

