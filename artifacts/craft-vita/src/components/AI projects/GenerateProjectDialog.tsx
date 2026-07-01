import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResumeSelector, Resume } from "@/components/Resume/ResumeSelector";
import { Sparkles, Briefcase, FileText } from "lucide-react";
import { useAuth } from "@clerk/clerk-react";

export function GenerateProjectDialog() {
  const { getToken } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [sector, setSector] = React.useState("");
  const [selectedResumeId, setSelectedResumeId] = React.useState<string | null>(
    null,
  );
  const [jobDescription, setJobDescription] = React.useState("");
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [generatedProjects, setGeneratedProjects] = React.useState<any[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const handleResumeSelect = (resume: Resume | null) => {
    setSelectedResumeId(resume?.id || null);
  };

  const handleGenerate = async () => {
    const token = await getToken();
    if (!token) {
      setError("Authentication required");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedProjects([]);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/projects/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            resumeId: selectedResumeId,
            sector,
            ...(jobDescription.trim()
              ? { jobDescription: jobDescription.trim() }
              : {}),
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to generate projects");
      }

      if (!response.body) {
        throw new Error("ReadableStream not supported");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by the unique delimiter and process each project
        const DELIMITER = "|||PROJECT_END|||";
        const parts = buffer.split(DELIMITER);
        // Keep the last partial part in the buffer
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmedPart = part.trim();
          if (trimmedPart) {
            try {
              const project = JSON.parse(trimmedPart);
              setGeneratedProjects((prev) => [...prev, project]);
            } catch (e) {
              console.error("Failed to parse project JSON:", e, trimmedPart);
            }
          }
        }
      }

      // Final close and cleanup
      console.log("Generation complete!");
      // Optionally refresh the table or redirect
      // setOpen(false); 
    } catch (err: any) {
      console.error("Generation error:", err);
      setError(err.message || "An error occurred during generation");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 rounded-xl h-10 px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium">
          <Sparkles className="h-4 w-4" />
          Generate Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] rounded-2xl border-border/60 shadow-xl">
        <DialogHeader className="gap-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <DialogTitle className="text-xl font-semibold">
              Generate AI Project
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            Fill in the details below to generate a tailored project based on
            your resume.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid gap-2.5">
            <Label
              htmlFor="resume"
              className="text-sm font-medium flex items-center gap-2"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              Select Resume
              <span className="text-destructive">*</span>
            </Label>
            <ResumeSelector onSelect={handleResumeSelect} />
          </div>
          <div className="grid gap-2.5">
            <Label
              htmlFor="sector"
              className="text-sm font-medium flex items-center gap-2"
            >
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Sector{" "}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </Label>
            <Input
              id="sector"
              placeholder="e.g. Banking and Finance"
              className="h-10 rounded-xl bg-background border-border/80 focus-visible:ring-primary/20"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
            />
          </div>
          <div className="grid gap-2.5">
            <Label htmlFor="jobDescription" className="text-sm font-medium">
              Job Description <span className="text-muted-foreground font-normal">(Optional)</span>
            </Label>
            <textarea
              id="jobDescription"
              placeholder="Paste JD if you want extra targeting."
              className="min-h-[96px] rounded-xl border border-border/80 bg-background px-3 py-2 text-sm"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex flex-col sm:flex-row justify-between gap-4">
          <div className="flex-1 text-sm text-muted-foreground flex items-center gap-2">
            {isGenerating && (
              <>
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                Generating projects ({generatedProjects.length}/3)...
              </>
            )}
            {error && <span className="text-destructive">{error}</span>}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isGenerating}
              className="rounded-xl h-10 px-4"
            >
              {generatedProjects.length > 0 ? "Close" : "Cancel"}
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!selectedResumeId || isGenerating}
              className="rounded-xl h-10 px-6 gap-2"
            >
              {isGenerating ? (
                <>
                  <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Project
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
