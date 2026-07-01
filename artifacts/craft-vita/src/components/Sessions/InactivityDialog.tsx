import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Timer } from "lucide-react";

interface InactivityDialogProps {
  isOpen: boolean;
  remainingTime: number;
  onStayActive: () => void;
}

export function InactivityDialog({
  isOpen,
  remainingTime,
  onStayActive,
}: InactivityDialogProps) {
  return (
    <Dialog open={isOpen}>
      <DialogContent className="sm:max-w-md p-8 gap-8 border-none shadow-2xl rounded-3xl">
        <DialogHeader className="flex flex-col items-center text-center gap-6">
          <div className="w-20 h-20 rounded-full bg-amber-50 flex items-center justify-center animate-pulse border border-amber-100">
            <Timer className="w-10 h-10 text-amber-500" />
          </div>
          <div className="space-y-2">
            <DialogTitle className="text-2xl font-bold text-slate-900">
              Are you still there?
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-base font-medium max-w-[280px] mx-auto">
              You've been inactive for a while. To save resources, we'll end
              your session in:
            </DialogDescription>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 bg-amber-500/10 blur-3xl rounded-full" />
            <span className="relative text-3xl font-black text-slate-900 tabular-nums tracking-tighter">
              {remainingTime}
              <span className="text-lg font-semibold text-slate-400 ml-1">
                s
              </span>
            </span>
          </div>
        </DialogHeader>

        <DialogFooter className="flex flex-col sm:flex-row gap-4 pt-4">
          <Button
            onClick={onStayActive}
            className="w-full h-14 rounded-2xl font-bold bg-[#1a1c23] hover:bg-slate-800 text-white shadow-xl shadow-slate-200 text-lg transition-all active:scale-[0.98]"
          >
            I'm Still Here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
