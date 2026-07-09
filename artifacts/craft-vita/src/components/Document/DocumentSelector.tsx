 ;

import * as React from "react";
import { useStoredUserId } from "@/hooks/useStoredUserId";
import { FileText } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAuthHeaders } from "@/lib/globalAuth";

export interface Document {
  id: string;
  filename: string;
  uploadedAt: string;
  path?: string;
  size?: number | string;
}

interface DocumentSelectorProps {
  onSelect?: (document: Document) => void;
  value?: string;
  className?: string;
  filter?: (document: Document) => boolean;
}

export function DocumentSelector({ onSelect, value, filter }: DocumentSelectorProps) {
  const [documents, setDocuments] = React.useState<Document[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = React.useState<string>(value || "");
  const [loading, setLoading] = React.useState(true);
  const id = useStoredUserId();

  // Use a ref for onSelect to avoid infinite re-fetch when parent passes inline arrow functions
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  React.useEffect(() => {
    if (!id) return;

    setLoading(true);
    const doFetch = async () => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/document/list`, {
        method: "GET",
        headers: { "Content-Type": "application/json", ...authHeaders },
      });
      const response = await res.json();
      let docList: Document[] = Array.isArray(response)
        ? response
        : (response.data ?? []);
      if (filter) {
        docList = docList.filter(filter);
      }
      setDocuments(docList);
    };
    doFetch()
      .catch((err) => console.error("Error fetching documents:", err))
      .finally(() => setLoading(false));
  }, [id, filter]);

  const handleValueChange = (value: string) => {
    setSelectedDocumentId(value);
    const selected = documents.find((doc) => doc.id === value);
    if (selected) {
      onSelect?.(selected);
    }
  };

  const selectedDocument = documents.find((doc) => doc.id === selectedDocumentId);

  return (
    <Select
      value={selectedDocumentId}
      onValueChange={handleValueChange}
      disabled={loading || documents.length === 0}
    >
      <SelectTrigger className="h-12 w-full px-4 rounded-xl border-border/80 bg-background hover:bg-muted/30 transition-all focus:ring-primary/20 py-6">
        <SelectValue
          placeholder={
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg bg-muted text-muted-foreground/80">
                <FileText className="h-5 w-5" />
              </div>
              <span className="truncate text-sm font-medium text-foreground/80">
                {loading
                  ? "Loading documents..."
                  : documents.length > 0
                    ? "Select a document"
                    : "No documents found"}
              </span>
            </div>
          }
        >
          {selectedDocument && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex shrink-0 items-center justify-center h-8 w-8 rounded-lg bg-muted text-muted-foreground/80">
                <FileText className="h-5 w-5" />
              </div>
              <span className="truncate text-sm font-medium text-foreground/80">
                {selectedDocument.filename}
              </span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="rounded-xl border-border/60 shadow-lg">
        {documents.map((doc) => (
          <SelectItem
            key={doc.id}
            value={doc.id}
            className="py-3 px-4 focus:bg-primary/5 focus:text-primary transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="text-sm font-medium">{doc.filename}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(doc.uploadedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
