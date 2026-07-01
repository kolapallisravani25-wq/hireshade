 ;

import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import type { ExportableData } from "@/components/data-table/utils/export-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, Trash2, MoreVertical, Download, Edit2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import ResumePreview from "./ResumePreview";
import { DeleteResumeDialog } from "./DeleteResumeDialog";
import UploadResumeDialog from "./UploadResumeDialog";
import { toast } from "sonner";

export interface Resume extends ExportableData {
  id: string;
  filename: string;
  uploadedAt: string;
  updatedAt?: string;
  size?: number | string;
  score?: number;
  path?: string;
  ats?: boolean;
  atsScore?: number;
  atsAnalysis?: any;
  source?: "uploaded" | "builder";
  fileType?: string;
  processingStatus?: "completed" | "processing" | "failed";
}

interface ListOfResumesProps {
  userId: string;
  onSelectResume: (resume: Resume) => void;
  selectedResumeId?: string;
}

// ── Helper: Format file size ────────────────────────────────────
function formatFileSize(bytes?: number | string): string {
  if (!bytes) return "—";
  const num = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Helper: Get file extension ──────────────────────────────────
function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toUpperCase() || "FILE";
}

// ── Helper: Format date ────────────────────────────────────────
function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Helper: ATS Score Badge ────────────────────────────────────
function getATSScoreBadge(score?: number): { label: string; variant: string; color: string } {
  if (score === undefined || score === null) {
    return { label: "Not Analyzed", variant: "outline", color: "text-slate-500" };
  }
  if (score >= 80) return { label: "Excellent", variant: "default", color: "text-emerald-700" };
  if (score >= 60) return { label: "Good", variant: "secondary", color: "text-blue-700" };
  if (score >= 40) return { label: "Average", variant: "outline", color: "text-amber-700" };
  return { label: "Poor", variant: "outline", color: "text-red-700" };
}

