 ;

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DeleteResumeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  resumeName: string;
  isDeleting: boolean;
}

export function DeleteResumeDialog({
  isOpen,
  onClose,
  onConfirm,
  resumeName,
  isDeleting,
}: DeleteResumeDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(_) => !isDeleting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle>Delete Resume</DialogTitle>
          </div>
          <DialogDescription className="text-base">
            Are you sure you want to delete <strong>{resumeName}</strong>?
            <br />
            This action is permanent and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 sm:justify-end gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded-xl min-w-25"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
