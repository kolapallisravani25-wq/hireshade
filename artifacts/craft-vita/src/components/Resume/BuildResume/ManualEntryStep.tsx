 ;

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ManualEntryStepProps {
  data: {
    summary: string;
    jobDescription: string;
  };
  onChange: (field: string, value: string) => void;
}

export function ManualEntryStep({ data, onChange }: ManualEntryStepProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <Label
          htmlFor="summary"
          className="text-sm font-semibold text-foreground/90"
        >
          Professional Summary
        </Label>
        <div className="relative">
          <Textarea
            id="summary"
            placeholder="Tell us about yourself, your career goals, and what makes you unique..."
            className="h-32 overflow-y-auto rounded-xl bg-muted/10 border-border/60 focus:bg-background transition-all"
            style={{ fieldSizing: "fixed" } as any}
            value={data.summary}
            onChange={(e) => onChange("summary", e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-3">
        <Label
          htmlFor="jd"
          className="text-sm font-semibold text-foreground/90"
        >
          Job Description (Optional)
        </Label>
        <Textarea
          id="jd"
          placeholder="Paste the job description you're applying for. We'll use this to tailor your resume keywords."
          className="h-32 overflow-y-auto rounded-xl bg-muted/10 border-border/60 focus:bg-background transition-all"
          style={{ fieldSizing: "fixed" } as any}
          value={data.jobDescription}
          onChange={(e) => onChange("jobDescription", e.target.value)}
        />
      </div>
    </div>
  );
}