export default function ListOfResumes({
  userId,
  onSelectResume,
  selectedResumeId,
}: ListOfResumesProps) {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [previewResume, setPreviewResume] = useState<Resume | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [resumeToDelete, setResumeToDelete] = useState<Resume | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [resumeToRename, setResumeToRename] = useState<Resume | null>(null);
  const [newFilename, setNewFilename] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const [atsLoadingIds, setAtsLoadingIds] = useState<Record<string, boolean>>({});

  const openResumePreview = useCallback((resume: Resume) => {
    onSelectResume(resume);
    setPreviewResume(resume);
    setIsPreviewOpen(true);
  }, [onSelectResume]);

  // ✅ Listen for upload completion event
  useEffect(() => {
    const handleResumeUploaded = () => {
      setRefreshKey((prev) => prev + 1);
      toast.success("Resume uploaded successfully!");
    };

    window.addEventListener("resumeUploaded", handleResumeUploaded);
    return () =>
      window.removeEventListener("resumeUploaded", handleResumeUploaded);
  }, []);

  // ✅ FETCH FUNCTION (DataTable format)
  // ✅ async-parallel: Pre-compute all needed values before API call
  // ✅ async-defer-await: Only await when data is actually needed
  const fetchResumes = useCallback(async ({ search, from_date, to_date }: { search: string; from_date: string; to_date: string }) => {
    // Check cheap conditions first before any async operations
    if (!userId) {
      return {
        success: true,
        data: [],
        pagination: { page: 1, limit: 0, total_pages: 1, total_items: 0 },
      };
    }

    try {
      // Build parameters in parallel (non-async operations)
      const params = new URLSearchParams();
      params.set("userId", userId);

      if (search?.trim()) {
        params.set("search", search.trim());
      }

      // Single defer point for all API calls
      const url = `${import.meta.env.VITE_BACKEND_URL}/api/resume/list?${params.toString()}`;
      const token = await getToken();
      const res = await fetch(url, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        console.error("Resume fetch failed:", res.statusText);
        throw new Error("Failed to fetch resumes");
      }

      const raw = await res.json();
      let list: Resume[] = Array.isArray(raw) ? raw : [];

      // Client-side date range filtering on uploadedAt
      if (from_date || to_date) {
        const from = from_date ? new Date(from_date).getTime() : -Infinity;
        const to = to_date ? new Date(to_date + "T23:59:59").getTime() : Infinity;
        list = list.filter((r) => {
          const t = new Date(r.uploadedAt).getTime();
          return t >= from && t <= to;
        });
      }

      return {
        success: true,
        data: list,
        pagination: {
          page: 1,
          limit: list.length || 0,
          total_pages: 1,
          total_items: list.length,
        },
      };
    } catch (error) {
      console.error("Resume fetch error:", error);
      return {
        success: false,
        data: [],
        pagination: { page: 1, limit: 0, total_pages: 1, total_items: 0 },
      };
    }
  }, [userId]);

  // ✅ ATS — Open ATS report for resume using resumeId
  const handleATS = useCallback(async (resume: Resume) => {
    try {
      if (resume.atsAnalysis) {
        navigate("/resume/ats-result", {
          state: {
            analysis: {
              ...resume.atsAnalysis,
              filename: resume.filename,
              resumeId: resume.id,
            },
          },
        });
        return;
      }

      // ── Uploaded resumes: check for cached analysis first ─────────────────
      if (resume.ats || (resume.atsScore !== undefined && resume.atsScore !== null)) {
        setAtsLoadingIds((prev) => ({ ...prev, [resume.id]: true }));
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/resume/all-ats?userId=${userId}`,
        );
        const allAnalyzed = await res.json();
        const existing = Array.isArray(allAnalyzed)
          ? allAnalyzed.find((r: any) => r.id === resume.id)
          : null;

        if (existing?.atsAnalysis) {
          navigate("/resume/ats-result", {
            state: {
              analysis: {
                ...existing.atsAnalysis,
                filename: resume.filename,
                resumeId: resume.id,
              },
            },
          });
          return;
        }
      }

      navigate("/resume/ats-result", {
        state: {
          pendingAnalysis: {
            resumeId: resume.id,
            filename: resume.filename,
            source: resume.source ?? "uploaded",
            userId,
          },
        },
      });
    } catch (error: any) {
      console.error("ATS error:", error);
      toast.error(error.message || "Something went wrong");
    } finally {
      setAtsLoadingIds((prev) => ({ ...prev, [resume.id]: false }));
    }
  }, [navigate, userId]);

  // ✅ RENAME
  const handleOpenRename = (resume: Resume) => {
    setResumeToRename(resume);
    setNewFilename(resume.filename);
    setIsRenameDialogOpen(true);
  };

  const confirmRename = async () => {
    if (!resumeToRename || !newFilename.trim()) {
      toast.error("Please enter a valid filename");
      return;
    }

    if (newFilename === resumeToRename.filename) {
      setIsRenameDialogOpen(false);
      return;
    }

    setIsRenaming(true);
    try {
      const isBuilt = resumeToRename.source === "builder";

      let res: Response;
      if (isBuilt) {
        // Builder resumes: use the builder rename endpoint with auth
        const token = await getToken();
        res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/resume/builder/${resumeToRename.id}/rename`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ title: newFilename.trim() }),
          },
        );
      } else {
        res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/resume/${resumeToRename.id}/rename`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: newFilename.trim() }),
          },
        );
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to rename resume");
      }

      setIsRenameDialogOpen(false);
      setResumeToRename(null);
      setRefreshKey((prev) => prev + 1);
      toast.success("Resume renamed successfully");
    } catch (error: any) {
      console.error("Rename error:", error);
      toast.error(error.message || "Failed to rename resume");
    } finally {
      setIsRenaming(false);
    }
  };

  // ✅ DOWNLOAD — fetch a short-lived signed URL, then open it
  const handleDownload = useCallback(async (resume: Resume) => {
    try {
      const token = await getToken();
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/resume/${resume.id}/signed-url`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error("Failed to get download link");
      const data = (await res.json()) as { url: string };
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      console.error("Download error:", error);
      toast.error(error.message || "Failed to download resume");
    }
  }, [getToken]);

  // ✅ DELETE
  const handleDelete = (resume: Resume) => {
    setResumeToDelete(resume);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!resumeToDelete) return;

    setIsDeleting(true);
    try {
      // Builder resumes (source === "builder") are stored in BuiltResume table
      // and must be deleted via the builder endpoint with auth.
      const isBuilt = resumeToDelete.source === "builder";
      const url = isBuilt
        ? `${import.meta.env.VITE_BACKEND_URL}/api/resume/builder/${resumeToDelete.id}`
        : `${import.meta.env.VITE_BACKEND_URL}/api/resume/${resumeToDelete.id}`;

      const headers: Record<string, string> = {};
      if (isBuilt) {
        const token = await getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, { method: "DELETE", headers });

      if (!res.ok) {
        throw new Error("Failed to delete resume");
      }

      setIsDeleteDialogOpen(false);
      setResumeToDelete(null);
      // Refresh the table
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete resume. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  // ✅ COLUMNS — Comprehensive resume management columns
  const columns: ColumnDef<Resume>[] = useMemo(() => [
    {
      accessorKey: "filename",
      header: "Resume Name",
      cell: ({ row }) => {
        const resume = row.original;
        return (
          <div className="min-w-0 flex-1">
            <div
              onClick={() => openResumePreview(resume)}
              className={cn(
                "cursor-pointer font-medium text-sm truncate",
                selectedResumeId === resume.id && "text-primary",
              )}
              title={resume.filename}
            >
              {resume.filename}
            </div>
          </div>
        );
      },
    },

    {
      accessorKey: "atsScore",
      header: "ATS Score",
      cell: ({ row }) => {
        const resume = row.original;
        const score = resume.atsScore;
        const badge = getATSScoreBadge(score);

        if (score === undefined || score === null) {
          return (
            <Badge variant="outline" className="text-xs">
              Not Analyzed
            </Badge>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className={`text-xs font-semibold`}>
              {score}% — {badge.label}
            </Badge>
            <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  score >= 80 && "bg-emerald-500",
                  score >= 60 && score < 80 && "bg-blue-500",
                  score >= 40 && score < 60 && "bg-amber-500",
                  score < 40 && "bg-red-500",
                )}
                style={{ width: `${Math.min(score, 100)}%` }}
              />
            </div>
          </div>
        );
      },
    },

    {
      accessorKey: "uploadedAt",
      header: "Upload Date",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600">{formatDate(row.getValue("uploadedAt"))}</span>
      ),
    },

    {
      accessorKey: "updatedAt",
      header: "Last Updated",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600">{formatDate(row.getValue("updatedAt"))}</span>
      ),
    },

    {
      accessorKey: "size",
      header: "Size",
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 tabular-nums">{formatFileSize(row.getValue("size"))}</span>
      ),
    },

    {
      accessorKey: "fileType",
      header: "Type",
      cell: ({ row }) => {
        const resume = row.original;
        // Builder resumes are always shown as "Builder" regardless of filename
        if (resume.source === "builder") {
          return (
            <Badge variant="outline" className="text-xs font-medium text-purple-700 border-purple-200 bg-purple-50">
              Builder
            </Badge>
          );
        }
        // For uploaded resumes, derive type from fileType field or file extension
        const fileType = resume.fileType || getFileExtension(resume.filename);
        // getFileExtension returns the full filename if there's no dot — treat those as "FILE"
        const label = fileType.includes(".") || fileType === resume.filename
          ? "FILE"
          : fileType;
        return (
          <Badge variant="outline" className="text-xs font-medium">
            {label}
          </Badge>
        );
      },
    },

    {
      accessorKey: "processingStatus",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("processingStatus") || "completed";
        const statusConfig = {
          completed: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", label: "Ready" },
          processing: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50", label: "Processing" },
          failed: { icon: AlertCircle, color: "text-red-600", bg: "bg-red-50", label: "Failed" },
        };
        const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.completed;
        const Icon = config.icon;

        return (
          <div className={`inline-flex items-center gap-1.5 rounded-full ${config.bg} px-2.5 py-1.5`}>
            <Icon className={`h-3.5 w-3.5 ${config.color}`} />
            <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
          </div>
        );
      },
    },

    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const resume = row.original;

        return (
          <div className="flex items-center justify-end gap-1">
            {/* QUICK VIEW */}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                openResumePreview(resume);
              }}
              className="h-8 w-8"
              title="Preview Resume"
            >
              <Eye className="h-4 w-4" />
            </Button>

            {/* MORE ACTIONS */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title="More actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {resume.atsScore !== undefined && resume.atsScore !== null ? (
                  <DropdownMenuItem
                    onClick={() => handleATS(resume)}
                    className="gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>View ATS Report</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onClick={() => handleATS(resume)}
                    disabled={atsLoadingIds[resume.id]}
                    className="gap-2"
                  >
                    {atsLoadingIds[resume.id] ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Run ATS Analysis</span>
                      </>
                    )}
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem
                  onClick={() => handleOpenRename(resume)}
                  className="gap-2"
                >
                  <Edit2 className="h-4 w-4" />
                  <span>Rename Resume</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => {
                    if (resume.source === "builder") {
                      navigate("/resume/editor", {
                        state: {
                          config: { sourceType: "builder", resumeId: resume.id },
                        },
                      });
                    } else {
                      handleDownload(resume);
                    }
                  }}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  <span>{resume.source === "builder" ? "Open in Editor" : "Download"}</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => handleDelete(resume)}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [openResumePreview, selectedResumeId, atsLoadingIds, handleATS, handleDownload]);

  return (
    <div className="space-y-4">
      {/* ✅ HEADER (kept from your UI) */}
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-semibold">Your resumes</h2>
      </div>

      {/* ✅ DATATABLE */}
      <DataTable
        key={refreshKey}
        getColumns={useCallback(() => columns, [columns])}
        fetchDataFn={fetchResumes}
        fetchByIdsFn={async () => []}
        idField="id"
        onRowClick={(resume) => openResumePreview(resume)}
        renderToolbarContent={() => (
          <UploadResumeDialog
            userId={userId}
            triggerClassName="h-9 rounded-md"
          />
        )}
        config={{
          enableSearch: true,
          enableRowSelection: false,
          searchPlaceholder: "Search by resume name, JD, or keywords...",
        }}
      />

      {/* ✅ PREVIEW MODAL (unchanged) */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="min-w-5xl w-[95vw] h-[95vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>Resume: {previewResume?.filename}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden mt-4 w-full">
            {previewResume && <ResumePreview resume={previewResume} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ✅ DELETE CONFIRMATION DIALOG */}
      <DeleteResumeDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        resumeName={resumeToDelete?.filename || ""}
        isDeleting={isDeleting}
      />

      {/* ✅ RENAME DIALOG */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Resume</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-2">
                New Filename
              </label>
              <Input
                autoFocus
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                placeholder="Enter new resume name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmRename();
                }}
                className="rounded-lg border-slate-200 focus-visible:ring-1 focus-visible:ring-brand"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                The filename will be updated, but the resume ID remains unchanged for internal tracking.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsRenameDialogOpen(false)}
              disabled={isRenaming}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRename}
              disabled={isRenaming || !newFilename.trim() || newFilename === resumeToRename?.filename}
            >
              {isRenaming ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                  Renaming...
                </>
              ) : (
                "Rename"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
