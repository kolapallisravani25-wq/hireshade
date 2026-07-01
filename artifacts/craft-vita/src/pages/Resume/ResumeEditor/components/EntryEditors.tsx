import React, { useEffect, useState, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { RootState, AppDispatch } from "@/store/store";
import { updateField } from "@/store/resumeBuilderSlice";
import { ChevronDown, ChevronUp, X, Plus } from "lucide-react";
import {
  ExperienceEntry, EducationEntry, ProjectEntry,
  parseExperienceEntries, serialiseExperienceEntries, blankExperience,
  parseEducationEntries, serialiseEducationEntries, blankEducation,
  parseProjectEntries, serialiseProjectEntries, blankProject,
} from "../types";

// ─── EntryCard ────────────────────────────────────────────────────────────────
export function EntryCard({
  index, total, label, onMoveUp, onMoveDown, onRemove, defaultOpen = true, children,
}: {
  index: number; total: number; label: string;
  onMoveUp: () => void; onMoveDown: () => void; onRemove: () => void;
  defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 text-left text-sm font-semibold text-foreground min-w-0"
        >
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", !open && "-rotate-90")} />
          <span className="truncate">{label || `Entry ${index + 1}`}</span>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" disabled={index === 0} onClick={onMoveUp} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-25 text-muted-foreground" title="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={onMoveDown} className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted disabled:opacity-25 text-muted-foreground" title="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {total > 1 && (
            <button type="button" onClick={onRemove} className="h-6 w-6 rounded flex items-center justify-center hover:bg-red-50 text-red-400" title="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
}

// ── ExperienceEditor ──────────────────────────────────────────────────────────


// ─── ExperienceEditor ─────────────────────────────────────────────────────────
export const ExperienceEditor = React.memo(function ExperienceEditor() {
  const dispatch = useDispatch<AppDispatch>();
  const raw      = useSelector((s: RootState) => s.resumeBuilder.fields.experience);

  const [entries, setEntries] = useState<ExperienceEntry[]>(() => parseExperienceEntries(raw));

  // Sync inward when Redux changes from outside (e.g. AI enhance / tailor)
  const rawRef     = useRef(raw);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (raw !== rawRef.current) {
      rawRef.current = raw;
      setEntries(parseExperienceEntries(raw));
    }
  }, [raw]);

  const commit = useCallback((next: ExperienceEntry[]) => {
    const serialised = serialiseExperienceEntries(next);
    rawRef.current   = serialised;
    dispatch(updateField({ field: "experience", value: serialised }));
  }, [dispatch]);

  // Compute next state from ref so dispatch never runs inside a setState updater
  // (rerender-move-effect-to-event)
  const updateEntry = useCallback(<K extends keyof ExperienceEntry>(
    id: string, key: K, value: ExperienceEntry[K],
  ) => {
    const next = entriesRef.current.map((e) => e._id === id ? { ...e, [key]: value } : e);
    setEntries(next);
    commit(next);
  }, [commit]);

  const moveUp   = useCallback((idx: number) => { const n=[...entriesRef.current]; [n[idx-1],n[idx]]=[n[idx],n[idx-1]]; setEntries(n); commit(n); }, [commit]);
  const moveDown = useCallback((idx: number) => { const n=[...entriesRef.current]; [n[idx],n[idx+1]]=[n[idx+1],n[idx]]; setEntries(n); commit(n); }, [commit]);
  const remove   = useCallback((id: string)  => { const n=entriesRef.current.filter((e)=>e._id!==id); setEntries(n); commit(n); }, [commit]);
  const addNew   = useCallback(() => { const n=[...entriesRef.current, blankExperience()]; setEntries(n); commit(n); }, [commit]);

  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => (
        <EntryCard
          key={entry._id}
          index={idx} total={entries.length}
          label={[entry.company, entry.title].filter(Boolean).join(" — ")}
          onMoveUp={() => moveUp(idx)} onMoveDown={() => moveDown(idx)} onRemove={() => remove(entry._id)}
          defaultOpen={idx === 0}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Company</Label>
              <Input value={entry.company} onChange={(e) => updateEntry(entry._id, "company", e.target.value)} placeholder="WebSenor Inc." className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Job Title</Label>
              <Input value={entry.title} onChange={(e) => updateEntry(entry._id, "title", e.target.value)} placeholder="Senior Engineer" className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs font-semibold text-muted-foreground">Dates</Label>
              <Input value={entry.dates} onChange={(e) => updateEntry(entry._id, "dates", e.target.value)} placeholder="Jan 2022 – Present" className="h-9 text-sm rounded-lg" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground">Bullet Points (one per line)</Label>
            <Textarea
              value={entry.bullets}
              onChange={(e) => updateEntry(entry._id, "bullets", e.target.value)}
              placeholder={"Achieved X by doing Y, resulting in Z\nLed initiative that reduced costs by N%"}
              rows={4}
              className="resize-none text-sm rounded-lg border-border bg-background placeholder:text-muted-foreground/40 leading-relaxed"
            />
          </div>
        </EntryCard>
      ))}
      <button
        type="button" onClick={addNew}
          className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-slate-200 text-[13px] text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-colors duration-150"
      >
        <Plus className="h-3.5 w-3.5" /> Add Experience
      </button>
    </div>
  );
});

