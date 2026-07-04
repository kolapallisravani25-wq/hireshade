 ;

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, FileText, BarChart3, Play } from "lucide-react";
import { TranscriptDialog } from "./TranscriptDialog";
import { SessionAnalyticsDialog } from "./SessionAnalyticsDialog";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { OutOfCreditsDialog } from "@/components/Billing/OutOfCreditsDialog";
import { BuyCreditsDialog } from "@/components/Billing/BuyCreditsDialog";
import type { ExportableData } from "@/components/data-table/utils/export-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchSessions,
  deleteSession,
  forceDeleteSession,
  bulkDeleteSessions,
  selectSessionItems,
  selectSessionsStatus,
  selectSessionsHasFetched,
  invalidateSessions,
  type Session,
} from "@/store/sessionsSlice";

// Re-export the type so column defs work with the data-table's ExportableData constraint.
type SessionRow = Session & ExportableData;

export default function Sessions() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = localStorage.getItem("userId");

  // ── Redux state ───────────────────────────────────────────────────────────
  const sessions = useAppSelector(selectSessionItems);
  const status = useAppSelector(selectSessionsStatus);
  const hasFetched = useAppSelector(selectSessionsHasFetched);

  // ── Local UI state (dialogs, selections) ──────────────────────────────────
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [bulkIdsToDelete, setBulkIdsToDelete] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [isForceDeleteDialogOpen, setIsForceDeleteDialogOpen] = useState(false);
  const [sessionToForceDelete, setSessionToForceDelete] = useState<string | null>(null);
  const [isForceDeleting, setIsForceDeleting] = useState(false);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isTranscriptDialogOpen, setIsTranscriptDialogOpen] = useState(false);
  const [isAnalyticsDialogOpen, setIsAnalyticsDialogOpen] = useState(false);
  const [selectedSessionForAnalytics, setSelectedSessionForAnalytics] =
    useState<Session | null>(null);

  // Credit check states
  const { balance, refresh: refreshBalance } = useCreditsBalance();
  const [isOutOfCreditsOpen, setIsOutOfCreditsOpen] = useState(false);
  const [isBuyCreditsOpen, setIsBuyCreditsOpen] = useState(false);

  // ── Fetch params tracked for DataTable filter changes ─────────────────────
  const [currentSearch, setCurrentSearch] = useState("");
  const [currentDateRange, setCurrentDateRange] = useState({ from_date: "", to_date: "" });

  // Auto-open the transcript dialog when arriving with ?view=<sessionId>.
  useEffect(() => {
    const viewId = searchParams.get("view");
    if (viewId) {
      setSelectedSessionId(viewId);
      setIsTranscriptDialogOpen(true);
    }
  }, [searchParams]);

  // ── Initial + filter-driven fetch ─────────────────────────────────────────
  // Fetch sessions when the component mounts or when filters change.
  // The thunk itself deduplicates — if the params haven't changed, it's a no-op.
  useEffect(() => {
    if (!userId) return;
    dispatch(
      fetchSessions({
        userId,
        search: currentSearch,
        from_date: currentDateRange.from_date,
        to_date: currentDateRange.to_date,
      }),
    );
  }, [dispatch, userId, currentSearch, currentDateRange]);

  // ── DataTable fetchDataFn adapter ─────────────────────────────────────────
  // The DataTable component expects an async function that returns paginated data.
  // We feed it from Redux state (already fetched) and do client-side pagination.
  // This function reference is STABLE (useCallback with [] deps + refs).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const fetchDataForTable = useCallback(
    async (params: any) => {
      const page = params.page || 1;
      const limit = params.limit || 10;
      const items = sessionsRef.current;
      const total_items = items.length;
      const total_pages = Math.ceil(total_items / limit);
      const startIndex = (page - 1) * limit;
      const paginatedData = items.slice(startIndex, startIndex + limit);

      return {
        success: true,
        data: paginatedData,
        pagination: {
          page,
          limit,
          total_pages,
          total_items,
        },
      };
    },
    // Intentionally empty — uses ref for sessions. This keeps the function identity
    // stable so DataTable's useEffect doesn't re-trigger on every Redux update.
    [],
  );

  // ── We need to tell DataTable to re-call fetchDataForTable when Redux data changes.
  // The DataTable watches `fetchDataFn` identity in its useEffect deps. Since our
  // fetchDataForTable is stable, we use a version counter to create new function identity.
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    setDataVersion((v) => v + 1);
  }, [sessions]);

  // Stable wrapper that changes identity only when data version changes.
  const stableFetchFn = useMemo(() => {
    const fn = async (params: any) => fetchDataForTable(params);
    return fn;
  }, [dataVersion, fetchDataForTable]);

  // ── Delete handlers ───────────────────────────────────────────────────────

  const handleDeleteClick = (id: string) => {
    setSessionToDelete(id);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!sessionToDelete) return;
    setIsDeleting(true);

    try {
      const result = await dispatch(deleteSession(sessionToDelete)).unwrap();
      setIsDeleteDialogOpen(false);
      toast.success("Session deleted.");
    } catch (err: any) {
      if (err?.status === 409) {
        setIsDeleteDialogOpen(false);
        setSessionToForceDelete(sessionToDelete);
        setIsForceDeleteDialogOpen(true);
      } else {
        toast.error("Failed to delete session. Please try again.");
      }
    } finally {
      setIsDeleting(false);
      setSessionToDelete(null);
    }
  };

  const confirmForceDelete = async () => {
    if (!sessionToForceDelete) return;
    setIsForceDeleting(true);
    try {
      await dispatch(forceDeleteSession(sessionToForceDelete)).unwrap();
      toast.success("Session ended and deleted.");
    } catch {
      toast.error("Could not delete session. Please try again.");
    } finally {
      setIsForceDeleting(false);
      setSessionToForceDelete(null);
      setIsForceDeleteDialogOpen(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (bulkIdsToDelete.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const result = await dispatch(bulkDeleteSessions(bulkIdsToDelete)).unwrap();
      setIsBulkDeleteDialogOpen(false);
      setBulkIdsToDelete([]);
      if (result.blocked > 0) {
        toast.warning(
          `${result.blocked} session${result.blocked > 1 ? "s" : ""} could not be deleted because they are still active. End them first.`,
        );
      } else if (result.failed > 0) {
        toast.error(`${result.failed} deletion${result.failed > 1 ? "s" : ""} failed. Please try again.`);
      } else {
        toast.success("Sessions deleted.");
      }
    } catch {
      toast.error("Failed to delete sessions. Please try again.");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ── Column definitions ────────────────────────────────────────────────────
  const columns: ColumnDef<SessionRow>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        enableSorting: false,
        enableHiding: false,
        size: 40,
      },
      {
        accessorKey: "companyName",
        header: "Company Name",
        cell: ({ row }) => (
          <span className="font-bold text-foreground truncate max-w-48 block">
            {row.getValue("companyName") ||
              (row.original as any).company?.name ||
              ""}
          </span>
        ),
      },
      {
        accessorKey: "jobDescription",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm truncate max-w-64 block">
            {row.getValue("jobDescription") || "No description provided"}
          </span>
        ),
      },
      {
        accessorKey: "aiUsage",
        header: "AI Usage",
        cell: ({ row }) => (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-border shadow-[0_2px_4px_rgba(0,0,0,0.05)] text-[13px] font-bold">
            {row.getValue("aiUsage") || "0"}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const rowStatus = row.original.status;
          const isEnded =
            rowStatus === "COMPLETED" ||
            rowStatus === "AUTO_ENDED" ||
            rowStatus === "Ended" ||
            !!row.original.endedAt;
          const statusConfig: Record<
            string,
            { label: string; className: string }
          > = {
            PRE_CHECK: {
              label: "Pending",
              className: "bg-muted text-muted-foreground border-border/60",
            },
            ACTIVE: {
              label: "Active",
              className: "bg-emerald-50 text-emerald-700 border-emerald-300",
            },
            COMPLETING: {
              label: "Processing",
              className: "bg-blue-50 text-blue-700 border-blue-300",
            },
            COMPLETED: {
              label: "Completed",
              className: "bg-muted text-foreground border-border",
            },
            AUTO_ENDED: {
              label: "Auto Ended",
              className: "bg-orange-50 text-orange-700 border-orange-300",
            },
            CREDIT_EXHAUSTED: {
              label: "Out of Credits",
              className: "bg-red-50 text-red-700 border-red-300",
            },
            FORCE_ENDED: {
              label: "Force Ended",
              className: "bg-amber-50 text-amber-700 border-amber-300",
            },
            ABANDONED: {
              label: "Abandoned",
              className: "bg-muted text-muted-foreground border-border",
            },
            Ended: {
              label: "Completed",
              className: "bg-muted text-foreground border-border",
            },
            Active: {
              label: "Active",
              className: "bg-emerald-50 text-emerald-700 border-emerald-300",
            },
          };
          const cfg = rowStatus
            ? statusConfig[rowStatus]
            : isEnded
              ? statusConfig["COMPLETED"]
              : statusConfig["ACTIVE"];
          if (!cfg) return null;
          return (
            <Badge
              variant="outline"
              className={`text-[11px] font-semibold px-2.5 py-0.5 ${cfg.className}`}
            >
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: ({ row }) => {
          const date = new Date(row.getValue("createdAt"));
          return (
            <span className="text-muted-foreground text-sm font-medium whitespace-nowrap">
              {date.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              <span className="text-muted-foreground/60 text-xs">
                {date.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </span>
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2 pr-2">
            {(row.original.status === "PRE_CHECK" ||
              (!row.original.endedAt &&
                row.original.status !== "COMPLETED" &&
                row.original.status !== "AUTO_ENDED" &&
                row.original.status !== "CREDIT_EXHAUSTED" &&
                row.original.status !== "FORCE_ENDED" &&
                row.original.status !== "ABANDONED")) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (!row.original.free && balance) {
                    const available = parseFloat(balance.totalAvailable);
                    if (available <= 0) {
                      setIsOutOfCreditsOpen(true);
                      return;
                    }
                  }
                  navigate(`/sessions/${row.original.id}`, {
                    state: {
                      showConnect: true,
                      connectData: {
                        sessionId: row.original.id,
                        companyName:
                          row.original.companyName ||
                          (row.original as any).company?.name,
                        jobTitle: row.original.jobDescription,
                        // Rejoin must carry the session's SAVED settings.
                        // These were previously hardcoded ("English", false,
                        // "Gemini 2.0 Flash" — not even a valid model id),
                        // which reset the user's wizard choices on rejoin.
                        language: (row.original as any).language || "English",
                        simpleLanguage: !!(row.original as any).simpleLanguage,
                        aiModel: (row.original as any).aiModel,
                        autoGenerateResponse: (row.original as any)
                          .autoGenerateResponse,
                        extraContext: (row.original as any).extraContext,
                      },
                    },
                  });
                }}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Play className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedSessionForAnalytics(row.original);
                setIsAnalyticsDialogOpen(true);
              }}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none"
              disabled={!row.original.endedAt}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setSelectedSessionId(row.original.id);
                setIsTranscriptDialogOpen(true);
              }}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none"
              disabled={!row.original.endedAt}
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteClick(row.original.id)}
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  // Show skeleton only on the very first load. Subsequent updates keep the table visible.
  const isFirstLoad = status === "loading" && !hasFetched;

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <DataTable
        config={{
          enableSearch: true,
          enableDateFilter: true,
          enableExport: true,
          enableColumnVisibility: true,
          enableRowSelection: true,
          searchPlaceholder: "Search by company or role...",
          size: "default",
        }}
        getColumns={() => columns}
        fetchDataFn={stableFetchFn}
        idField="id"
        exportConfig={{
          entityName: "Sessions",
          columnMapping: {
            companyName: "Company Name",
            jobDescription: "Description",
            aiUsage: "AI Usage",
            createdAt: "Created At",
          },
          columnWidths: [{ wch: 20 }, { wch: 40 }, { wch: 10 }, { wch: 15 }],
          headers: ["companyName", "jobDescription", "aiUsage", "createdAt"],
        }}
        fetchByIdsFn={async () => []}
        renderToolbarContent={({ allSelectedIds, totalSelectedCount, resetSelection }) =>
          totalSelectedCount > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5 font-semibold"
              onClick={() => {
                setBulkIdsToDelete(allSelectedIds);
                setIsBulkDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {totalSelectedCount} session{totalSelectedCount > 1 ? "s" : ""}
            </Button>
          ) : null
        }
      />

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={isBulkDeleteDialogOpen} onOpenChange={setIsBulkDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Delete {bulkIdsToDelete.length} Session{bulkIdsToDelete.length > 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground mt-2">
              Are you sure you want to delete the {bulkIdsToDelete.length} selected session{bulkIdsToDelete.length > 1 ? "s" : ""}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setIsBulkDeleteDialogOpen(false)}
              className="px-6 h-11 font-medium rounded-xl"
              disabled={isBulkDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBulkDelete}
              className="px-6 h-11 font-medium rounded-xl"
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? "Deleting..." : `Delete ${bulkIdsToDelete.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              Delete Call Session
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground mt-2">
              Are you sure you want to delete this call session? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="px-6 h-11 font-medium rounded-xl"
              disabled={isDeleting}
            >
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              className="px-6 h-11 font-medium rounded-xl transition-colors"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force-End + Delete Dialog (session still ACTIVE) */}
      <Dialog open={isForceDeleteDialogOpen} onOpenChange={setIsForceDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Session Still Active</DialogTitle>
            <DialogDescription className="text-base text-muted-foreground mt-2">
              This session is currently active or in progress. To delete it, it must be ended first.
              <br /><br />
              Do you want to <strong>force-end and delete</strong> this session?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-3 mt-6">
            <Button
              variant="outline"
              onClick={() => {
                setIsForceDeleteDialogOpen(false);
                setSessionToForceDelete(null);
              }}
              className="px-6 h-11 font-medium rounded-xl"
              disabled={isForceDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmForceDelete}
              className="px-6 h-11 font-medium rounded-xl transition-colors"
              disabled={isForceDeleting}
            >
              {isForceDeleting ? "Ending & Deleting..." : "End & Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TranscriptDialog
        isOpen={isTranscriptDialogOpen}
        onClose={() => {
          setIsTranscriptDialogOpen(false);
          setSelectedSessionId(null);
          if (searchParams.get("view")) {
            const next = new URLSearchParams(searchParams);
            next.delete("view");
            setSearchParams(next, { replace: true });
          }
        }}
        sessionId={selectedSessionId || ""}
        onDelete={(id: string) => {
          setIsTranscriptDialogOpen(false);
          handleDeleteClick(id);
        }}
      />

      <SessionAnalyticsDialog
        isOpen={isAnalyticsDialogOpen}
        onClose={() => {
          setIsAnalyticsDialogOpen(false);
          setSelectedSessionForAnalytics(null);
        }}
        session={selectedSessionForAnalytics}
      />

      <OutOfCreditsDialog
        open={isOutOfCreditsOpen}
        onOpenChange={setIsOutOfCreditsOpen}
        onGetCredits={() => setIsBuyCreditsOpen(true)}
      />

      <BuyCreditsDialog
        open={isBuyCreditsOpen}
        onOpenChange={setIsBuyCreditsOpen}
        onSuccess={refreshBalance}
      />
    </div>
  );
}
