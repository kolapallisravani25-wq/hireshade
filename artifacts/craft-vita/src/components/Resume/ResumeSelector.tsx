 ;

import * as React from "react";
import { useStoredUserId } from "@/hooks/useStoredUserId";
import { FileText, PencilLine, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@clerk/clerk-react";

export interface Resume {
  id: string;
  filename: string;
  path: string;
  size?: number | string;
  resumeContext?: string;
  uploadedAt: string;
  userId?: string;
  score?: number;
  ats: boolean;
  /** "uploaded" for file-based resumes, "builder" for builder resumes */
  source?: "uploaded" | "builder";
  atsAnalysis?: {
    id: string;
    score: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    missingKeywords: string[];
    suggestions: string[];
  };
}

interface ResumeSelectorProps {
  onSelect?: (resume: Resume) => void;
  onDeselect?: () => void;
  value?: string;
  className?: string;
  filter?: (resume: Resume) => boolean;
  /** When true, also fetches builder resumes and shows them in the list. */
  includeBuilderResumes?: boolean;
}

export function ResumeSelector({ onSelect, onDeselect, value, filter, includeBuilderResumes }: ResumeSelectorProps) {
  const { getToken } = useAuth();
  const [resumes, setResumes] = React.useState<Resume[]>([]);
  const [selectedResumeId, setSelectedResumeId] = React.useState<string>(value || "");
  const id = useStoredUserId();
  const [loadedForId, setLoadedForId] = React.useState<string | null>(null);
  const loading = loadedForId !== id;

  // Use a ref for onSelect to avoid infinite re-fetch when parent passes inline arrow functions
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  React.useEffect(() => {
    if (!id) return;

    const fetchUploaded = getToken().then((token) =>
      fetch(`${import.meta.env.VITE_BACKEND_URL}/api/resume/list?userId=${id}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).then((res) => res.json()).then((response): Resume[] => {
      const list: Resume[] = Array.isArray(response) ? response : (response.data ?? []);
        return list.map((r) => ({ ...r, source: "uploaded" as const }));
      })
    );

    const fetchBuilder = includeBuilderResumes
      ? getToken().then((token) =>
          fetch(`${import.meta.env.VITE_BACKEND_URL}/api/resume/builder/list?userId=${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((res) => res.json())
            .then((response): Resume[] => {
              const list: Array<{ id: string; title?: string; createdAt?: string; updatedAt?: string }> =
                response.resumes ?? response.data ?? (Array.isArray(response) ? response : []);
              return list.map((r) => ({
                id: r.id,
                filename: r.title || "Untitled Resume",
                path: "",
                ats: false,
                source: "builder" as const,
                uploadedAt: r.updatedAt ?? r.createdAt ?? "",
              }));
            })
        )
      : Promise.resolve([] as Resume[]);

    Promise.all([fetchUploaded, fetchBuilder])
      .then(([uploaded, builder]) => {
        let combined: Resume[] = [...uploaded, ...builder];
        if (filter) combined = combined.filter(filter);
        setResumes(combined);
      })
      .catch((err) => console.error("Error fetching resumes:", err))
      .finally(() => setLoadedForId(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, includeBuilderResumes]);

  const handleValueChange = (value: string) => {
    setSelectedResumeId(value);
    const selected = resumes.find((r) => r.id === value);
    if (selected) {
      onSelect?.(selected);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedResumeId("");
    onDeselect?.();
  };

  const selectedResume = resumes.find((r) => r.id === selectedResumeId);

  return (
    <div className="relative">
      <Select
        value={selectedResumeId}
        onValueChange={handleValueChange}
        disabled={loading || resumes.length === 0}
      >
      <SelectTrigger className="h-12 w-full px-4 rounded-xl border-border/80 bg-background hover:bg-muted/30 transition-all focus:ring-primary/20 py-6">
        <SelectValue
          placeholder={
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg bg-muted text-muted-foreground/80">
                <FileText className="h-5 w-5" />
              </div>
              <span className="truncate text-sm font-medium text-foreground/80">
                {loading
                  ? "Loading resumes..."
                  : resumes.length > 0
                    ? "Select a resume"
                    : "No resumes found"}
              </span>
            </div>
          }
        >
          {selectedResume && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg bg-muted text-muted-foreground/80">
                {selectedResume.source === "builder"
                  ? <PencilLine className="h-5 w-5" />
                  : <FileText className="h-5 w-5" />
                }
              </div>
              <span className="truncate text-sm font-medium text-foreground/80">
                {selectedResume.filename}
                {selectedResume.source === "builder" && (
                  <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">Builder</span>
                )}
              </span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/60 shadow-lg">
        {resumes.map((resume) => (
          <SelectItem
            key={resume.id}
            value={resume.id}
            className="py-3 px-4 focus:bg-primary/5 focus:text-primary transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              {resume.source === "builder"
                ? <PencilLine className="h-5 w-5 text-violet-500" />
                : <FileText className="h-5 w-5 text-muted-foreground" />
              }
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {resume.filename}
                  {resume.source === "builder" && (
                    <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 border border-violet-200">Builder</span>
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {resume.uploadedAt}
                </span>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
      </Select>
      {selectedResume && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear selected resume"
          className="absolute right-10 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-muted hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors z-10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
