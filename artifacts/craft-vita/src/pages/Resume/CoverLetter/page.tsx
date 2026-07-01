import * as React from "react";
import { ResumeSelector } from "@/components/Resume/ResumeSelector";
import { JobDetails } from "@/components/Resume/JobDetails";
import { ToneSelection } from "@/components/Resume/ToneSelection";
import { GeneratedLetter } from "@/components/Resume/GeneratedLetter";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { jsPDF } from "jspdf";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getAuthHeaders } from "@/lib/globalAuth";

export default function CoverLetter() {
  const [loading, setLoading] = React.useState(false);
  const [content, setContent] = React.useState<string | undefined>(undefined);

  // State for generation parameters
  const [selectedResumeId, setSelectedResumeId] = React.useState<string>("");
  const [jobDetails, setJobDetails] = React.useState({
    role: "",
    company: "",
    description: "",
  });
  const [tone, setTone] = React.useState("professional");

  const handleGenerate = async () => {
    if (!selectedResumeId) {
      alert("Please select a resume");
      return;
    }

    if (!jobDetails.role || !jobDetails.company) {
      alert("Please fill job role and company");
      return;
    }

    setLoading(true);
    setContent(undefined);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/resume/generate-cover-letter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await getAuthHeaders()),
          },
          body: JSON.stringify({
            resumeId: selectedResumeId,
            jobRole: jobDetails.role,
            company: jobDetails.company,
            jobDescription: jobDetails.description,
            tone,
          }),
        },
      );

      const data = await response.json();
      console.log("🚀 ~ handleGenerate ~ data:", data);

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate");
      }

      setContent(data.coverLetter);
    } catch (err: any) {
      console.error("Error generating cover letter:", err);
      setContent("❌ Failed to generate cover letter. Try again.");
    } finally {
      setLoading(false);
    }
  };
  const handleRetry = () => {
    setContent(undefined);
    handleGenerate();
  };
  const handleExport = () => {
    if (!content) return;

    const doc = new jsPDF();

    // PDF Configuration
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - 2 * margin;

    // Set Font
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);

    // Split text to fit page width
    const splitText = doc.splitTextToSize(content, contentWidth);

    // Initial cursor position
    let cursorY = margin;
    const lineHeight = 7; // Approx line height for font size 12

    splitText.forEach((line: string) => {
      if (cursorY + lineHeight > pageHeight - margin) {
        doc.addPage();
        cursorY = margin;
      }
      doc.text(line, margin, cursorY);
      cursorY += lineHeight;
    });

    // Save PDF
    const fileName = `Cover_Letter_${jobDetails.company || "Generated"}.pdf`;
    doc.save(fileName);
  };

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto">
      {/* <div className="space-y-4">
        <Link
          to="/resume/all"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Resume Manager
        </Link>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-foreground/90">
            Cover Letter Generator
          </h1>
          <p className="text-muted-foreground">
            Generate a tailored cover letter for any role using your resume.
          </p>
        </div>
      </div> */}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <div className="lg:col-span-3 space-y-6">
          <Card className={cn("w-full shadow-none border-border/50")}>
            <CardHeader className="py-4 px-6 border-b border-border/40">
              <CardTitle className="text-sm font-semibold text-foreground/90">
                Resume to Use
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <ResumeSelector
                onSelect={(resume) => setSelectedResumeId(resume.id)}
                includeBuilderResumes
              />
            </CardContent>
          </Card>
          <JobDetails onChange={setJobDetails} />
          <ToneSelection onSelect={setTone} />

          <Button
            onClick={handleGenerate}
            disabled={loading || !selectedResumeId}
            className="w-full py-6 rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-90 transition-all font-semibold shadow-lg shadow-black/5"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generating...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Generate Cover Letter
              </div>
            )}
          </Button>
        </div>

        <div className="lg:col-span-2 h-full min-h-[600px]">
          <GeneratedLetter
            content={content}
            loading={loading}
            onRetry={handleRetry}
            onCopy={() => {
              if (content) {
                navigator.clipboard.writeText(content);
                // Could add toast notification here
              }
            }}
            onExport={handleExport}
          />
        </div>
      </div>
    </div>
  );
}
