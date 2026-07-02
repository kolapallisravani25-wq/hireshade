import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const AI_MODELS = [
  { id: "anthropic/claude-haiku-4-5",          name: "Claude Haiku 4.5",      badge: "fast"      },
  { id: "anthropic/claude-sonnet-4-5",          name: "Claude Sonnet 4.5",     badge: "reasoning" },
  { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite", badge: undefined   },
  { id: "openai/gpt-5",                          name: "GPT-5",                 badge: undefined   },
];

const DEFAULT_MODEL = AI_MODELS[0].id;

/**
 * Validates if a model ID is in the available models list
 */
export function isValidModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  return AI_MODELS.some((m) => m.id === modelId);
}

/**
 * Returns a valid model ID, falling back to default if invalid
 */
export function getValidModel(modelId: string | null | undefined): string {
  if (isValidModel(modelId)) return modelId!;
  return DEFAULT_MODEL;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  isFullscreen?: boolean;
  className?: string;
}

export function ModelSelector({
  value,
  onChange,
  isFullscreen,
  className,
}: ModelSelectorProps) {
  // Ensure value is always valid, fallback to default if not
  const validValue = getValidModel(value);
  const selected = AI_MODELS.find((m) => m.id === validValue);

  // Sync with parent if value was invalid
  const handleChange = (newValue: string) => {
    onChange(newValue);
  };

  return (
    <Select value={validValue} onValueChange={handleChange}>
      {/* Custom trigger — renders name + badge inline so SelectValue never
          clips the badge. Width is sized to fit the longest option. */}
      <SelectTrigger
        className={cn(
          "border font-medium text-sm transition-all focus:ring-0 focus:ring-offset-0",
          isFullscreen
            ? "h-9 rounded-xl bg-white/10 border-white/20 text-white hover:bg-white/20"
            : "h-11 rounded-xl bg-background border-border/80 text-foreground shadow-sm hover:border-primary/40 hover:bg-muted/30 focus:border-primary/60",
          className || (isFullscreen ? "w-[215px]" : "w-full"),
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          {!isFullscreen && selected && (
            <span className={cn(
              "shrink-0 w-2 h-2 rounded-full",
              selected.badge === "fast"      && "bg-emerald-500",
              selected.badge === "reasoning" && "bg-violet-500",
              !selected.badge                && "bg-blue-500",
            )} />
          )}
          <span className="truncate font-medium">{selected?.name ?? "Select model"}</span>
          {selected?.badge && (
            <span
              className={cn(
                "shrink-0 font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                isFullscreen
                  ? cn(
                      "text-[9px]",
                      selected.badge === "fast"      && "bg-emerald-500/20 text-emerald-400",
                      selected.badge === "reasoning" && "bg-violet-500/20 text-violet-400",
                      selected.badge !== "fast" && selected.badge !== "reasoning" && "bg-white/10 text-white/50",
                    )
                  : cn(
                      "text-[10px]",
                      selected.badge === "fast"      && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
                      selected.badge === "reasoning" && "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
                      selected.badge !== "fast" && selected.badge !== "reasoning" && "bg-muted text-muted-foreground",
                    ),
              )}
            >
              {selected.badge}
            </span>
          )}
        </span>
      </SelectTrigger>

      {/* ── Tauri dark popup (isFullscreen) ────────────────────────────── */}
      {isFullscreen ? (
        <SelectContent
          side="bottom"
          align="center"
          sideOffset={6}
          position="popper"
          className="rounded-xl border border-white/15 bg-zinc-900 text-white shadow-2xl shadow-black/40 min-w-[215px] z-[9999]"
          container={
            (typeof document !== "undefined"
              ? (document.getElementById("floating-portal-root") ?? document.body)
              : undefined) as HTMLElement | undefined
          }
        >
          {AI_MODELS.map((model) => (
            <SelectItem
              key={model.id}
              value={model.id}
              className={cn(
                "rounded-lg cursor-pointer text-white/80",
                "data-[highlighted]:bg-white/10 data-[highlighted]:text-white",
                "focus:bg-white/10 focus:text-white",
                "data-[state=checked]:text-white data-[state=checked]:bg-white/5",
              )}
            >
              <span className="flex items-center gap-2">
                {model.name}
                {model.badge && (
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                    model.badge === "fast"      && "bg-emerald-500/20 text-emerald-400",
                    model.badge === "reasoning" && "bg-violet-500/20 text-violet-400",
                    model.badge !== "fast" && model.badge !== "reasoning" && "bg-white/10 text-white/50",
                  )}>
                    {model.badge}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      ) : (
        /* ── Web light popup (dashboard / dialog) ───────────────────────── */
        <SelectContent
          side="bottom"
          align="start"
          sideOffset={6}
          position="popper"
          className="rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-lg min-w-[280px] p-1.5"
        >
          {AI_MODELS.map((model) => (
            <SelectItem
              key={model.id}
              value={model.id}
              className={cn(
                "rounded-lg cursor-pointer py-2.5 px-3 text-sm",
                "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
                "focus:bg-muted focus:text-foreground",
                "data-[state=checked]:bg-primary/8 data-[state=checked]:text-foreground",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span className={cn(
                  "shrink-0 w-2 h-2 rounded-full",
                  model.badge === "fast"      && "bg-emerald-500",
                  model.badge === "reasoning" && "bg-violet-500",
                  !model.badge               && "bg-blue-500",
                )} />
                <span className="font-medium">{model.name}</span>
                {model.badge && (
                  <span className={cn(
                    "ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                    model.badge === "fast"      && "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
                    model.badge === "reasoning" && "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-400",
                  )}>
                    {model.badge}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      )}
    </Select>
  );
}
