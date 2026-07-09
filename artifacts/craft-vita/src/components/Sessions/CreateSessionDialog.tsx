import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Zap, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Sub-components
import {
  Step1_JobDetails,
  JOB_DESCRIPTION_REGEX,
} from "./steps/Step1_JobDetails";
import { Step2_ResumeSelector } from "./steps/Step2_ResumeSelector";
import { Step3_DocumentSelector } from "./steps/Step3_DocumentSelector";
import { Step4_AIProjects } from "./steps/Step4_AIProjects";
import { Step4_LanguageAISettings as Step5_LanguageAISettings } from "./steps/Step4_LanguageAISettings";
import { Step5_AutoGenerateAI as Step6_AutoGenerateAI } from "./steps/Step5_AutoGenerateAI";
import { Step6_SaveTranscript as Step7_SaveTranscript } from "./steps/Step6_SaveTranscript";
import { Step7_Review as Step8_Review } from "./steps/Step7_Review";
import { type Resume } from "@/components/Resume/ResumeSelector";
import { type Document } from "@/components/Document/DocumentSelector";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/globalAuth";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { OutOfCreditsDialog } from "@/components/Billing/OutOfCreditsDialog";
import { BuyCreditsDialog } from "@/components/Billing/BuyCreditsDialog";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface CreateSessionDialogProps {
  isFree?: boolean;
  defaultOpen?: boolean;
}

const INITIAL_SESSION_DATA = {
  companyName: "",
  round: "",
  jobDescription: "",
  selectedResume: null as Resume | null,
  selectedDocument: null as Document | null,
  selectedProjectIds: [] as string[],
  primaryProjectId: "",
  language: "English",
  simpleLanguage: false,
  extraContext: "",
  instructions: "",
  aiModel: "anthropic/claude-haiku-4-5",
  autoGenerateAI: true,
  saveTranscript: true,
  questionBankContributionOptIn: false,
};


