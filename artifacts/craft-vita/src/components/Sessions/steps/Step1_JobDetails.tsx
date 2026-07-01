import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Briefcase, FileText, Info, AlertCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { CompanyCombobox } from "../CompanyCombobox";

interface Step1Props {
  data: {
    companyName: string;
    jobDescription: string;
    round?: string;
  };
  onChange: (field: string, value: any) => void;
}

export const JOB_DESCRIPTION_REGEX = /^.{2,}/im;

export const INTERVIEW_ROUNDS = [
  "Recruiter Screen",
  "L1 - Technical",
  "L2 - Technical",
  "L3 - Technical",
  "Hiring Manager",
  "HR Round",
  "Final Round",
  "Other",
];

export function Step1_JobDetails({ data, onChange }: Step1Props) {
  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          Job Information
        </h2>
        <p className="text-sm text-muted-foreground">
          Provide the job details.
        </p>
      </div>
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Briefcase className="h-4 w-4 text-primary" />
            <Label htmlFor="companyName" className="text-sm font-semibold">
              Company <span className="text-destructive">*</span>
            </Label>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </div>
          <CompanyCombobox
            value={data.companyName}
            onChange={(value) => onChange("companyName", value)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <Layers className="h-4 w-4 text-primary" />
            <Label htmlFor="round" className="text-sm font-semibold">
              Round{" "}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
          </div>
          <Select
            value={data.round || undefined}
            onValueChange={(value) => onChange("round", value)}
          >
            <SelectTrigger
              id="round"
              className="h-11 w-full rounded-xl bg-background border-border/80 font-medium text-sm"
            >
              <SelectValue placeholder="e.g. Recruiter Screen, L1, L2…" />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_ROUNDS.map((round) => (
                <SelectItem key={round} value={round}>
                  {round}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <Label htmlFor="jobDescription" className="text-sm font-semibold">
                Job Description <span className="text-muted-foreground font-normal">(Optional)</span>
              </Label>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </div>
            {data.jobDescription && (
              <div
                className={cn(
                  "text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all border",
                  JOB_DESCRIPTION_REGEX.test(data.jobDescription)
                    ? "bg-green-500/5 text-green-600 border-green-500/20"
                    : "bg-amber-500/5 text-amber-600 border-amber-500/20",
                )}
              >
                {data.jobDescription.length} characters
              </div>
            )}
          </div>
          <Textarea
            id="jobDescription"
            placeholder="Full Stack Developer, Data Science, or detailed description..."
            className={cn(
              "min-h-24 max-h-36 overflow-y-auto rounded-xl bg-background border-border/80 focus:ring-primary/20 transition-all p-4 resize-none font-medium text-sm leading-relaxed",
              data.jobDescription &&
                !JOB_DESCRIPTION_REGEX.test(data.jobDescription) &&
                "border-amber-500/50 focus:border-amber-500/50 focus:ring-amber-500/10",
            )}
            value={data.jobDescription}
            onChange={(e) => onChange("jobDescription", e.target.value)}
          />
          {data.jobDescription && !JOB_DESCRIPTION_REGEX.test(data.jobDescription) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10 animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-700 dark:text-amber-400 font-medium leading-normal">
                <span className="font-bold">Entry too short:</span> Please enter a valid job domain or description (at least 2 characters).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
