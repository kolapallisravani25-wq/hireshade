 ;

import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ResumeSelector } from "@/components/Resume/ResumeSelector";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/globalAuth";

export function ATSAnalysisDialog() {
  const [open, setOpen] = React.useState(false);
  const [selectedResumeId, setSelectedResumeId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const navigate = useNavigate();

  const handleCheckATS = async () => {
    if (!selectedResumeId) {
      toast.error("Please select a resume first");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/resume/ats-score`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify({
            resumeId: selectedResumeId,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze resume");
      }

      setOpen(false);
      navigate("/resume/ats-result", { state: { analysis: data } });
    } catch (error: any) {
      console.error("ATS Analysis error:", error);
      toast.error(error.message || "Something went wrong during analysis");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 px-6 py-6 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all font-semibold shadow-lg">
          <Search className="h-5 w-5" />
          Check ATS
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg border-none shadow-2xl rounded-2xl p-0 overflow-hidden">
        <DialogHeader className="pt-8 px-8 bg-muted/20">
          <DialogTitle className="text-2xl font-bold tracking-tight">
            ATS Compatibility Check
          </DialogTitle>
        </DialogHeader>
        <div className="p-8 space-y-2">
          <ResumeSelector
            onSelect={(resume) => setSelectedResumeId(resume.id)}
            filter={(resume) => !resume.ats}
          />

          <div className="flex items-center justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="rounded-xl px-6 h-12 border-border/60 hover:bg-muted/30"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCheckATS}
              disabled={loading || !selectedResumeId}
              className="rounded-xl px-8 h-12 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all font-semibold"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Analyzing...
                </div>
              ) : (
                "Check ATS"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
