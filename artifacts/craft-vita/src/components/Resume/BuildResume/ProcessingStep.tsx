 ;

import * as React from "react";
import { Sparkles, AlertTriangle, RefreshCw } from "lucide-react";

export type ProcessingStatus = "loading" | "success" | "error";

interface ProcessingStepProps {
  status?: ProcessingStatus;
  error?: string | null;
  onRetry?: () => void;
  onSkip?: () => void;
  /** "extract" = parsing an existing file, "scratch" = building from JD */
  mode?: "extract" | "scratch";
}

const AI_STATES_EXTRACT = [
  "Extracting resume content",
  "Analyzing experience & skills",
  "Structuring resume sections",
  "Optimizing content flow",
  "Preparing final layout",
];

const AI_STATES_SCRATCH = [
  "Reading job description",
  "Crafting professional summary",
  "Generating work experience",
  "Building skills & projects",
  "Finalising resume layout",
];

// Smooth shimmer progress that advances to ~85% over ~20s then stays
function useSimulatedProgress() {
  const [progress, setProgress] = React.useState(2);
  React.useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 85) { clearInterval(interval); return p; }
        // Slow down as it approaches 85
        const step = p < 40 ? 2.5 : p < 65 ? 1.2 : 0.5;
        return Math.min(p + step, 85);
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);
  return progress;
}

export function ProcessingStep({
  status = "loading",
  error = null,
  onRetry,
  onSkip,
  mode = "extract",
}: ProcessingStepProps) {
  const AI_STATES = mode === "scratch" ? AI_STATES_SCRATCH : AI_STATES_EXTRACT;
  // Cycling AI state label
  const [stateIdx, setStateIdx] = React.useState(0);
  const [fadeIn, setFadeIn] = React.useState(true);
  const progress = useSimulatedProgress();

  React.useEffect(() => {
    if (status !== "loading") return;
    const timer = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setStateIdx((i) => (i + 1) % AI_STATES.length);
        setFadeIn(true);
      }, 200);
    }, 2600);
    return () => clearInterval(timer);
  }, [status]);

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-5">
        <div className="h-14 w-14 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-[15px] font-semibold text-slate-800 tracking-tight">
            Generation failed
          </h3>
          <p className="text-[13px] text-slate-400 max-w-[260px] mx-auto leading-relaxed">
            {error ?? "Something went wrong while processing your resume."}
          </p>
        </div>
        <div className="flex items-center gap-2.5 mt-1">
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 bg-white text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-medium hover:bg-slate-700 transition-colors duration-150"
            >
              Continue without AI
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-8 text-center gap-0">

      {/* ── Premium soft spinner ── */}
      <div className="relative flex items-center justify-center h-[72px] w-[72px] mb-7">
        {/* Outer static ring */}
        <div className="absolute inset-0 rounded-full border border-slate-200" />
        {/* Slow spinning arc */}
        <div
          className="absolute inset-0 rounded-full border-[1.5px] border-t-slate-400/70 border-r-slate-300/40 border-b-transparent border-l-transparent animate-spin"
          style={{ animationDuration: "2.4s", animationTimingFunction: "linear" }}
        />
        {/* Counter-rotating inner arc */}
        <div
          className="absolute inset-[10px] rounded-full border border-t-transparent border-r-transparent border-b-slate-300/50 border-l-slate-200/60 animate-spin"
          style={{
            animationDuration: "3.6s",
            animationTimingFunction: "linear",
            animationDirection: "reverse",
          }}
        />
        {/* Center icon */}
        <div className="relative z-10 flex items-center justify-center h-8 w-8 rounded-full bg-white border border-slate-100 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <Sparkles className="h-3.5 w-3.5 text-slate-500" />
        </div>
      </div>

      {/* ── Title ── */}
      <h3 className="text-[17px] font-semibold text-slate-800 tracking-tight leading-snug mb-1.5">
        {mode === "scratch" ? "Building Your Resume" : "Crafting Your Resume"}
      </h3>

      {/* ── Description ── */}
      <p className="text-[13px] text-slate-400 max-w-[260px] leading-relaxed mb-6">
        {mode === "scratch"
          ? "AI is crafting a complete, tailored resume from your job description."
          : "Our AI is extracting, analyzing, and structuring your information into a professional layout."}
      </p>

      {/* ── Cycling AI state label ── */}
      <div className="h-5 mb-5">
        <p
          className="text-[12px] font-medium text-slate-500 tracking-wide transition-opacity duration-200"
          style={{ opacity: fadeIn ? 1 : 0 }}
        >
          {AI_STATES[stateIdx]}…
        </p>
      </div>

      {/* ── Animated progress bar ── */}
      <div className="w-[220px] h-[2px] rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-slate-400/70 transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
