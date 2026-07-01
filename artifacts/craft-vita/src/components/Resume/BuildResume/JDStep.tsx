 ;

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Briefcase, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface JDStepData {
  jobDescription: string;
  jobTitle: string;
  company: string;
}

interface JDStepProps {
  data: JDStepData;
  onChange: (data: JDStepData) => void;
}

const MAX_JD_CHARS = 4000;

export function JDStep({ data, onChange }: JDStepProps) {
  const [mode, setMode] = React.useState<"jd" | "simple">(
    data.jobDescription ? "jd" : "simple",
  );
  const charCount = data.jobDescription.length;
  const hasJD = charCount > 0;

  const update = (patch: Partial<JDStepData>) =>
    onChange({ ...data, ...patch });

  return (
    <div className="space-y-5 py-2">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit">
        <button
          onClick={() => setMode("jd")}
          className={cn(
            "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all",
            mode === "jd"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Paste Job Description
        </button>
        <button
          onClick={() => setMode("simple")}
          className={cn(
            "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all",
            mode === "simple"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Quick Fill
        </button>
      </div>

      {mode === "jd" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold text-foreground/90">
              Job Description
            </Label>
            <div className="flex items-center gap-2">
              {hasJD && (
                <Badge
                  variant="secondary"
                  className="gap-1 text-[10px] px-2 py-0.5 bg-violet-100 text-violet-700 border-violet-200"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  AI Tailoring Ready
                </Badge>
              )}
              <span
                className={cn(
                  "text-[11px] font-medium tabular-nums",
                  charCount > MAX_JD_CHARS * 0.9
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {charCount}/{MAX_JD_CHARS}
              </span>
            </div>
          </div>
          <Textarea
            value={data.jobDescription}
            onChange={(e) =>
              update({ jobDescription: e.target.value.slice(0, MAX_JD_CHARS) })
            }
            placeholder="Paste the full job description here. We'll analyse keywords and pre-fill the JD Tailor tab in the editor for you…"
            className="min-h-[180px] max-h-[320px] resize-none rounded-xl border-border/60 text-sm leading-relaxed focus-visible:border-primary focus-visible:ring-primary/20 overflow-y-auto"
          />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The JD is stored locally and pre-fills the{" "}
            <span className="font-semibold">JD Tailor</span> tab in the editor.
            No extra credits are charged at this stage.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-foreground/90 flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              Job Title
            </Label>
            <Input
              value={data.jobTitle}
              onChange={(e) => update({ jobTitle: e.target.value })}
              placeholder="e.g. Senior Software Engineer"
              className="rounded-xl border-border/60 h-11 focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-foreground/90 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              Company
              <span className="text-[10px] font-medium text-muted-foreground/60 ml-1">
                optional
              </span>
            </Label>
            <Input
              value={data.company}
              onChange={(e) => update({ company: e.target.value })}
              placeholder="e.g. Stripe"
              className="rounded-xl border-border/60 h-11 focus-visible:border-primary focus-visible:ring-primary/20"
            />
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your resume title will be set to{" "}
            <span className="font-semibold">
              {data.jobTitle
                ? `"${data.jobTitle}${data.company ? ` – ${data.company}` : ""}"`
                : '"My Resume"'}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
