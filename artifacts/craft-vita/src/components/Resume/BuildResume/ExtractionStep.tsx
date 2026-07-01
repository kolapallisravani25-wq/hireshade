 ;

import { Label } from "@/components/ui/label";
import {
  ResumeSelector,
  type Resume,
} from "@/components/Resume/ResumeSelector";
// import { Checkbox } from "@/components/ui/checkbox";

interface ExtractionStepProps {
  onSelectResume: (resume: Resume | null) => void;
  options: Record<string, boolean>;
  onChangeOption: (id: string, checked: boolean) => void;
  fields: { id: string; label: string }[];
}

export function ExtractionStep({ onSelectResume }: ExtractionStepProps) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-semibold text-foreground/90">
          Select Resume
        </Label>
        <ResumeSelector onSelect={onSelectResume} />
      </div>
      {/* <div className="space-y-4">
        <Label className="text-sm font-semibold text-foreground/90 p-2">
          Fields to Extract
        </Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {fields.map((field) => (
            <div key={field.id} className="flex items-center space-x-2 group">
              <Checkbox
                id={field.id}
                checked={options[field.id]}
                onCheckedChange={(checked) =>
                  onChangeOption(field.id, !!checked)
                }
              />
              <label
                htmlFor={field.id}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-muted-foreground group-hover:text-foreground transition-colors"
              >
                {field.label}
              </label>
            </div>
          ))}
        </div>
      </div> */}
    </div>
  );
}
