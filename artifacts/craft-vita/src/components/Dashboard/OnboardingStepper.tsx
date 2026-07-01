import { useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileText, PlayCircle, Coins, Mic, ArrowRight, Sparkles } from "lucide-react";

const steps = [
  {
    type: "optional" as const,
    label: "Optional",
    labelColor: "bg-slate-100 text-slate-600",
    icon: FileText,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    borderColor: "border-emerald-200/60",
    gradientFrom: "from-emerald-50",
    title: "Upload your Resume",
    description:
      "Upload your resume so HireShade can craft personalised answers tuned to your experience and background.",
    action: "Upload Resume",
    actionVariant: "outline" as const,
    path: "/resume/all",
    step: null,
  },
  {
    type: "step" as const,
    label: "Step 1",
    labelColor: "bg-blue-100 text-blue-700",
    icon: PlayCircle,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    borderColor: "border-blue-200/60",
    gradientFrom: "from-blue-50",
    title: "Try a Free Session",
    description:
      "Run a 5-minute free trial to see the AI overlay in action — no credits needed, no commitment.",
    action: "Create Free Session",
    actionVariant: "outline" as const,
    path: "/sessions",
    step: 1,
  },
  {
    type: "step" as const,
    label: "Step 2",
    labelColor: "bg-amber-100 text-amber-700",
    icon: Coins,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    borderColor: "border-amber-200/60",
    gradientFrom: "from-amber-50",
    title: "Top Up Credits",
    description:
      "One-time credit packs, no subscription required. Credits never expire — buy once, use at your pace.",
    action: "Buy Credits",
    actionVariant: "default" as const,
    path: "/billing",
    step: 2,
    cta: true,
  },
  {
    type: "step" as const,
    label: "Step 3",
    labelColor: "bg-violet-100 text-violet-700",
    icon: Mic,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    borderColor: "border-violet-200/60",
    gradientFrom: "from-violet-50",
    title: "Ace Your Interview",
    description:
      "Start a full AI-powered session with live transcription, tailored answers, and screen analysis.",
    action: "Start Interview",
    actionVariant: "outline" as const,
    path: "/sessions",
    step: 3,
  },
];

export function OnboardingStepper() {
  const { user } = useUser();
  const navigate = useNavigate();
  const firstName = user?.firstName || "there";

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Welcome back, {firstName}! <Sparkles className="h-5 w-5 text-brand animate-pulse" />
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's how to get the most out of HireShade.
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === steps.length - 1;
          return (
            <div key={step.title} className="relative flex flex-col group">
              {/* Connector arrow */}
              {!isLast && (
                <div className="hidden lg:flex absolute top-10 -right-2 z-10 items-center justify-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                </div>
              )}

              <div className={`flex flex-col flex-1 rounded-2xl border ${step.borderColor} bg-gradient-to-b ${step.gradientFrom} to-white p-5 shadow-sm hover:shadow-md transition-all duration-200 group-hover:-translate-y-0.5`}>
                {/* Badge + Icon row */}
                <div className="flex items-center justify-between mb-4">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${step.labelColor}`}>
                    {step.label}
                  </span>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${step.iconBg} shadow-sm`}>
                    <Icon className={`h-5 w-5 ${step.iconColor}`} />
                  </div>
                </div>

                {/* Title + description */}
                <div className="flex-1 space-y-2 mb-5">
                  <h3 className="text-sm font-semibold text-gray-900 leading-tight">{step.title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">{step.description}</p>
                </div>

                {/* CTA */}
                <div className="relative">
                  {step.cta && (
                    <div className="absolute inset-x-0 -bottom-1 h-8 bg-gradient-to-r from-amber-300 via-brand to-blue-400 opacity-40 blur-xl rounded-full pointer-events-none" />
                  )}
                  <Button
                    variant={step.actionVariant}
                    size="sm"
                    onClick={() => navigate(step.path)}
                    className={`relative w-full rounded-xl text-[13px] font-medium ${
                      step.cta
                        ? "bg-gradient-to-r from-brand to-blue-600 hover:from-brand/90 hover:to-blue-600/90 text-white border-0 shadow-md shadow-brand/20"
                        : ""
                    }`}
                  >
                    {step.action}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