// ── EducationEditor ───────────────────────────────────────────────────────────


// ─── EducationEditor ──────────────────────────────────────────────────────────
export const EducationEditor = React.memo(function EducationEditor() {
  const dispatch = useDispatch<AppDispatch>();
  const raw      = useSelector((s: RootState) => s.resumeBuilder.fields.education);

  const [entries, setEntries] = useState<EducationEntry[]>(() => parseEducationEntries(raw));

  const rawRef     = useRef(raw);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (raw !== rawRef.current) {
      rawRef.current = raw;
      setEntries(parseEducationEntries(raw));
    }
  }, [raw]);

  const commit = useCallback((next: EducationEntry[]) => {
    const s = serialiseEducationEntries(next);
    rawRef.current = s;
    dispatch(updateField({ field: "education", value: s }));
  }, [dispatch]);

  const updateEntry = useCallback(<K extends keyof EducationEntry>(id: string, key: K, val: EducationEntry[K]) => {
    const next = entriesRef.current.map((e) => e._id === id ? { ...e, [key]: val } : e);
    setEntries(next);
    commit(next);
  }, [commit]);

  const moveUp   = useCallback((i: number) => { const n=[...entriesRef.current]; [n[i-1],n[i]]=[n[i],n[i-1]]; setEntries(n); commit(n); }, [commit]);
  const moveDown = useCallback((i: number) => { const n=[...entriesRef.current]; [n[i],n[i+1]]=[n[i+1],n[i]]; setEntries(n); commit(n); }, [commit]);
  const remove   = useCallback((id: string) => { const n=entriesRef.current.filter((e)=>e._id!==id); setEntries(n); commit(n); }, [commit]);
  const addNew   = useCallback(() => { const n=[...entriesRef.current, blankEducation()]; setEntries(n); commit(n); }, [commit]);

  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => (
        <EntryCard
          key={entry._id} index={idx} total={entries.length}
          label={[entry.degree, entry.institution].filter(Boolean).join(" — ")}
          onMoveUp={() => moveUp(idx)} onMoveDown={() => moveDown(idx)} onRemove={() => remove(entry._id)}
          defaultOpen={idx === 0}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Degree / Qualification</Label>
              <Input value={entry.degree} onChange={(e) => updateEntry(entry._id, "degree", e.target.value)} placeholder="BSc Computer Science" className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Institution</Label>
              <Input value={entry.institution} onChange={(e) => updateEntry(entry._id, "institution", e.target.value)} placeholder="MIT — Massachusetts Institute of Technology" className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Dates / Year</Label>
              <Input value={entry.dates} onChange={(e) => updateEntry(entry._id, "dates", e.target.value)} placeholder="2019 – 2023" className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Additional Info (GPA, honours, etc.)</Label>
              <Input value={entry.extra} onChange={(e) => updateEntry(entry._id, "extra", e.target.value)} placeholder="GPA: 3.9 / 4.0, Dean's List" className="h-9 text-sm rounded-lg" />
            </div>
          </div>
        </EntryCard>
      ))}
      <button
        type="button" onClick={addNew}
          className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-slate-200 text-[13px] text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-colors duration-150"
      >
        <Plus className="h-3.5 w-3.5" /> Add Education
      </button>
    </div>
  );
});

