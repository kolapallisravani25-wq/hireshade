import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { useCreditBrackets } from "@/hooks/useCreditBrackets";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Globe,
  Cpu,
  Info,
  Sparkles,
  MonitorSmartphone,
  Video,
  Users,
  Phone,
  ChevronLeft,
  Monitor,
  Tv2,
  ExternalLink,
  AlertCircle,
  Cast,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getAuthHeaders } from "@/lib/globalAuth";
import { ModelSelector } from "@/pages/Sessions/ActiveSession/components/ModelSelector";
import { BuyCreditsDialog } from "@/components/Billing/BuyCreditsDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ActivateResponseData {
  maxAllowedMinutes: number | null;
  startedAt: string;
  creditsHeld: string;
}

interface ConnectDialogProps {
  open: boolean;
  onSuccess: (
    finalModel: string,
    finalLanguage: string,
    activateData: ActivateResponseData,
  ) => void;
  onCancel: () => void;
  // Called synchronously at the start of the connect button click — before any
  // await — so that getDisplayMedia runs within the user gesture context.
  // WKWebView (production) strictly requires this.
  onStartShare?: () => void;
  sessionId: string;
  companyName: string;
  jobTitle: string;
  extraContext: string;
  language: string;
  simpleLanguage: boolean;
  aiModel: string;
}

const LANGUAGES = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish" },
  { value: "French", label: "French" },
  { value: "German", label: "German" },
  { value: "Hindi", label: "Hindi" },
  { value: "Arabic", label: "Arabic" },
  { value: "Chinese", label: "Chinese" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Japanese", label: "Japanese" },
];

const HOW_TO_CONNECT = [
  { icon: Video, label: "Zoom" },
  { icon: Users, label: "Meet" },
  { icon: Monitor, label: "Teams" },
  { icon: Tv2, label: "Webex" },
  { icon: Phone, label: "Phone" },
];

