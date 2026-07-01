import { useState, useRef } from "react";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const isTauri = () => typeof window !== "undefined" && "__TAURI__" in window;

const API = import.meta.env.VITE_BACKEND_URL || "";

export default function UploadButton({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Validate File ──────────────────────────
  const validateFile = (file: File) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowed.includes(file.type)) {
      alert("Only PDF, DOC, DOCX allowed");
      return false;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("File too large (Max 10MB)");
      return false;
    }

    return true;
  };

  // ── Upload to Backend ──────────────────────
  const uploadToServer = async (file: File) => {
    if (!validateFile(file)) return;

    setLoading(true);

    const formData = new FormData();
    formData.append("resume", file);
    formData.append("userId", userId);

    try {
      const res = await fetch(`${API}/api/resume/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      console.log("Uploaded:", data);

      // Trigger list refresh
      window.dispatchEvent(new Event("resumeUploaded"));

      // Reset input so same file can be uploaded again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error.message}`);
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

  if (!userId) {
    return null;
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={handleWebUpload}
      />
      <Button
        onClick={handleClick}
        disabled={loading}
        size="sm"
        className="gap-2 bg-black text-white hover:bg-black/90 rounded-lg px-4"
      >
        <UploadIcon className="h-4 w-4" />
        {loading ? "Uploading..." : "Upload Resume"}
      </Button>
    </>
  );
}
