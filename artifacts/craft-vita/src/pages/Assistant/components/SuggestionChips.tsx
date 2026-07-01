import { Sparkles, BarChart2, HelpCircle, Cpu, MessageSquare, TrendingUp } from "lucide-react";

const CHIPS = [
  { icon: Sparkles, label: "Summarize all sessions" },
  { icon: BarChart2, label: "Highest engagement sessions" },
  { icon: HelpCircle, label: "Common interview questions" },
  { icon: Cpu, label: "Technical topic patterns" },
  { icon: MessageSquare, label: "Analyze transcripts" },
  { icon: TrendingUp, label: "Question trends" },
];

interface Props {
  onSelect: (text: string) => void;
}

export function SuggestionChips({ onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {CHIPS.map(({ icon: Icon, label }) => (
        <button
          key={label}
          onClick={() => onSelect(label)}
          className="flex items-center gap-1.5 text-xs border border-border rounded-full px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-brand/50 hover:bg-brand/5 transition-all duration-200 cursor-pointer"
        >
          <Icon className="w-3.5 h-3.5 flex-shrink-0" />
          {label}
        </button>
      ))}
    </div>
  );
}
