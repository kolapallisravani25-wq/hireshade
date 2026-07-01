import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyBtnProps {
  text: string;
  className?: string;
}

export function CopyBtn({ text, className }: CopyBtnProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-md border transition-all",
        copied
          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
          : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