// ── ProjectsEditor ────────────────────────────────────────────────────────────


// ─── ProjectsEditor ───────────────────────────────────────────────────────────
export const ProjectsEditor = React.memo(function ProjectsEditor() {
  const dispatch = useDispatch<AppDispatch>();
  const raw      = useSelector((s: RootState) => s.resumeBuilder.fields.projects);

  const [entries, setEntries] = useState<ProjectEntry[]>(() => parseProjectEntries(raw));

  const rawRef     = useRef(raw);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (raw !== rawRef.current) {
      rawRef.current = raw;
      setEntries(parseProjectEntries(raw));
    }
  }, [raw]);

  const commit = useCallback((next: ProjectEntry[]) => {
    const s = serialiseProjectEntries(next);
    rawRef.current = s;
    dispatch(updateField({ field: "projects", value: s }));
  }, [dispatch]);

  const updateEntry = useCallback(<K extends keyof ProjectEntry>(id: string, key: K, val: ProjectEntry[K]) => {
    const next = entriesRef.current.map((e) => e._id === id ? { ...e, [key]: val } : e);
    setEntries(next);
    commit(next);
  }, [commit]);

  const moveUp   = useCallback((i: number) => { const n=[...entriesRef.current]; [n[i-1],n[i]]=[n[i],n[i-1]]; setEntries(n); commit(n); }, [commit]);
  const moveDown = useCallback((i: number) => { const n=[...entriesRef.current]; [n[i],n[i+1]]=[n[i+1],n[i]]; setEntries(n); commit(n); }, [commit]);
  const remove   = useCallback((id: string) => { const n=entriesRef.current.filter((e)=>e._id!==id); setEntries(n); commit(n); }, [commit]);
  const addNew   = useCallback(() => { const n=[...entriesRef.current, blankProject()]; setEntries(n); commit(n); }, [commit]);

  return (
    <div className="space-y-3">
      {entries.map((entry, idx) => (
        <EntryCard
          key={entry._id} index={idx} total={entries.length}
          label={entry.title || `Project ${idx + 1}`}
          onMoveUp={() => moveUp(idx)} onMoveDown={() => moveDown(idx)} onRemove={() => remove(entry._id)}
          defaultOpen={idx === 0}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Project Name</Label>
              <Input value={entry.title} onChange={(e) => updateEntry(entry._id, "title", e.target.value)} placeholder="AI Resume Builder" className="h-9 text-sm rounded-lg" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-muted-foreground">Bullet Points (one per line)</Label>
              <Textarea
                value={entry.bullets}
                onChange={(e) => updateEntry(entry._id, "bullets", e.target.value)}
                placeholder={"Built with React + TypeScript\nReduced load time by 60% via code splitting"}
                rows={4}
                className="resize-none text-sm rounded-lg border-border bg-background placeholder:text-muted-foreground/40 leading-relaxed"
              />
            </div>
          </div>
        </EntryCard>
      ))}
      <button
        type="button" onClick={addNew}
          className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-dashed border-slate-200 text-[13px] text-slate-400 hover:text-slate-700 hover:border-slate-400 transition-colors duration-150"
      >
        <Plus className="h-3.5 w-3.5" /> Add Project
      </button>
    </div>
  );
});

