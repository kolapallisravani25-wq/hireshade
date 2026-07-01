import * as React from "react";
import { useAuth } from "@clerk/clerk-react";
import { Resume } from "@/components/Resume/ResumeSelector";
import { ENDPOINTS } from "@/lib/endpoints";
import { FileText, CheckCircle2, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step2Props {
  onSelect: (resume: Resume | null) => void;
  selectedResumeId: string | null;
}

export function Step2_ResumeSelector({ onSelect, selectedResumeId }: Step2Props) {
  const { getToken } = useAuth();
  const [resumes, setResumes] = React.useState<Resume[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const token = await getToken();
        const [uploadedRes, builderRes] = await Promise.all([
          fetch(ENDPOINTS.resumeList(userId), {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }),
          fetch(ENDPOINTS.resumeBuilderList(userId), {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }),
        ]);

        const uploadedJson = await uploadedRes.json().catch(() => ({}));
        const builderJson = await builderRes.json().catch(() => ({}));

        const uploaded: Resume[] = (Array.isArray(uploadedJson)
          ? uploadedJson
          : uploadedJson.data ||
            uploadedJson.resumes ||
            [])
          .map((item: Resume) => ({ ...item, source: "uploaded" as const }));

        const builder: Resume[] = (
          Array.isArray(builderJson)
            ? builderJson
            : builderJson.data ||
              builderJson.resumes ||
              []
        ).map((item: { id: string; title?: string; updatedAt?: string; createdAt?: string }) => ({
          id: item.id,
          filename: item.title || "Untitled Resume",
          path: "",
          ats: false,
          source: "builder" as const,
          uploadedAt: item.updatedAt || item.createdAt || "",
        }));

        const combined = [...uploaded, ...builder].sort((a, b) => {
          const ta = new Date(a.uploadedAt || 0).getTime();
          const tb = new Date(b.uploadedAt || 0).getTime();
          return tb - ta;
        });

        if (!cancelled) setResumes(combined);
      } catch {
        if (!cancelled) setResumes([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const selectedResume = React.useMemo(
    () => resumes.find((r) => r.id === selectedResumeId) || null,
    [resumes, selectedResumeId],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-foreground">Select a Resume</h2>
        <p className="text-sm text-muted-foreground">
          Choose the resume you would like to use for this session.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border bg-muted/25 p-5">
        <div className="flex items-center gap-2 px-1">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Your Resumes</span>
          <span className="ml-auto rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {resumes.length} {resumes.length === 1 ? "resume" : "resumes"}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <div className="h-16 rounded-2xl border bg-background animate-pulse" />
            <div className="h-16 rounded-2xl border bg-background animate-pulse" />
          </div>
        ) : resumes.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-background p-5 text-sm text-muted-foreground">
            No resumes found. Upload or build a resume first.
          </div>
        ) : (
          <div className="max-h-80 space-y-2.5 overflow-y-auto pr-1">
            {resumes.map((resume) => {
              const isSelected = selectedResumeId === resume.id;
              return (
                <button
                  key={resume.id}
                  type="button"
                  onClick={() => onSelect(resume)}
                  className={cn(
                    "group w-full rounded-2xl border p-4 text-left shadow-sm transition-all",
                    "hover:-translate-y-px hover:border-primary/40 hover:bg-primary/[0.03] hover:shadow",
                    isSelected
                      ? "border-primary bg-primary/[0.06] ring-1 ring-primary/20 shadow"
                      : "border-border bg-background",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "shrink-0 rounded-lg border p-2 text-muted-foreground transition-colors",
                          isSelected ? "border-primary/30 bg-primary/10 text-primary" : "border-transparent bg-muted",
                        )}
                      >
                        {resume.source === "builder" ? (
                          <PencilLine className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {resume.filename}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="rounded-full border bg-background px-2 py-0.5 font-medium">
                            {resume.source === "builder" ? "Builder" : "Uploaded"}
                          </span>
                          {resume.uploadedAt ? <span className="truncate">{resume.uploadedAt}</span> : null}
                        </div>
                      </div>
                    </div>

                    {isSelected ? (
                      <div className="rounded-full bg-primary/10 p-1">
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                      </div>
                    ) : (
                      <div className="h-7 w-7 shrink-0 rounded-full border border-transparent transition-colors group-hover:border-primary/20" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedResumeId && (
        <div className="flex items-center gap-3 p-4 border rounded-2xl bg-green-50/50 border-green-100 text-green-700 animate-in fade-in slide-in-from-top-2 duration-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            {selectedResume?.filename || "Resume"} selected and ready to use.
          </p>
        </div>
      )}
    </div>
  );
}
