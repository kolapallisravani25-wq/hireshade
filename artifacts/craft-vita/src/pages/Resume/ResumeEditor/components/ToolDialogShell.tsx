import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Consistent modal shell for all AI tool dialogs.
 * Accepts an optional className to override the default max-width
 * (e.g. "max-w-3xl" for the wider Inject Skills panel).
 */
export function ToolDialogShell({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        forceMount
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className={cn(
          "w-full max-w-[calc(100vw-2rem)] sm:max-w-[640px] md:max-w-[720px] lg:max-w-[780px] p-0 gap-0",
          className,
        )}
      >
        <DialogTitle className="sr-only">AI Tool</DialogTitle>
        <div className="flex flex-col h-[90vh] overflow-hidden rounded-2xl">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
