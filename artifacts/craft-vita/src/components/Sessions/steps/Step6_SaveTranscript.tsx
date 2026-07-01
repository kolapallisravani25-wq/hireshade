import { Switch } from "@/components/ui/switch";
import { Save, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step6Props {
  saveTranscript: boolean;
  questionBankContributionOptIn: boolean;
  onSaveTranscriptChange: (value: boolean) => void;
  onContributionChange: (value: boolean) => void;
}

export function Step6_SaveTranscript({
  saveTranscript,
  questionBankContributionOptIn,
  onSaveTranscriptChange,
  onContributionChange,
}: Step6Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Save Transcript</h2>
        <p className="text-sm text-muted-foreground">
          Automatically store a full record of your session for later review.
        </p>
      </div>

      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-8 transition-all duration-300",
          saveTranscript
            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
            : "border-border bg-muted/20",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm border border-border/50">
              <Save
                className={cn(
                  "h-6 w-6 transition-colors",
                  saveTranscript ? "text-primary" : "text-muted-foreground",
                )}
              />
            </div>

            <div className="space-y-1">
              <h3 className="font-bold text-lg">Never Forget a Detail</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                A complete text transcript of your interaction will be securely
                saved to your account. You can revisit it to improve your
                performance or prepare for follow-up rounds.
              </p>
            </div>

            {/* <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50 border border-border/40">
                <Clock className="h-4 w-4 text-primary/70" />
                <span className="text-[12px] font-medium text-foreground/80">Searchable History</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50 border border-border/40">
                <FileText className="h-4 w-4 text-primary/70" />
                <span className="text-[12px] font-medium text-foreground/80">PDF Export Available</span>
              </div>
            </div> */}
          </div>

          <Switch
            checked={saveTranscript}
            onCheckedChange={onSaveTranscriptChange}
            className="scale-125"
          />
        </div>
      </div>

      <div
        className={cn(
          "flex items-start justify-between gap-4 rounded-lg border p-5",
          saveTranscript ? "bg-background" : "bg-muted/30 opacity-60",
        )}
      >
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold">Contribute to Question Bank</h3>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Allow sanitized interview questions from this saved session to
              improve anonymous aggregate insights. Personal answers and raw
              transcript text are never published.
            </p>
          </div>
        </div>
        <Switch
          checked={saveTranscript && questionBankContributionOptIn}
          disabled={!saveTranscript}
          onCheckedChange={onContributionChange}
          aria-label="Contribute sanitized questions to Question Bank"
        />
      </div>
    </div>
  );
}
