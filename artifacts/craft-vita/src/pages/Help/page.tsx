import {
  BookOpen,
  Mic,
  FileText,
  BarChart2,
  Sparkles,
  HelpCircle,
  Coins,
  MonitorPlay,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

const sections = [
  {
    icon: MonitorPlay,
    iconBg: "bg-brand/10",
    iconColor: "text-brand",
    title: "Starting an Interview Session",
    badge: "Core feature",
    badgeVariant: "secondary" as const,
    steps: [
      "Go to Sessions in the sidebar.",
      "Click New Session (top right) and fill in the job title and description.",
      "Optionally attach a resume and any reference documents.",
      "Click Start — the AI overlay opens and begins listening.",
      "Speak naturally during your interview. HireShade transcribes in real time and generates suggested answers.",
      "End the session when you're done. Your transcript and AI responses are saved automatically.",
    ],
  },
  {
    icon: FileText,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    title: "Resume Management",
    badge: "Resume",
    badgeVariant: "outline" as const,
    steps: [
      "Navigate to Resume → Upload to add a PDF or DOCX file.",
      "Use Resume Studio to build a resume from scratch using guided templates.",
      "Run ATS Analysis to score your resume against a job description.",
      "The AI highlights missing keywords and suggests improvements.",
      "Use Cover Letter to auto-generate a tailored cover letter from your resume.",
    ],
  },
  {
    icon: Sparkles,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
    title: "AI Assistant",
    badge: "AI",
    badgeVariant: "outline" as const,
    steps: [
      "Open Assistant from the sidebar.",
      "Ask any interview-related question in natural language.",
      "Reference a past session to get answers grounded in your actual interview context.",
      "Use the model selector to switch between different AI models.",
    ],
  },
  {
    icon: HelpCircle,
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    title: "Question Bank",
    badge: "Practice",
    badgeVariant: "outline" as const,
    steps: [
      "Go to Question Bank → Explore to browse thousands of interview questions.",
      "Filter by company, role, or topic.",
      "Save questions to My Questions for focused practice.",
      "View model answers and add your own notes.",
    ],
  },
  {
    icon: Mic,
    iconBg: "bg-rose-100",
    iconColor: "text-rose-600",
    title: "AI Projects",
    badge: "Projects",
    badgeVariant: "outline" as const,
    steps: [
      "Open AI Projects from the sidebar.",
      "Create a new project by describing what you're building or researching.",
      "HireShade generates a structured project report with recommendations.",
      "View version history to compare different AI-generated outputs.",
    ],
  },
  {
    icon: Coins,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
    title: "Credits & Billing",
    badge: "Billing",
    badgeVariant: "outline" as const,
    steps: [
      "Your credit balance is shown in the top navigation bar at all times.",
      "Credits are consumed by AI features: sessions, resume analysis, assistant queries, and AI projects.",
      "Go to Credits in the sidebar to purchase a one-time credit pack.",
      "Credits never expire — buy once, use at your own pace.",
      "If your balance runs low, you'll see a red indicator in the navbar.",
    ],
  },
  {
    icon: BarChart2,
    iconBg: "bg-slate-100",
    iconColor: "text-slate-600",
    title: "Analytics",
    badge: "Insights",
    badgeVariant: "outline" as const,
    steps: [
      "Open Analytics from the sidebar.",
      "View your total sessions, resumes uploaded, ATS scores, and transcription counts.",
      "The activity chart shows trends over the past 6 months.",
      "Use these insights to identify areas to improve before your next interview.",
    ],
  },
];

export default function Help() {
  const navigate = useNavigate();

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help & User Manual</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Step-by-step guides for every feature in HireShade.
        </p>
      </div>

      {/* Quick nav */}
      <Card className="border-border/50 shadow-sm bg-muted/30">
        <CardHeader className="pb-2 pt-4 px-5">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            <BookOpen className="h-4 w-4" /> Contents
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {sections.map((s, i) => {
              const Icon = s.icon;
              return (
                <button
                  key={i}
                  onClick={() => {
                    document.getElementById(`section-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-muted transition-colors text-left"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {s.title}
                  <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Sections */}
      <div className="space-y-6">
        {sections.map((section, i) => {
          const Icon = section.icon;
          return (
            <Card key={i} id={`section-${i}`} className="border-border/50 shadow-sm scroll-mt-20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-base font-semibold">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${section.iconBg} ${section.iconColor}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span>{section.title}</span>
                  <Badge variant={section.badgeVariant} className="ml-auto text-[11px]">
                    {section.badge}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2.5">
                  {section.steps.map((step, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm text-gray-700">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground mt-px">
                        {j + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Footer CTA */}
      <Card className="border-brand/20 bg-brand/5 shadow-sm">
        <CardContent className="py-5 px-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-brand">Still need help?</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Our support team is ready to assist you.
            </p>
          </div>
          <button
            onClick={() => navigate("/support")}
            className="shrink-0 text-sm font-medium text-brand hover:underline underline-offset-2 flex items-center gap-1"
          >
            Go to Support <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
