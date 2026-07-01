import { useState, useRef } from "react";
import { getAuthHeaders } from "@/lib/globalAuth";
import { UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const isTauri = () => typeof window !== "undefined" && "__TAURI__" in window;

const API = import.meta.env.VITE_BACKEND_URL || "";

export default function ResumeUpload({ userId }: { userId: string }) {
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Validate File ──────────────────────────
  const validateFile = (file: File) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowed.includes(file.type)) {
      setStatus("❌ Only PDF, DOC, DOCX allowed");
      return false;
    }

    if (file.size > 10 * 1024 * 1024) {
      setStatus("❌ File too large (Max 10MB)");
      return false;
    }

    return true;
  };

  // ── Upload to Backend ──────────────────────
  const uploadToServer = async (file: File) => {
    if (!validateFile(file)) return;

    setLoading(true);
    setStatus("⏳ Uploading...");

    const formData = new FormData();
    formData.append("resume", file);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${API}/api/resume/upload`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      console.log("Uploaded:", data);

      setStatus("✅ Resume uploaded successfully");

      // Tell ListOfResumes to refetch
      window.dispatchEvent(new Event("resumeUploaded"));

      // 🔥 Reset input so same file can be uploaded again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setStatus(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Tauri Upload ───────────────────────────
  const handleTauriUpload = async () => {
    const [{ open }, { readFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const selected = await open({
      multiple: false,
      filters: [{ name: "Resume", extensions: ["pdf", "doc", "docx"] }],
    });

    if (!selected) return;

    const contents = await readFile(selected);

    const fileName = selected.split(/[\\/]/).pop() || "resume.pdf";

    const file = new File([contents], fileName, {
      type: "application/pdf",
    });

    await uploadToServer(file);
  };

  // ── Web Upload ─────────────────────────────
  const handleWebUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadToServer(file);
  };

  // ── Click Handler ──────────────────────────
  const handleClick = () => {
    if (loading) return;

    if (isTauri()) {
      handleTauriUpload();
    } else {
      fileInputRef.current?.click();
    }
  };

  // ── Drag & Drop ────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      await uploadToServer(file);
    }
  };

  return (
    <div className="w-full">
      {/* Hidden Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={handleWebUpload}
      />

      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card p-12 transition-all duration-200 ease-in-out",
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
            {loading ? "Uploading..." : "Drop files here or click to upload"}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            PDF, DOCX • Max 10 MB
          </p>
        </div>

        {status && (
          <div
            className={cn(
              "mt-4 rounded-full px-4 py-1 text-xs font-medium",
              status.includes("✅")
                ? "bg-green-500/10 text-green-700"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
