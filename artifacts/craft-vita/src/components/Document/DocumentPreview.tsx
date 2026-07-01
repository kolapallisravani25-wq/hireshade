import { FileTextIcon } from "lucide-react";

interface DocumentPreviewProps {
  document: {
    id: string;
    name: string;
    path?: string;
  } | null;
}

export default function DocumentPreview({ document }: DocumentPreviewProps) {
  if (!document) {
    return (
      <div className="flex h-full min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
        <div className="mb-4 rounded-full bg-muted p-4">
          <FileTextIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mb-1 text-lg font-semibold text-foreground">
          No document selected
        </h3>
        <p className="text-sm text-muted-foreground">
          Click a document to view details and actions
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[400px] flex-col rounded-2xl border border-border bg-card p-0 overflow-hidden">
      {/* Preview Content */}
      <div className="flex flex-1 flex-col items-center justify-center bg-muted/10 p-4 text-center">
        <div className="relative w-full flex-1 rounded-xl border border-border bg-background shadow-sm overflow-hidden">
          <iframe
            src={`${import.meta.env.VITE_BACKEND_URL}/${document.path}`}
            className="h-full w-full border-none"
            title="Document Preview"
          />
        </div>
      </div>
    </div>
  );
}
