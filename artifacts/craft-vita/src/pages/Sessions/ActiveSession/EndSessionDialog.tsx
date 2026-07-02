import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/globalAuth";

interface EndSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  transcript?: string;
}

export function EndSessionDialog({
  isOpen,
  onClose,
  sessionId,
  transcript = "",
}: EndSessionDialogProps) {
  const navigate = useNavigate();
  const [option, setOption] = React.useState<"exit" | "end">("exit");
  const [isLoading, setIsLoading] = React.useState(false);

  const handleConfirm = async () => {
    if (option === "end") {
      setIsLoading(true);
      try {
        const aiUsage = parseInt(
          localStorage.getItem(`aiUsage_${sessionId}`) || "0",
          10,
        );
        const response = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/deactivate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(await getAuthHeaders()),
            },
            body: JSON.stringify({ transcript, aiUsage }),
          },
        );
        if (!response.ok) {
          console.error("Failed to deactivate session", response.status);
          toast.error(
            "Couldn't end the session — please try again. Leaving without confirming can block starting a new session later.",
          );
          setIsLoading(false);
          // Stay on the dialog so the user can retry, instead of silently
          // navigating away as if the session had actually ended — a failed
          // deactivate here can leave the session ACTIVE in the database,
          // which (with the single-active-session rule) blocks any new
          // session from starting until it's cleared.
          return;
        }
        localStorage.removeItem(`aiUsage_${sessionId}`);
      } catch (error) {
        console.error("Error deactivating session:", error);
        toast.error(
          "Couldn't end the session — check your connection and try again.",
        );
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }
    navigate("/sessions");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-125 p-6 gap-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">End Session</DialogTitle>
          <DialogDescription className="text-slate-500 font-medium pt-1">
            Choose whether to exit the call session or end it permanently.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={option}
          onValueChange={(v) => setOption(v as "exit" | "end")}
          className="grid gap-4"
        >
          {/* Exit Option */}
          <Label
            htmlFor="exit"
            className={cn(
              "flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer hover:bg-slate-50",
              option === "exit"
                ? "border-slate-800 bg-slate-50/50 shadow-sm"
                : "border-slate-100",
            )}
          >
            <RadioGroupItem value="exit" id="exit" className="mt-1" />
            <div className="flex flex-col gap-1.5">
              <span className="font-bold text-slate-900">Exit</span>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">
                Exit call session without ending it. The session will
                automatically end when the timer runs out.
              </p>
            </div>
          </Label>

          {/* End Session Option */}
          <Label
            htmlFor="end"
            className={cn(
              "flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer hover:bg-rose-50/30",
              option === "end"
                ? "border-rose-200 bg-rose-50/50 shadow-sm"
                : "border-slate-100",
            )}
          >
            <RadioGroupItem
              value="end"
              id="end"
              className={cn(
                "mt-1",
                option === "end" && "text-rose-500 border-rose-500",
              )}
            />
            <div className="flex flex-col gap-1.5">
              <span
                className={cn(
                  "font-bold transition-colors",
                  option === "end" ? "text-rose-600" : "text-slate-900",
                )}
              >
                End Session
              </span>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">
                If you end this session you won't be able to restart it.
              </p>
            </div>
          </Label>
        </RadioGroup>

        <DialogFooter className="flex sm:flex-row gap-3 pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl font-bold border-slate-200 hover:bg-slate-50 text-slate-600"
          >
            Close
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex-1 h-12 rounded-xl font-bold bg-[#1a1c23] hover:bg-[#252830] text-white shadow-lg shadow-slate-200"
          >
            {isLoading ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
