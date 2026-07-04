import { useUser } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { Play, FileText, Download, Ticket, HelpCircle, Coins } from "lucide-react";
import { OnboardingStepper } from "@/components/Dashboard/OnboardingStepper";
import { DownloadApp } from "@/components/Dashboard/DownloadApp";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Dashboard() {
  const { user } = useUser();
  const { balance } = useCreditsBalance();
  const navigate = useNavigate();

  const firstName = user?.firstName ?? "there";
  const credits = balance?.totalAvailable ?? "—";

  return (
    <div className="flex flex-col gap-6 py-4 sm:py-6 w-full">

      {/* ── Welcome hero — navy gradient ── */}
      <div
        className="relative overflow-hidden rounded-2xl p-7 text-white flex items-center justify-between"
        style={{ background: "linear-gradient(135deg, #1B1B3A, #2D2D52)" }}
      >
        {/* Radial indigo glow */}
        <div
          className="pointer-events-none absolute -top-[40%] -right-[10%] w-[300px] h-[300px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(91,79,233,0.3), transparent 70%)" }}
        />

        <div className="relative">
          <h2 className="font-serif text-[24px] text-white mb-1">
            {greeting()}, {firstName} <span className="animate-wave">👋</span>
          </h2>
          <p className="text-[14px] text-white/60 mb-5 font-light">
            You have <span className="text-white font-semibold">{credits}</span> credits remaining. Ready for your next session?
          </p>
          <button
            onClick={() => navigate("/sessions")}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#5B4FE9] rounded-lg text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Start a session
          </button>
        </div>

        <div className="relative text-right shrink-0 hidden sm:block">
          <div className="font-serif text-[52px] text-white leading-none">{credits}</div>
          <div className="text-[12px] text-white/50 mt-1">credits remaining</div>
        </div>
      </div>

      {/* ── Quick actions 2×2 ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-[1.5px] text-muted-foreground">
            Quick actions
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              icon: FileText,
              iconBg: "bg-[#EEEAFF]",
              iconColor: "text-[#5B4FE9]",
              title: "Upload resume",
              sub: "AI tailors answers to your experience",
              onClick: () => navigate("/resume/all"),
            },
            {
              icon: Download,
              iconBg: "bg-[#ECFDF5]",
              iconColor: "text-emerald-600",
              title: "Download desktop app",
              sub: "Windows & macOS available",
              // Scroll to the download section below — this used to dump the
              // user on /help, which contains no download UI at all.
              onClick: () =>
                document
                  .getElementById("download-desktop-app")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            },
            {
              icon: Ticket,
              iconBg: "bg-[#FEF7E0]",
              iconColor: "text-[#E8A117]",
              title: "Redeem a coupon",
              sub: "Have a code? Get free credits",
              onClick: () => navigate("/billing"),
            },
            {
              icon: HelpCircle,
              iconBg: "bg-red-50",
              iconColor: "text-red-500",
              title: "Practice questions",
              sub: "Browse company-specific Q&A",
              onClick: () => navigate("/questions/all"),
            },
          ].map(({ icon: Icon, iconBg, iconColor, title, sub, onClick }) => (
            <button
              key={title}
              onClick={onClick}
              className="flex items-center gap-4 p-4 bg-white border border-[#E8E6E0] rounded-xl text-left transition-all hover:border-[#5B4FE9] hover:-translate-y-0.5 hover:shadow-sm group"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg shrink-0 ${iconBg}`}>
                <Icon className={`h-5 w-5 ${iconColor}`} />
              </div>
              <div>
                <div className="text-[13.5px] font-medium text-[#1B1B3A]">{title}</div>
                <div className="text-[12px] text-muted-foreground font-light mt-0.5">{sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Download desktop app ── */}
      <div id="download-desktop-app" className="scroll-mt-6">
        <DownloadApp />
      </div>

      {/* ── Onboarding stepper ── */}
      <OnboardingStepper />
    </div>
  );
}
