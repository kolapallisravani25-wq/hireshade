import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Sparkles, Briefcase, CheckCircle2, Circle, Loader2, FolderOpen, AlertCircle, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENDPOINTS } from "@/lib/endpoints";

interface AIProjectRecord {
  id: string;
  position: string;
  industry: string;
  experienceLevel: string;
  projects: { title: string }[];
  createdAt: string;
}

interface Step4AIProjectsProps {
  selectedProjectIds: string[];
  primaryProjectId: string;
  onChange: (ids: string[]) => void;
  onPrimaryChange: (id: string) => void;
}

export function Step4_AIProjects({
  selectedProjectIds,
  primaryProjectId,
  onChange,
  onPrimaryChange,
}: Step4AIProjectsProps) {
  const { getToken } = useAuth();
  const [projects, setProjects] = useState<AIProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken();
        const res = await fetch(ENDPOINTS.projectsMine(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load projects");
        const data = await res.json();
        if (!cancelled) {
          setProjects(Array.isArray(data) ? data : (data.data ?? []));
        }
      } catch {
        if (!cancelled) setError("Could not load your AI projects.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [getToken]);

  const toggle = (id: string) => {
    if (selectedProjectIds.includes(id)) {
      const next = selectedProjectIds.filter((p) => p !== id);
      onChange(next);
      if (next.length === 1 && primaryProjectId !== next[0]) {
        onPrimaryChange(next[0]);
      }
      if (next.length === 0) {
        onPrimaryChange("");
      }
      setSelectionError("");
    } else {
      if (selectedProjectIds.length >= 2) {
        setSelectionError("You can select up to 2 projects. Unselect one to choose another.");
        return;
      }
      const next = [...selectedProjectIds, id];
      onChange(next);
      if (next.length === 1) {
        onPrimaryChange(id);
      }
      setSelectionError("");
    }
  };

  const isSelected = (id: string) => selectedProjectIds.includes(id);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          AI Projects
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Attach your AI-generated portfolio projects as context for the interview session.
          The AI assistant will reference them when crafting answers.{" "}
          <span className="text-foreground/60 font-medium">Optional — you can skip this step.</span>
        </p>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading your projects…</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No AI projects yet</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              Head to the <span className="font-semibold">AI Projects</span> page to generate tailored portfolio projects, then come back here to attach them.
            </p>
          </div>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="grid gap-2.5 max-h-[320px] overflow-y-auto pr-0.5">
          {projects.map((project) => {
            const selected = isSelected(project.id);
            const isPrimary = primaryProjectId === project.id;
            const projectCount = Array.isArray(project.projects) ? project.projects.length : 0;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => toggle(project.id)}
                className={cn(
                  "w-full text-left rounded-xl border p-4 transition-all duration-150",
                  "hover:border-primary/40 hover:bg-muted/30",
                  selected
                    ? "border-primary/60 bg-primary/5 shadow-sm"
                    : "border-border/60 bg-background",
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Selection indicator */}
                  <div className="mt-0.5 shrink-0">
                    {selected ? (
                      <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
                    ) : (
                      <Circle className="h-4.5 w-4.5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Card content */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-sm font-semibold text-foreground truncate">
                        {project.position}
                      </span>
                      {selected && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPrimaryChange(project.id);
                            setSelectionError("");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onPrimaryChange(project.id);
                              setSelectionError("");
                            }
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                            isPrimary
                              ? "border-amber-400 bg-amber-100 text-amber-800"
                              : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          <Star className={cn("h-3 w-3", isPrimary ? "fill-amber-500 text-amber-500" : "text-zinc-400")} />
                          {isPrimary ? "Primary" : "Set Primary"}
                        </span>
                      )}
                      {project.experienceLevel && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {project.experienceLevel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {project.industry && (
                        <span className="text-xs text-muted-foreground">{project.industry}</span>
                      )}
                      {projectCount > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Sparkles className="h-3 w-3" />
                          {projectCount} project{projectCount !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {projectCount > 0 && Array.isArray(project.projects) && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {project.projects.slice(0, 3).map((p, i) => (
                          <span
                            key={i}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground border border-border/40 truncate max-w-[160px]"
                          >
                            {p.title}
                          </span>
                        ))}
                        {project.projects.length > 3 && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground border border-border/40">
                            +{project.projects.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedProjectIds.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-primary font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {selectedProjectIds.length}/2 selected
          </p>
          {selectedProjectIds.length === 2 && !primaryProjectId && (
            <p className="text-xs text-amber-600">
              Select one project as primary before continuing.
            </p>
          )}
        </div>
      )}
      {selectionError && (
        <p className="text-xs text-destructive">{selectionError}</p>
      )}
    </div>
  );
}