export function ConnectDialog({
  open,
  onSuccess,
  onCancel,
  onStartShare,
  sessionId,
  companyName,
  jobTitle,
  extraContext,
  language: initialLanguage,
  simpleLanguage: initialSimple,
  aiModel: initialAIModel,
}: ConnectDialogProps) {
  const navigate = useNavigate();
  const { balance, refresh: refreshBalance } = useCreditsBalance();

  const { brackets } = useCreditBrackets();
  //   console.log("ConnectDialog", {
  //     sessionId,
  //     companyName,
  //     jobTitle,
  //     extraContext,
  //     language: initialLanguage,
  //     simpleLanguage: initialSimple,
  //     aiModel: initialAIModel,
  //   });
  const [language, setLanguage] = React.useState(initialLanguage);
  const [simpleLanguage, setSimpleLanguage] = React.useState(initialSimple);
  const [aiModel, setAIModel] = React.useState(initialAIModel);
  const [activating, setActivating] = React.useState(false);
  const [buyCreditsOpen, setBuyCreditsOpen] = React.useState(false);

  // Sync props when dialog reopens with new session
  React.useEffect(() => {
    if (open) {
      setLanguage(initialLanguage);
      setSimpleLanguage(initialSimple);
      setAIModel(initialAIModel);
    }
  }, [open, initialLanguage, initialSimple, initialAIModel]);

  const handleActivate = async () => {
    // Call onStartShare FIRST — synchronously, before any await — so that
    // navigator.mediaDevices.getDisplayMedia() runs inside the user gesture
    // handler context that WKWebView requires in production builds.
    onStartShare?.();
    setActivating(true);
    try {
      // 1. Call activate API
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/session/${sessionId}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ language, simpleLanguage, aiModel }),
        },
      );

      if (!res.ok) {
        if (res.status === 402) {
          toast.error(
            "Insufficient credits. Please purchase more credits to start a session.",
          );
          setBuyCreditsOpen(true);
          return;
        }
        const err = await res.json();
        throw new Error(
          err.error || err.message || "Failed to activate session",
        );
      }

      const data = await res.json();
      // 3. Trigger success callback with activate response data
      onSuccess(aiModel, language, {
        maxAllowedMinutes: data.maxAllowedMinutes ?? null,
        startedAt: data.startedAt ?? new Date().toISOString(),
        creditsHeld: data.creditsHeld ?? "0",
      });
    } catch (err: any) {
      if (
        err?.name === "NotAllowedError" ||
        err?.message?.includes("Permission denied")
      ) {
        toast.error(
          "Screen sharing was denied. Please allow screen sharing to continue.",
        );
      } else {
        toast.error(err?.message || "Failed to activate session.");
      }
    } finally {
      setActivating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-lg max-h-[calc(100dvh-2rem)] flex flex-col gap-0 border-none shadow-2xl rounded-3xl p-0 overflow-hidden bg-background" aria-describedby={undefined}>
        <DialogHeader className="shrink-0 pt-6 px-7 pb-0">
          <DialogTitle className="text-xl font-bold tracking-tight">
            Connect
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-7 pb-7 pt-3 space-y-5">
          {/* Context Summary */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is an Interview Session at{" "}
            <span className="font-bold text-foreground">
              &quot;{companyName || "Company"}&quot;
            </span>
            {extraContext && (
              <>
                {" "}
                with{" "}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-primary font-semibold underline underline-offset-2 cursor-pointer"
                    >
                      extra context
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="bottom"
                    collisionPadding={16}
                    className="w-[min(34rem,calc(100vw-2rem))] max-h-[min(60dvh,30rem)] overflow-y-auto overscroll-contain p-4"
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                      {extraContext}
                    </p>
                  </PopoverContent>
                </Popover>
                .
              </>
            )}
            .
          </p>

          {/* Language + Simple Row */}
          <div className="grid grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-primary" />
                <Label className="text-xs font-bold">Language</Label>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </div>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-10 rounded-xl bg-background border-border/80 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {LANGUAGES.map((lang) => (
                    <SelectItem
                      key={lang.value}
                      value={lang.value}
                      className="py-2"
                    >
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-bold">Simple</Label>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </div>
              <div className="h-10 flex items-center">
                <Switch
                  checked={simpleLanguage}
                  onCheckedChange={setSimpleLanguage}
                  className="data-[state=checked]:bg-black dark:data-[state=checked]:bg-white"
                />
              </div>
            </div>
          </div>

          {/* AI Model */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <Label className="text-xs font-bold">AI Model</Label>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </div>
            <ModelSelector
              value={aiModel}
              onChange={setAIModel}
              isFullscreen={false}
              className="w-full h-10 bg-background border-border/80 text-foreground"
            />
          </div>

          {/* Screen Share Notice */}
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/40 border border-border/50">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Make sure to select the{" "}
              <span className="font-bold text-foreground">
                &quot;Also share tab audio&quot;
              </span>{" "}
              option when sharing the screen.
            </p>
          </div>

          {/* How to Connect */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                How to Connect:
              </span>
              <button className="flex items-center gap-1 text-xs text-primary font-semibold hover:underline">
                <Video className="h-3 w-3" />
                Video Tutorial
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              {HOW_TO_CONNECT.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 group cursor-pointer"
                  title={label}
                >
                  <div className="h-9 w-9 rounded-xl bg-muted/50 border border-border/50 flex items-center justify-center transition-all group-hover:bg-muted group-hover:border-border shadow-sm">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              ))}
            </div>

            {/* Mock Interview Promo */}
            <div className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-muted/20">
              <div className="h-16 w-24 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden border border-border/40">
                <div className="flex flex-col items-center gap-1">
                  <MonitorSmartphone className="h-5 w-5 text-muted-foreground" />
                  <Cast className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  Instead of a call tab, you can also share a{" "}
                  <span className="font-bold text-foreground">
                    mock interview
                  </span>{" "}
                  on YouTube and test HireShade that way.
                </p>
                <button className="text-[12px] text-primary font-semibold hover:underline flex items-center gap-1">
                  Example video: Mock Interview
                  <ExternalLink className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          {/* Credit cost preview (paid sessions only) */}
          {balance &&
            (() => {
              const maxBracket = brackets.reduce<(typeof brackets)[0] | null>(
                (max, b) =>
                  !max || b.bracketMinutes > max.bracketMinutes ? b : max,
                null,
              );
              const available = parseFloat(balance.totalAvailable);
              const maxCost = maxBracket
                ? parseFloat(maxBracket.creditsFull)
                : null;
              const lowBalance = maxCost !== null && available < maxCost;
              
              // Convert per-minute to hourly
              const creditsPerMinute = maxBracket ? parseFloat(maxBracket.creditsPerMinute) : 0;
              const creditsPerHour = creditsPerMinute * 60;
              
              return (
                <div
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs font-medium ${lowBalance ? "bg-amber-50/60 border-amber-300/60" : "bg-muted/30 border-border/50"}`}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles
                      className={`h-3.5 w-3.5 ${lowBalance ? "text-amber-500" : "text-brand"}`}
                    />
                    <span className="text-muted-foreground">
                      {maxBracket
                        ? `${creditsPerHour} cr/hour · first ${maxBracket.graceZoneMinutes} min free`
                        : "Free session"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-bold tabular-nums ${lowBalance ? "text-amber-600" : "text-foreground"}`}
                    >
                      {balance.totalAvailable} available
                    </span>
                    {lowBalance && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px] font-bold text-amber-700 hover:text-amber-800 hover:bg-amber-100 rounded-lg border border-amber-300/50"
                        onClick={() => setBuyCreditsOpen(true)}
                      >
                        Top up
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

          <BuyCreditsDialog
            open={buyCreditsOpen}
            onOpenChange={setBuyCreditsOpen}
            onSuccess={refreshBalance}
          />

          {/* Footer Actions */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={activating}
              className="gap-2 h-11 px-6 rounded-xl font-semibold border-border hover:bg-muted/50 transition-all shadow-sm"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleActivate}
              disabled={activating}
              className={cn(
                "flex-1 h-11 rounded-xl font-bold text-sm shadow-lg hover:shadow-xl active:scale-95 transition-all gap-2",
                "bg-[#0f172a] dark:bg-white text-white dark:text-black",
              )}
            >
              {activating ? (
                <>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent animate-spin rounded-full" />
                  Connecting...
                </>
              ) : (
                <>
                  <Cast className="h-4 w-4" />
                  Activate and Connect
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
