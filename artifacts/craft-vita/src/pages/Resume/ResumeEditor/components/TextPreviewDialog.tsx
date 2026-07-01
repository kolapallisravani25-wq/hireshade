import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** Simple scrollable preview dialog for long AI-generated text fields. */
export function TextPreviewDialog({
  title,
  text,
  label,
}: {
  title: string;
  text: string;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="shrink-0 flex items-center justify-center h-7 w-7 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        title={`Preview ${label}`}
      >
        {/* Maximize icon — inline to avoid extra import */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden rounded-2xl">
          <DialogTitle className="px-6 py-4 text-[15px] font-semibold border-b border-border bg-white">
            {title}
          </DialogTitle>
          <div className="px-6 py-5 overflow-y-auto max-h-[70vh]">
            <p className="text-[13px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{text}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
