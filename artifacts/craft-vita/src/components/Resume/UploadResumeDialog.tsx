import { useState, useRef } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";
import { UploadIcon, FileIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const isTauri = () => typeof window !== "undefined" && "__TAURI__" in window;
const API = import.meta.env.VITE_BACKEND_URL || "";

interface UploadResumeDialogProps {
  userId: string;
  triggerClassName?: string;
}

export default function UploadResumeDialog({
  userId,
  triggerClassName,
}: UploadResumeDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setFile(null);
    setLoading(false);
    setIsDragging(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!loading) {
      setOpen(newOpen);
      if (!newOpen) resetState();
    }
  };

  // ── Validate File ──────────────────────────
  const validateFile = (file: File) => {
    const allowed = ["application/pdf"];

    if (!allowed.includes(file.type)) {
      alert("Only PDF files are allowed");
      return false;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File too large (Max 10MB)");
      return false;
    }

    return true;
  };

  // ── Handle File Selection ──────────────────
  const handleFileSelect = (selectedFile: File) => {
    if (validateFile(selectedFile)) {
      setFile(selectedFile);
    }
  };

  // ── Tauri Upload ───────────────────────────
  const handleTauriUpload = async () => {
    const [{ open: tauriOpen }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const selected = await tauriOpen({
      multiple: false,
      filters: [{ name: "Resume", extensions: ["pdf"] }],
    });

    if (!selected) return;

    const contents = await readFile(selected);
    const fileName = selected.split(/[\\/]/).pop() || "resume.pdf";

    const newFile = new File([contents], fileName, {
      type: "application/pdf",
    });

    handleFileSelect(newFile);
  };

  const handleWebUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) handleFileSelect(selectedFile);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClick = () => {
    if (loading || file) return;
    if (isTauri()) {
      handleTauriUpload();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!file && !loading) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (loading || file) return;

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  // ── Upload to Backend ──────────────────────
  const uploadToServer = async () => {
    if (!file) return;

    setLoading(true);

    const formData = new FormData();
    formData.append("resume", file);
    formData.append("userId", userId);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${API}/api/resume/upload`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || `Upload failed (${res.status})`);
      }

      console.log("Uploaded:", data);
      // Dispatch event for ListOfResumes to listen and refresh
      window.dispatchEvent(new Event("resumeUploaded"));
      setOpen(false);
      resetState();
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!userId) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          className={cn(
            "gap-2 border border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground",
            triggerClassName,
          )}
        >
          <UploadIcon className="h-4 w-4" />
          Upload Resume
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Resume</DialogTitle>
          <DialogDescription className="hidden">
            Select a PDF or DOCX file to add to your previously uploaded
            resumes.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {!file ? (
            <div className="w-full">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleWebUpload}
              />
              <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card p-10 transition-all duration-200 ease-in-out",
                  "hover:bg-muted/50",
                  isDragging && "border-primary bg-muted ring-4 ring-primary/5",
                  loading && "opacity-60 cursor-not-allowed",
                )}
              >
                <div className="mb-4 flex items-center justify-center">
                  <UploadIcon className="h-10 w-10 text-gray-400" />
                </div>
                <div className="text-center">
                  <p className="text-lg font-semibold text-foreground">
                    Drop files here or click to upload
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    PDF &bull; Max 10 MB
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 border rounded-xl bg-muted/30">
              <div className="flex items-center gap-3 overflow-hidden">
                <FileIcon className="h-8 w-8 text-primary flex-shrink-0" />
                <div className="overflow-hidden">
                  <p className="font-medium text-sm truncate max-w-[200px] sm:max-w-[250px]">
                    {file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setFile(null)}
                disabled={loading}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between flex-row justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
            className="rounded-xl font-semibold px-6 h-10"
          >
            Cancel
          </Button>
          <Button
            onClick={uploadToServer}
            disabled={!file || loading}
            className="font-semibold rounded-xl px-6 h-10 shadow-md"
          >
            {loading ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
