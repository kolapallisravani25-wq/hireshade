import { DocumentSelector, Document } from "@/components/Document/DocumentSelector";
import { FileText, CheckCircle2 } from "lucide-react";

interface Step3Props {
  onSelect: (document: Document | null) => void;
  selectedDocumentId: string | null;
}

export function Step3_DocumentSelector({ onSelect, selectedDocumentId }: Step3Props) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
          Extra Documents
        </h2>
        <p className="text-sm text-muted-foreground">
          Select any extra context or search notes for this session.
        </p>
      </div>

      <div className="p-4 rounded-2xl border bg-muted/25 space-y-4">
        <div className="flex items-center gap-2 px-1">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Your Documents</span>
        </div>
        <DocumentSelector onSelect={onSelect} value={selectedDocumentId || undefined} />
      </div>

      {selectedDocumentId && (
        <div className="flex items-center gap-3 p-4 border rounded-2xl bg-green-50/50 border-green-100 text-green-700 animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">Document selected and ready to use.</p>
        </div>
      )}
    </div>
  );
}
