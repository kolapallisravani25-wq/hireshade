import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface OutOfCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGetCredits: () => void;
}

export function OutOfCreditsDialog({
  open,
  onOpenChange,
  onGetCredits,
}: OutOfCreditsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] sm:max-w-md lg:max-w-[540px] border-none shadow-2xl rounded-3xl p-0 overflow-hidden bg-background">
        <div className="p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-6 border border-amber-100">
            <AlertCircle className="h-6 w-6" />
          </div>
          
          <DialogHeader className="p-0 text-left">
            <DialogTitle className="text-2xl font-bold tracking-tight">
              Out of Call Credits
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground mt-2 leading-relaxed">
              You don't have any Call Credits. To start a Call Session you need to get some credits.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-row justify-end gap-3 mt-8">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="px-6 h-12 font-semibold rounded-2xl border-border hover:bg-muted/50 transition-all"
            >
              Close
            </Button>
            <Button
              onClick={() => {
                onOpenChange(false);
                onGetCredits();
              }}
              className="px-10 h-12 font-bold rounded-2xl bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 dark:hover:bg-white/90 shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] active:scale-95 transition-all"
            >
              Get Credits
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
