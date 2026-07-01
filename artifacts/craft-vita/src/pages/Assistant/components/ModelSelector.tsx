import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cpu } from "lucide-react";

const MODELS = [
  { id: "auto", label: "Auto (Gemini 2.0 Flash)" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function ModelSelector({ value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-44 text-xs gap-1.5 border-border bg-muted/40">
        <Cpu className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