export default function CreateSessionDialog({
  isFree = false,
  defaultOpen = false,
}: CreateSessionDialogProps) {
  const navigate = useNavigate();
  const { user } = useUser();
  const [open, setOpen] = React.useState(defaultOpen);
  const [step, setStep] = React.useState<Step>(1);
  const [loading, setLoading] = React.useState(false);
  const [createdSessionId, setCreatedSessionId] = React.useState<string | null>(
    null,
  );

  // Credit check states
  const { balance, isLoading: isBalanceLoading, refresh: refreshBalance } = useCreditsBalance();
  const [isOutOfCreditsOpen, setIsOutOfCreditsOpen] = React.useState(false);
  const [isBuyCreditsOpen, setIsBuyCreditsOpen] = React.useState(false);

  // State for all steps
  const [sessionData, setSessionData] = React.useState(INITIAL_SESSION_DATA);

  const updateData = (field: string, value: any) => {
    setSessionData((prev) => ({ ...prev, [field]: value }));
  };

  const updateSaveTranscript = (saveTranscript: boolean) => {
    setSessionData((previous) => ({
      ...previous,
      saveTranscript,
      questionBankContributionOptIn: saveTranscript
        ? previous.questionBankContributionOptIn
        : false,
    }));
  };

  const handleNext = () => {
    if (step === 4 && sessionData.selectedProjectIds.length === 2 && !sessionData.primaryProjectId) {
      toast.error("Please select a primary project.");
      return;
    }
    if (step < 8) {
      setStep((curr) => (curr + 1) as Step);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep((curr) => (curr - 1) as Step);
    }
  };

  const resetDialog = () => {
    setStep(1);
    setLoading(false);
    setSessionData(INITIAL_SESSION_DATA);
    setCreatedSessionId(null);
  };

  const createSession = async () => {
    setLoading(true);
    // Prefer the synced backend id, but fall back to the Clerk user id so a
    // cleared localStorage (e.g. after a data wipe) doesn't block creation.
    // (The backend authorizes via the token regardless; this is just a guard.)
    const userId = localStorage.getItem("userId") ?? user?.id ?? null;

    if (!userId) {
      toast.error("Couldn't start the session — please sign in again.");
      setLoading(false);
      return;
    }

    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("free", isFree.toString());
    formData.append("companyName", sessionData.companyName);
    formData.append("round", sessionData.round);
    formData.append("jobDescription", sessionData.jobDescription);
    formData.append("resumeId", sessionData.selectedResume?.id || "");
    formData.append("documentId", sessionData.selectedDocument?.id || "");
    formData.append("projectIds", JSON.stringify(sessionData.selectedProjectIds));
    if (sessionData.primaryProjectId) {
      formData.append("primaryProjectId", sessionData.primaryProjectId);
    }
    formData.append("language", sessionData.language);
    formData.append("simpleLanguage", sessionData.simpleLanguage.toString());
    formData.append("extraContext", sessionData.extraContext);
    formData.append("instructions", sessionData.instructions);
    formData.append("aiModel", sessionData.aiModel);
    formData.append("autoGenerateAI", sessionData.autoGenerateAI.toString());
    formData.append("saveTranscript", sessionData.saveTranscript.toString());
    formData.append(
      "questionBankContributionOptIn",
      sessionData.questionBankContributionOptIn.toString(),
    );

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/session/create-session`,
        {
          method: "POST",
          headers: authHeaders,
          body: formData,
        },
      );

      const result = await response.json();

      if (response.ok) {
        const newSessionId = result.id || result.sessionId || "";
        setCreatedSessionId(newSessionId);
        setOpen(false);
        resetDialog();
        // Redirect to ActiveSession page and show ConnectDialog there
        navigate(`/sessions/${newSessionId}`, {
          state: {
            showConnect: true,
            connectData: {
              sessionId: newSessionId,
              companyName: sessionData.companyName,
              round: sessionData.round,
              jobTitle: sessionData.jobDescription.slice(0, 60),
              extraContext: sessionData.instructions,
              language: sessionData.language,
              simpleLanguage: sessionData.simpleLanguage,
              aiModel: sessionData.aiModel,
              saveTranscript: sessionData.saveTranscript,
              questionBankContributionOptIn:
                sessionData.questionBankContributionOptIn,
            },
          },
        });
      } else if (response.status === 409 && (result.message ?? "").startsWith("ACTIVE_SESSION_EXISTS")) {
        const existingId = (result.message as string).split(":")[1];
        toast.error("You already have an active session. End it before starting a new one.", {
          action: existingId
            ? { label: "Go to session", actionButtonStyle: {}, onClick: () => navigate(`/sessions/${existingId}`) }
            : undefined,
          duration: 8000,
        });
      } else {
        console.error("Failed to create session:", result.error);
        toast.error(result.error || "Failed to create session");
      }
    } catch (error) {
      console.error("Error creating session:", error);
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    if (!isFree) {
      // While balance is still loading, don't open anything
      if (isBalanceLoading || balance === null) {
        e.preventDefault();
        return;
      }
      const available = parseFloat(balance.totalAvailable);
      if (available <= 0) {
        e.preventDefault();
        setIsOutOfCreditsOpen(true);
        return;
      }
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        onClick={handleTriggerClick}
        disabled={!isFree && isBalanceLoading}
        className={cn(
          "gap-2 px-6 py-6 rounded-xl font-semibold shadow-lg transition-all active:scale-95",
          isFree
            ? "bg-white text-black border border-black/10 hover:bg-gray-50"
            : "bg-black text-white hover:bg-black/90",
        )}
      >
        {isFree ? (
          <Zap className="h-4 w-4 text-amber-500 fill-amber-500" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {isFree ? "Start Free Session" : "Start Session"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) resetDialog();
        }}
      >

        <DialogContent className="sm:max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col gap-0 border-none shadow-2xl rounded-3xl p-0 overflow-hidden bg-background" aria-describedby={undefined}>
          <DialogHeader className="shrink-0 pt-6 px-8 pb-0 relative">
            <div className="flex items-center justify-between mb-2">
              <div className="space-y-1">
                <DialogTitle className="text-2xl font-bold tracking-tight">
                  {step === 1 && "Job Details"}
                  {step === 2 && "Select Resume"}
                  {step === 3 && "Extra Documents"}
                  {step === 4 && "AI Projects"}
                  {step === 5 && "AI Customization"}
                  {step === 6 && "AI Response"}
                  {step === 7 && "Save Session"}
                  {step === 8 && "Final Review"}
                </DialogTitle>
                <p className="text-sm text-muted-foreground">
                  Step {step} of 8
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 mb-0">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1 rounded-full transition-all duration-500 ease-out",
                    step === i
                      ? "w-8 bg-primary shadow-[0_0_8px_rgba(var(--primary),0.4)]"
                      : step > i
                        ? "w-3 bg-primary/40"
                        : "w-3 bg-muted",
                  )}
                />
              ))}
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-8 pb-8 pt-4">
            {step === 1 && (
              <Step1_JobDetails data={sessionData} onChange={updateData} />
            )}

            {step === 2 && (
              <Step2_ResumeSelector
                selectedResumeId={sessionData.selectedResume?.id || null}
                onSelect={(resume) => updateData("selectedResume", resume)}
              />
            )}

            {step === 3 && (
              <Step3_DocumentSelector
                selectedDocumentId={sessionData.selectedDocument?.id || null}
                onSelect={(doc) => updateData("selectedDocument", doc)}
              />
            )}

            {step === 4 && (
              <Step4_AIProjects
                selectedProjectIds={sessionData.selectedProjectIds}
                primaryProjectId={sessionData.primaryProjectId}
                onChange={(ids) => updateData("selectedProjectIds", ids)}
                onPrimaryChange={(id) => updateData("primaryProjectId", id)}
              />
            )}

            {step === 5 && (
              <Step5_LanguageAISettings
                data={sessionData}
                onChange={updateData}
              />
            )}

            {step === 6 && (
              <Step6_AutoGenerateAI
                autoGenerate={sessionData.autoGenerateAI}
                onChange={(v) => updateData("autoGenerateAI", v)}
              />
            )}

            {step === 7 && (
              <Step7_SaveTranscript
                saveTranscript={sessionData.saveTranscript}
                questionBankContributionOptIn={
                  sessionData.questionBankContributionOptIn
                }
                onSaveTranscriptChange={updateSaveTranscript}
                onContributionChange={(value) =>
                  updateData("questionBankContributionOptIn", value)
                }
              />
            )}

            {step === 8 && (
              <Step8_Review
                data={{
                  companyName: sessionData.companyName,
                  round: sessionData.round,
                  isFree,
                }}
                onCreate={createSession}
                onBack={handleBack}
                loading={loading}
              />
            )}

            {step < 8 && (
              <div className="flex items-center justify-between pt-6 border-t mt-6">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={step === 1 || loading}
                  className="rounded-xl gap-2 h-11 px-8 font-semibold border-border hover:bg-muted/50 transition-all shadow-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={
                    (step === 1 &&
                      (!sessionData.companyName ||
                        (sessionData.jobDescription &&
                          !JOB_DESCRIPTION_REGEX.test(
                            sessionData.jobDescription,
                          )))) ||
                    (step === 2 && !sessionData.selectedResume) ||
                    (step === 4 &&
                      sessionData.selectedProjectIds.length === 2 &&
                      !sessionData.primaryProjectId)
                  }
                  className="rounded-xl gap-2 h-11 px-10 bg-black dark:bg-white text-white dark:text-black font-bold shadow-lg hover:shadow-xl active:scale-95 transition-all"
                >
                  {step === 4 && sessionData.selectedProjectIds.length === 0 ? "Skip" : "Next"}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <OutOfCreditsDialog
        open={isOutOfCreditsOpen}
        onOpenChange={setIsOutOfCreditsOpen}
        onGetCredits={() => setIsBuyCreditsOpen(true)}
      />

      <BuyCreditsDialog
        open={isBuyCreditsOpen}
        onOpenChange={setIsBuyCreditsOpen}
        onSuccess={refreshBalance}
      />
    </>
  );
}
