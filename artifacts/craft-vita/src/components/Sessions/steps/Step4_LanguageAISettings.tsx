import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Globe, Cpu, MoreHorizontal, Info, Sparkles } from "lucide-react";
import { ModelSelector } from "@/pages/Sessions/ActiveSession/components/ModelSelector";

interface Step4Props {
  data: {
    language: string;
    simpleLanguage: boolean;
    instructions: string;
    aiModel: string;
  };
  onChange: (field: string, value: any) => void;
}

const LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
];

const AI_MODELS = [
  {
    value: "Gemini 2.0 Flash",
    label: "Gemini 2.0 Flash",
    recommended: true,
    speed: "Fast",
  },
  {
    value: "Gemini 1.5 Flash",
    label: "Gemini 1.5 Flash",
    recommended: false,
    speed: "Fast",
  },
  {
    value: "anthropic/claude-sonnet-4.6",
    label: "Claude 4.6 Sonnet",
    recommended: false,
    speed: "Fast",
  },
];

export function Step4_LanguageAISettings({ data, onChange }: Step4Props) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Language & AI Settings
        </h2>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-end">
        {/* Language Selection */}
        <div className="flex-1 space-y-2.5 w-full">
          <div className="flex items-center gap-2 px-0.5">
            <Globe className="h-4 w-4 text-primary" />
            <Label htmlFor="language" className="text-sm font-bold">
              Language{" "}
              <Info className="h-3.5 w-3.5 text-muted-foreground inline-block cursor-help ml-1" />
            </Label>
          </div>
          <Select
            value={data.language}
            onValueChange={(v) => onChange("language", v)}
          >
            <SelectTrigger className="h-11 rounded-xl bg-background border-border/80 shadow-sm focus:ring-primary/10">
              <SelectValue placeholder="Select Language" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {LANGUAGES.map((lang) => (
                <SelectItem
                  key={lang.value}
                  value={lang.value}
                  className="py-2.5"
                >
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Simple Language Switch */}
        <div className="flex flex-col space-y-2.5 min-w-40">
          <div className="flex items-center gap-2 px-0.5">
            <Label className="text-sm font-bold whitespace-nowrap">
              Simple Language
            </Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent
                  className="max-w-50 text-xs p-2 rounded-lg"
                  side="top"
                >
                  If English is not your first language, you can use this option
                  to make sure the AI doesn't use complex words.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="h-11 flex items-center justify-start pl-1">
            <Switch
              checked={data.simpleLanguage}
              onCheckedChange={(v: boolean) => onChange("simpleLanguage", v)}
              className="data-[state=checked]:bg-black dark:data-[state=checked]:bg-white"
            />
          </div>
        </div>
      </div>

      {/* Instructions Textarea */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-0.5">
          <MoreHorizontal className="h-4 w-4 text-primary" />
          <Label htmlFor="instructions" className="text-sm font-bold">
            Extra Context/Instructions
          </Label>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
        </div>
        <Textarea
          id="instructions"
          placeholder="Be more technical, use a more casual tone, use JavaScript when generating code examples, etc."
          className="field-sizing-fixed h-32 min-h-32 max-h-32 overflow-y-auto rounded-xl bg-background border-border/80 p-4 text-[14px] leading-relaxed resize-none shadow-sm focus:ring-primary/10"
          value={data.instructions}
          onChange={(e) => onChange("instructions", e.target.value)}
        />
      </div>

      {/* AI Model Selection */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-0.5">
          <Cpu className="h-4 w-4 text-primary" />
          <Label htmlFor="aiModel" className="text-sm font-bold shadow-sm">
            AI Model
          </Label>
          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
        </div>
        <ModelSelector
          value={data.aiModel}
          onChange={(v) => onChange("aiModel", v)}
          isFullscreen={false}
          className="w-full h-10 bg-background border-border/80 text-foreground"
        />
        {/* <Select
          value={data.aiModel}
          onValueChange={(v: string) => onChange("aiModel", v)}
        >
          <SelectTrigger className="h-11 rounded-xl bg-background border-border/80 shadow-sm focus:ring-primary/10">
            <SelectValue placeholder="Select Model">
              {data.aiModel && (
                <div className="flex items-center gap-3">
                  <Sparkles className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <span className="font-medium">{data.aiModel}</span>
                  <Badge className="bg-black dark:bg-white text-white dark:text-black hover:bg-black px-2 py-0 h-5 text-[10px] uppercase font-bold">
                    Recommended
                  </Badge>
                  <span className="text-xs text-muted-foreground">Fast</span>
                </div>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {AI_MODELS.map((model) => (
              <SelectItem
                key={model.value}
                value={model.value}
                className="py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span>{model.label}</span>
                  {model.recommended && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 uppercase scale-90 origin-left border-black"
                    >
                      Recommended
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select> */}
      </div>
    </div>
  );
}
