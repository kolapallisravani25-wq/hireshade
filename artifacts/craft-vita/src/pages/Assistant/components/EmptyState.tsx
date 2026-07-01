import { Bot } from "lucide-react";
import { SuggestionChips } from "./SuggestionChips";

interface Props {
  onSuggestion: (text: string) => void;
}

export function EmptyState({ onSuggestion }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-brand/10 flex items-center justify-center">
          <Bot className="w-8 h-8 text-brand" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">HireShade Assistant</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs">
            Ask anything about your sessions, transcripts, analytics, or interview patterns.
          </p>
        </div>
      </div>
      <SuggestionChips onSelect={onSuggestion} />
    </div>
  );
}
