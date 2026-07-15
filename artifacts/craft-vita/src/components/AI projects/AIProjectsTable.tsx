 ;

import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { useAuth } from "@clerk/clerk-react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/column-header";
import type { ExportableData } from "@/components/data-table/utils/export-utils";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Input }  from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText, Calendar, Sparkles, Eye, Loader2, AlertCircle, RefreshCw, X,
  MoreHorizontal, Pencil, Trash2, FileDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ENDPOINTS } from "@/lib/endpoints";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectRecord extends ExportableData {
  id: string;
  position: string;
  jobDescription: string;
  resumeId: string | null;
  projects: any[];
  userId: string;
  createdAt: string;
}

type MineProjectApiItem = {
  id: string;
  userId?: string;
  title?: string;
  description?: string | null;
  content?: unknown;
  resumeId?: string | null;
  createdAt?: string;
};

function normalizeMineProject(item: MineProjectApiItem): ProjectRecord {
  return {
    id: item.id,
    position: item.title || "Untitled Project",
    jobDescription: item.description || "",
    resumeId: item.resumeId ?? null,
    projects: item.content ? [item.content] : [],
    userId: item.userId || "",
    createdAt: item.createdAt || new Date().toISOString(),
  };
}

export interface ActiveJob {
  position:  string;
  industry?: string;
  status:    "generating" | "error";
  count:     number;          // projects streamed so far
  error?:    string;
  onRetry:   () => void;
  onDismiss: () => void;
}

interface AIProjectsTableProps {
  activeJob?:      ActiveJob;
  refreshTrigger?: number;
}

// ─── In-Progress Row (rendered inside shared table border) ───────────────────

