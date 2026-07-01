
import * as React from "react"
import { Copy, Check, Download, RotateCcw, PenLine } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface GeneratedLetterProps {
  content?: string;
  onRetry?: () => void;
  onCopy?: () => void;
  onExport?: () => void;
  className?: string;
  loading?: boolean;
}

export function GeneratedLetter({
  content,
  onRetry,
  onCopy,
  onExport,
  className,
  loading = false,
}: GeneratedLetterProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (onCopy) {
      onCopy();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card className={cn("w-full h-full shadow-none border-border/50", className)}>
      <CardHeader className="py-3 px-6 border-b border-border/40 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold text-foreground/90">
            Generated Letter
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="xs"
            onClick={handleCopy}
            disabled={!content || loading}
            className={cn(
              "h-8 rounded-lg border-border/40 transition-all",
              copied ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400" : "hover:bg-muted/30"
            )}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={onExport}
            disabled={!content || loading}
            className="h-8 rounded-lg border-border/40 hover:bg-muted/30"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={onRetry}
            disabled={loading}
            className="h-8 rounded-lg border-border/40 hover:bg-muted/30"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-8">
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4"></div>
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-5/6"></div>
            <div className="h-4 bg-muted rounded w-2/3"></div>
            <div className="h-4 bg-muted rounded w-full"></div>
            <div className="h-4 bg-muted rounded w-3/4"></div>
          </div>
        ) : content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
            <div className="p-4 rounded-full bg-muted/30">
              <PenLine className="h-8 w-8 text-muted-foreground/40" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground/60">No letter generated yet</p>
              <p className="text-xs text-muted-foreground/50 max-w-[200px]">
                Fill in the details on the left and click generate to see your cover letter here.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
