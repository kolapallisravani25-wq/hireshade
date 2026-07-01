import React, { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { updateField, updateCustomField } from "@/store/resumeBuilderSlice";
import type { ResumeFields } from "@/store/resumeBuilderSlice";
import { ExperienceEditor } from "./EntryEditors";
import { EducationEditor } from "./EntryEditors";
import { ProjectsEditor } from "./EntryEditors";
import { LinkManager } from "./LinkManager";

const FieldInput = React.memo(function FieldInput({
  label, fieldKey, placeholder, multiline = false, rows = 3, fullRow = false,
}: {
  label:        string;
  fieldKey:     keyof ResumeFields;
  placeholder?: string;
  multiline?:   boolean;
  rows?:        number;
  fullRow?:     boolean;
}) {
  const dispatch = useDispatch<AppDispatch>();
  // Subscribe only to this field — not the whole fields object  (rerender-derive-state)
  const value    = useSelector((s: RootState) => s.resumeBuilder.fields[fieldKey]);
  const isLocked = useSelector((s: RootState) => !!s.resumeBuilder.lockedFields[fieldKey]);

  // Stable callback ref — doesn't re-create on re-renders  (advanced-event-handler-refs)
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      dispatch(updateField({ field: fieldKey, value: e.target.value }));
    },
    [dispatch, fieldKey],
  );

  return (
    <div className={cn("space-y-1.5", fullRow && "col-span-2")}>
      <div className="flex items-center gap-1.5">
        {isLocked && <Lock className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
        <Label className={cn(
          "text-sm font-medium tracking-tight",
          isLocked ? "text-slate-400" : "text-slate-700",
        )}>
          {label}
        </Label>
        {isLocked && (
          <span className="text-[10px] text-muted-foreground/50 bg-muted/60 px-1.5 py-0.5 rounded-md font-medium ml-1">
            locked
          </span>
        )}
      </div>
      {multiline ? (
        <Textarea
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={isLocked}
          rows={rows}
          className={cn(
            "resize-none text-sm leading-relaxed rounded-lg border-slate-200 bg-white",
            "focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900/8 focus-visible:ring-offset-0",
            "placeholder:text-slate-300",
            isLocked && "bg-slate-50/80 text-slate-400 cursor-not-allowed opacity-60",
          )}
        />
      ) : (
        <Input
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          disabled={isLocked}
          className={cn(
            "h-10 rounded-lg border-slate-200 bg-white text-sm",
            "focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900/8 focus-visible:ring-offset-0",
            "placeholder:text-slate-300",
            isLocked && "bg-slate-50/80 text-slate-400 cursor-not-allowed opacity-60",
          )}
        />
      )}
    </div>
  );
});

// ─── SectionEditorFields ──────────────────────────────────────────────────────

export function SectionEditorFields() {
  // Only read the active section — each FieldInput subscribes to its own field
  const activeSection = useSelector((s: RootState) => s.resumeBuilder.activeSection);

  switch (activeSection) {
    case "personalInfo":
      return (
        <div className="grid grid-cols-2 gap-4">
          <FieldInput label="Full Name"          fieldKey="name"  placeholder="Jane Smith"                   fullRow />
          <FieldInput label="Professional Title" fieldKey="role"  placeholder="Senior Software Engineer"     fullRow />
          <FieldInput label="Email"              fieldKey="email" placeholder="jane@example.com" />
          <FieldInput label="Phone"              fieldKey="phone" placeholder="+1 (555) 000-0000" />
          <FieldInput label="Location"           fieldKey="location" placeholder="San Francisco, CA" />
          <LinkManager />
        </div>
      );
    case "summary":
      return (
        <FieldInput
          label="Professional Summary" fieldKey="summary" multiline rows={7}
          placeholder="Write a compelling 2–4 sentence summary of your professional background, key skills, and what you bring to the role..."
        />
      );
    case "experience":
      return <ExperienceEditor />;
    case "skills":
      return (
        <div className="space-y-4">
          <FieldInput label="Languages"             fieldKey="skillsLanguages"  placeholder="Python, TypeScript, Go" />
          <FieldInput label="Frameworks & Libraries" fieldKey="skillsFrameworks" placeholder="React, Node.js, FastAPI, Django" />
          <FieldInput label="Databases"             fieldKey="skillsDatabases"  placeholder="PostgreSQL, MongoDB, Redis" />
          <FieldInput label="Tools & Platforms"     fieldKey="skillsTools"      placeholder="Docker, Kubernetes, AWS, CI/CD" />
        </div>
      );
    case "projects":
      return <ProjectsEditor />;
    case "education":
      return <EducationEditor />;
    case "certifications":
      return (
        <FieldInput
          label="Certifications" fieldKey="certifications" multiline rows={6}
          placeholder={"AWS Solutions Architect – Associate (2023)\nGoogle Cloud Professional Data Engineer (2022)"}
        />
      );
    case "publications":
      return (
        <FieldInput
          label="Publications" fieldKey="publications" multiline rows={6}
          placeholder={"Smith, J. et al. (2023). Title. Journal Name, Vol(Issue), pp.\nDOI: https://doi.org/..."}
        />
      );
    default:
      // Custom / detected section
      return <CustomSectionEditor sectionId={activeSection} />;
  }
}

// ─── CustomSectionEditor ──────────────────────────────────────────────────────

const CustomSectionEditor = React.memo(function CustomSectionEditor({ sectionId }: { sectionId: string }) {
  const dispatch  = useDispatch<AppDispatch>();
  const rawMap    = useSelector((s: RootState) => s.resumeBuilder.fields._customSections);
  const sectionLabel = useSelector((s: RootState) =>
    s.resumeBuilder.customSectionDefs.find((d) => d.id === sectionId)?.label ?? sectionId,
  );

  const value = (() => {
    try { return (JSON.parse(rawMap || "{}") as Record<string, string>)[sectionId] ?? ""; } catch { return ""; }
  })();

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium tracking-tight text-slate-700">{sectionLabel}</Label>
      <Textarea
        value={value}
        onChange={(e) => dispatch(updateCustomField({ id: sectionId, value: e.target.value }))}
        rows={8}
        placeholder={`Enter your ${sectionLabel} details here…`}
        className="resize-none text-sm leading-relaxed rounded-lg border-slate-200 bg-white focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900/8 focus-visible:ring-offset-0 placeholder:text-slate-300"
      />
    </div>
  );
});
