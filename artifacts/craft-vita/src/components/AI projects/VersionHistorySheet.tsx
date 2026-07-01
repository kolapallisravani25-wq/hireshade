import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import { History, RotateCcw, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ENDPOINTS } from "@/lib/endpoints";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  projects: unknown[];
  label: string | null;
  createdAt: string;
}

interface Props {
  projectId: string;
  /** Called after a successful rollback with the updated version list */
  onRollbackSuccess: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VersionHistorySheet({ projectId, onRollbackSuccess }: Props) {
  const { getToken } = useAuth();

  const [open, setOpen]           = useState(false);
  const [versions, setVersions]   = useState<ProjectVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [rollingBack, setRollingBack]         = useState<string | null>(null); // versionId

  // Fetch versions when the sheet opens
  const fetchVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsVersions(projectId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load version history");
      const json = await res.json() as { success: boolean; data: ProjectVersion[] };
      setVersions(json.data ?? []);
    } catch (err: unknown) {
      toast.error((err as Error).message || "Could not load versions");
    } finally {
      setLoadingVersions(false);
    }
  }, [projectId, getToken]);

  useEffect(() => {
    if (open) fetchVersions();
  }, [open, fetchVersions]);

  const handleRollback = async (version: ProjectVersion) => {
    if (rollingBack) return;
    setRollingBack(version.id);
    const tid = "rollback";
    toast.loading(`Rolling back to ${version.label ?? `v${version.versionNumber}`}…`, { id: tid });
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsRollback(projectId, version.id), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error ?? "Rollback failed");
      }
      toast.success("Rolled back successfully", { id: tid });
      setOpen(false);
      onRollbackSuccess();
    } catch (err: unknown) {
      toast.error((err as Error).message || "Rollback failed", { id: tid });
    } finally {
      setRollingBack(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 h-8"
        onClick={() => setOpen(true)}
        title="Version history"
      >
        <History className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">History</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-5 pt-5 pb-4 border-b border-border/60">
            <SheetTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Version History
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Each regeneration saves a snapshot. Roll back to any previous version — your current
              content is snapshotted first so nothing is permanently lost.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loadingVersions ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history…
              </div>
            ) : versions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                <History className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No previous versions yet.</p>
                <p className="text-xs text-muted-foreground/70">
                  Regenerate your projects to start building a history.
                </p>
              </div>
            ) : (
              <ol className="relative border-l border-border/50 space-y-0 ml-2">
                {versions.map((v, idx) => (
                  <li key={v.id} className="mb-0 ml-4">
                    <div className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-border" />

                    <div className="group flex items-start justify-between gap-3 rounded-lg px-3 py-3 hover:bg-muted/60 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight truncate">
                          {v.label ?? `Version ${v.versionNumber}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDate(v.createdAt)}
                        </p>
                        {idx === 0 && (
                          <span className="inline-flex items-center text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200/60 rounded-full px-2 py-0.5 mt-1.5">
                            most recent snapshot
                          </span>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-primary hover:text-primary"
                        onClick={() => handleRollback(v)}
                        disabled={!!rollingBack}
                        title={`Roll back to ${v.label ?? `version ${v.versionNumber}`}`}
                      >
                        {rollingBack === v.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <RotateCcw className="h-3 w-3" />
                            Restore
                            <ChevronRight className="h-3 w-3" />
                          </>
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
