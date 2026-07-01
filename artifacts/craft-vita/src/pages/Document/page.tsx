 ;

import { useState, useMemo, useEffect } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Eye, Trash2 } from "lucide-react";
import type { ExportableData } from "@/components/data-table/utils/export-utils";
import { DeleteDocumentDialog } from "@/components/Document/DeleteDocumentDialog";
import DocumentPreview from "@/components/Document/DocumentPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface DocumentData extends ExportableData {
  id: string;
  filename: string;
  uploadedAt: string;
  path?: string;
  size?: number | string;
}

export default function DocumentPage() {
  const userId =
    typeof window !== "undefined" ? localStorage.getItem("userId") : null;
  const [refreshKey, setRefreshKey] = useState(0);

  const [previewDoc, setPreviewDoc] = useState<DocumentData | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const handleRefresh = () => setRefreshKey((prev) => prev + 1);
    window.addEventListener("documentUploaded", handleRefresh);
    return () => window.removeEventListener("documentUploaded", handleRefresh);
  }, []);

  const fetchDocuments = async (params: any) => {
    if (!userId) {
      return {
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total_pages: 1, total_items: 0 },
      };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/document/list`,
        { headers: authHeaders },
      );
      const data = await res.json();
      console.log("🚀 ~ fetchDocuments ~ data:", data);

      if (!res.ok) throw new Error(data.error || "Failed to fetch documents");

      // Handle pagination if required, but list usually returns all for now
      return {
        success: true,
        data: data,
        pagination: {
          page: 1,
          limit: data.length,
          total_pages: 1,
          total_items: data.length,
        },
      };
    } catch (error: any) {
      console.error("Fetch error:", error);
      toast.error(error.message || "Failed to load documents");
      return {
        success: false,
        data: [],
        pagination: { page: 1, limit: 10, total_pages: 1, total_items: 0 },
      };
    }
  };

  const handleDelete = (doc: DocumentData) => {
    setDocToDelete(doc);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!docToDelete) return;

    setIsDeleting(true);
    try {
      const delAuthHeaders = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/document/${docToDelete.id}`,
        {
          method: "DELETE",
          headers: delAuthHeaders,
        },
      );

      if (!res.ok) throw new Error("Failed to delete document");

      toast.success("Document deleted successfully");
      setIsDeleteDialogOpen(false);
      setDocToDelete(null);
      setRefreshKey((prev) => prev + 1);
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error(error.message || "Failed to delete document");
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: ColumnDef<DocumentData>[] = useMemo(
    () => [
      {
        accessorKey: "filename",
        header: "Document Name",
        cell: ({ row }) => (
          <span className="font-medium text-foreground truncate max-w-75 block">
            {row.getValue("filename")}
          </span>
        ),
      },
      {
        accessorKey: "uploadedAt",
        header: "Uploaded Date",
        cell: ({ row }) => {
          const dateString = row.getValue("uploadedAt") as string;
          const date = new Date(dateString);
          return (
            <span className="text-muted-foreground text-sm font-medium">
              {date.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-2 pr-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setPreviewDoc(row.original);
                setIsPreviewOpen(true);
              }}
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => handleDelete(row.original)}
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete Document"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="">
        <DataTable
          key={refreshKey}
          config={{
            enableSearch: true,
            enableDateFilter: false,
            enableExport: false,
            enableColumnVisibility: true,
            enableRowSelection: false,
            searchPlaceholder: "Search documents...",
            size: "default",
          }}
          getColumns={() => columns}
          fetchDataFn={fetchDocuments}
          idField="id"
        />
      </div>

      {/* Preview Dialog */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="min-w-5xl w-[95vw] h-[95vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>Document: {previewDoc?.filename}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden mt-4 w-full">
            {previewDoc && (
              <DocumentPreview
                document={{
                  id: previewDoc.id,
                  name: previewDoc.filename,
                  path: previewDoc.path,
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <DeleteDocumentDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        documentName={docToDelete?.filename || ""}
        isDeleting={isDeleting}
      />
    </div>
  );
}
