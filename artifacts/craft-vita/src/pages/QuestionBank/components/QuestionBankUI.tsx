import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DifficultyMix, QuestionBankDifficulty } from "../types";

export function formatQuestionBankValue(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatDate(value: string | undefined): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const DIFFICULTY_STYLES: Record<QuestionBankDifficulty, string> = {
  easy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  hard: "border-rose-200 bg-rose-50 text-rose-700",
  expert: "border-violet-200 bg-violet-50 text-violet-700",
};

export function DifficultyBadge({
  difficulty,
}: {
  difficulty: QuestionBankDifficulty;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-semibold", DIFFICULTY_STYLES[difficulty])}
    >
      {formatQuestionBankValue(difficulty)}
    </Badge>
  );
}

export function TagList({
  values,
  limit,
}: {
  values: string[];
  limit: number;
}) {
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {visible.map((value) => (
        <Badge key={value} variant="secondary" className="max-w-36 truncate">
          {value}
        </Badge>
      ))}
      {remaining > 0 ? (
        <Badge variant="outline">+{remaining}</Badge>
      ) : null}
      {values.length === 0 ? (
        <span className="text-muted-foreground">None</span>
      ) : null}
    </div>
  );
}

export function DifficultyMixBar({ mix }: { mix: DifficultyMix }) {
  const entries = Object.entries(mix) as Array<
    [QuestionBankDifficulty, number]
  >;

  return (
    <div className="min-w-44 space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-sm bg-muted">
        {entries.map(([difficulty, value]) =>
          value > 0 ? (
            <div
              key={difficulty}
              className={cn(
                difficulty === "easy" && "bg-emerald-500",
                difficulty === "medium" && "bg-amber-500",
                difficulty === "hard" && "bg-rose-500",
                difficulty === "expert" && "bg-violet-500",
              )}
              style={{ width: `${value}%` }}
              title={`${formatQuestionBankValue(difficulty)}: ${value}%`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
        {entries.map(([difficulty, value]) => (
          <span key={difficulty}>
            {difficulty.charAt(0).toUpperCase()}: {value}%
          </span>
        ))}
      </div>
    </div>
  );
}

