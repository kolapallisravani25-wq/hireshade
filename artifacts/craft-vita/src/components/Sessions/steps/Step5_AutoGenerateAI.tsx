import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

interface Step5Props {
  autoGenerate: boolean;
  onChange: (v: boolean) => void;
}

export function Step5_AutoGenerateAI({ autoGenerate, onChange }: Step5Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Auto-Generate AI Response</h2>
        <p className="text-sm text-muted-foreground">
          Let the AI automatically suggest answers and follow-ups during your
          session.
        </p>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-8 transition-all duration-300",
          autoGenerate
            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
            : "border-border bg-muted/20",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm border border-border/50">
              <Sparkles
                className={cn(
                  "h-6 w-6 transition-colors",
                  autoGenerate
                    ? "text-primary fill-primary/10"
                    : "text-muted-foreground",
                )}
              />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg">Instant AI Suggestions</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                When enabled, HireShade will process the interview audio or
                text in real-time and provide you with high-quality, tailored
                responses based on your resume and the job description.
              </p>
            </div>

            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                Real-time answer suggestions
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                Context-aware follow-up questions
              </li>
              <li className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                Tone and sentiment analysis
              </li>
            </ul>
          </div>

          <Switch
            checked={autoGenerate}
            onCheckedChange={onChange}
            className="scale-125"
          />
        </div>
      </div>

      {/* <div className="p-4 rounded-xl border border-yellow-100 bg-yellow-50/30 text-yellow-800 text-[12px] flex gap-3">
        <MessageSquare className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          <strong>Pro Tip:</strong> This feature works best when your microphone
          is clear and the interviewer's voice is audible. You can always toggle
          this during the session.
        </p>
      </div> */}
    </div>
  );
}