function InlineProgressRow({ job }: { job: ActiveJob }) {
  const isError = job.status === "error";
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 border-b transition-all",
        isError ? "bg-red-50/60" : "bg-primary/[0.025]",
      )}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
          isError ? "bg-red-100" : "bg-primary/10",
        )}
      >
        {isError ? (
          <AlertCircle className="h-4 w-4 text-red-500" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary animate-pulse" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900 truncate">
            {job.position || "Generating…"}
          </p>
          {job.industry && (
            <span className="text-xs text-slate-400 hidden sm:inline">· {job.industry}</span>
          )}
        </div>
        {isError ? (
          <p className="text-xs text-red-600 mt-0.5 truncate">{job.error ?? "Generation failed"}</p>
        ) : (
          <p className="text-xs text-slate-400 mt-0.5">Generating projects ({job.count}/3)…</p>
        )}
      </div>

      {!isError && (
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-2 rounded-full transition-all duration-500",
                i < job.count ? "w-6 bg-primary" : "w-2 bg-slate-200",
              )}
            />
          ))}
        </div>
      )}

      {!isError && (
        <Badge className="shrink-0 bg-primary/10 text-primary border-none text-[9px] font-black uppercase tracking-widest hidden md:inline-flex items-center gap-1">
          {job.count < 3 ? (
            <><Loader2 className="h-2.5 w-2.5 animate-spin" />Processing</>
          ) : (
            "Finalizing"
          )}
        </Badge>
      )}

      {isError && (
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={job.onRetry}
            className="h-7 px-3 rounded-lg text-xs font-semibold gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={job.onDismiss}
            className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AIProjectsTable({ activeJob, refreshTrigger = 0 }: AIProjectsTableProps) {
  const navigate     = useNavigate();
  const { getToken } = useAuth();

  // Local refresh for delete / rename operations
  const [localRefresh, setLocalRefresh] = useState(0);
  const tableKey = `table-${refreshTrigger}-${localRefresh}`;

  // Keep activeJob in a ref so columns/fetchFn closures always read the latest value
  const activeJobRef = useRef<ActiveJob | undefined>(activeJob);
  activeJobRef.current = activeJob;

  // ── Delete state ───────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // ── Rename state ───────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget]   = useState<ProjectRecord | null>(null);
  const [renameValue,  setRenameValue]    = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  // ── PDF export state ───────────────────────────────────────────────────
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  const handleExportPdf = useCallback(async (project: ProjectRecord) => {
    setPdfLoadingId(project.id);
    const toastId = `pdf-${project.id}`;
    toast.loading("Generating PDF…", { id: toastId, description: project.position });
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsExportPdf(project.id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "PDF generation failed");
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${project.position.replace(/[^a-z0-9]/gi, "_")}_projects.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF downloaded", { id: toastId, description: project.position });
    } catch (err) {
      toast.error("PDF export failed", { id: toastId, description: (err as Error).message });
    } finally {
      setPdfLoadingId(null);
    }
  }, [getToken]);

  // ── Delete handler ─────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsDelete(deleteTarget.id), {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error ?? "Failed to delete project");
        return;
      }
      toast.success("Project deleted");
      setDeleteTarget(null);
      setLocalRefresh((k) => k + 1);
    } catch (e) {
      console.error("[AIProjectsTable] delete error", e);
      toast.error("Failed to delete project");
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, getToken]);

  // ── Rename handler ─────────────────────────────────────────────────────
  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenameLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(ENDPOINTS.projectsUpdate(renameTarget.id), {
        method:  "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${token}`,
        },
        // `title` is the actual column. This previously sent `position`, which
        // isn't a field on the project — so renames silently did nothing.
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error ?? "Failed to rename project");
        return;
      }
      toast.success("Project renamed");
      setRenameTarget(null);
      setLocalRefresh((k) => k + 1);
    } catch (e) {
      console.error("[AIProjectsTable] rename error", e);
      toast.error("Failed to rename project");
    } finally {
      setRenameLoading(false);
    }
  }, [renameTarget, renameValue, getToken]);

  // ── Fetch ──────────────────────────────────────────────────────────────
  // Search/date-filter/sort/pagination are all done SERVER-side now. This
  // previously fetched the user's entire project library on every keystroke,
  // page change and refresh, then filtered in memory — fine at 5 projects,
  // not at 500.
  const fetchProjects = useCallback(async (params: any) => {
    const emptyPage = {
      success: false,
      data: [] as ProjectRecord[],
      pagination: { page: 1, limit: 10, total_pages: 0, total_items: 0 },
    };
    try {
      const token = await getToken();
      if (!token) return emptyPage;

      const url = ENDPOINTS.projectsMine({
        search: (params?.search || "") as string,
        page: Number(params?.page || 1),
        limit: Number(params?.limit || 10),
        from_date: (params?.from_date || "") as string,
        to_date: (params?.to_date || "") as string,
        sort_by: (params?.sort_by || "") as string,
        sort_order: (params?.sort_order || "") as string,
      });

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { data?: unknown[] }).data)
        ? ((data as { data: unknown[] }).data)
        : [];

      const pagination = (data as { pagination?: typeof emptyPage.pagination })
        .pagination ?? {
        page: Number(params?.page || 1),
        limit: Number(params?.limit || 10),
        total_pages: 1,
        total_items: rows.length,
      };

      return {
        success: true,
        data: (rows as MineProjectApiItem[]).map(normalizeMineProject),
        pagination,
      };
    } catch {
      return emptyPage;
    }
  }, [getToken]);

  // ── Columns ────────────────────────────────────────────────────────────
  const columns: ColumnDef<ProjectRecord>[] = useMemo(
    () => [
      {
        accessorKey: "position",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Target Position" />
        ),
        cell: ({ row }) => {
          const project = row.original;
          return (
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{project.position}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                  {project.jobDescription?.slice(0, 80) || "—"}
                  {(project.jobDescription?.length ?? 0) > 80 ? "…" : ""}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Generated Date" />
        ),
        cell: ({ row }) => {
          const d = new Date(row.getValue("createdAt") as string);
          return (
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Calendar className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="leading-tight">
                <p>{d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                <p className="text-[11px] text-muted-foreground/60">
                  {d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        id: "projectCount",
        header: "Projects",
        cell: ({ row }) => {
          const count = Array.isArray(row.original.projects)
            ? row.original.projects.length
            : 0;
          return (
            <Badge
              variant="secondary"
              className="rounded-md px-2.5 py-1 text-xs font-semibold bg-primary/5 text-primary border border-primary/10"
            >
              {count} Project{count !== 1 ? "s" : ""}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: () => <div className="text-right pr-2">Action</div>,
        cell: ({ row }) => {
          const project = row.original;
          return (
            <div className="flex items-center justify-end gap-1 pr-2">
              {/* View */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/ai-projects/${project.id}`)}
                className="h-8 w-8 p-0 rounded-lg hover:bg-primary hover:text-primary-foreground transition-all"
                title="View Report"
              >
                <Eye className="h-4 w-4" />
              </Button>

              {/* More actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg hover:bg-muted"
                    title="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => {
                      setRenameValue(project.position);
                      setRenameTarget(project);
                    }}
                    className="gap-2 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExportPdf(project)}
                    disabled={pdfLoadingId === project.id}
                    className="gap-2 cursor-pointer"
                  >
                    {pdfLoadingId === project.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      : <FileDown className="h-3.5 w-3.5 text-muted-foreground" />}
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteTarget(project)}
                    className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [navigate, handleExportPdf, pdfLoadingId],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="animate-in fade-in duration-700">
        {/* Progress row shares the same outer border as the DataTable */}
        {activeJob && (
          <div className="rounded-t-md border border-b-0 overflow-hidden">
            <InlineProgressRow job={activeJob} />
          </div>
        )}

        <div
          className={cn(
            activeJob &&
              "[&_.table-container]:rounded-t-none [&_.table-container]:border-t-0",
          )}
        >
          <DataTable
            key={tableKey}
            getColumns={() => columns}
            fetchDataFn={fetchProjects}
            fetchByIdsFn={async () => []}
            idField="id"
            config={{
              enableSearch:           true,
              enableRowSelection:     true,
              enableColumnVisibility: true,
              enableExport:           true,
              searchPlaceholder:      "Search by role or description…",
              defaultSortBy:          "createdAt",
              defaultSortOrder:       "desc",
            }}
            exportConfig={{
              entityName: "AI Projects",
              columnMapping: {
                position:  "Position",
                createdAt: "Generated Date",
              },
              columnWidths: [{ wch: 30 }, { wch: 20 }],
              headers: ["position", "createdAt"],
            }}
          />
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.position}</strong> and all its generated
              reports will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {deleteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Rename dialog ── */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-black">Rename Project</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
            placeholder="Target position label…"
            className="rounded-xl"
            autoFocus
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameTarget(null)}
              disabled={renameLoading}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRename}
              disabled={!renameValue.trim() || renameLoading}
              className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black gap-2"
            >
              {renameLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
