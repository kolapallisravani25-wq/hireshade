 ;

import { useEffect, useRef, useState } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import {
  AlertCircle,
  Lightbulb,
  Target,
  ShieldCheck,
  Check,
  X,
  Loader2,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ATSAnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  missingKeywords: string[];
  suggestions: string[];
  filename?: string;
  jobTitle?: string;
  resumeId?: string;
}

interface PendingATSAnalysis {
  resumeId: string;
  filename?: string;
  source?: "uploaded" | "builder";
  userId?: string;
}

export default function ATSResult() {
  const location = useLocation();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const initialAnalysis = location.state?.analysis as ATSAnalysisResult | undefined;
  const pendingAnalysis = location.state?.pendingAnalysis as PendingATSAnalysis | undefined;
  const [analysis, setAnalysis] = useState<ATSAnalysisResult | undefined>(initialAnalysis);
  const [isGenerating, setIsGenerating] = useState(Boolean(!initialAnalysis && pendingAnalysis));
  const [error, setError] = useState<string | null>(null);
  const startedAnalysisIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (analysis || !pendingAnalysis) return;
    if (startedAnalysisIdRef.current === pendingAnalysis.resumeId) return;
    startedAnalysisIdRef.current = pendingAnalysis.resumeId;
    const pending = pendingAnalysis;

    async function generateAtsScore() {
      setIsGenerating(true);
      setError(null);

      try {
        const isBuilderResume = pending.source === "builder";
        const token = isBuilderResume ? await getToken() : null;
        const response = await fetch(
          isBuilderResume
            ? `${import.meta.env.VITE_BACKEND_URL}/api/resume/builder/ats-score`
            : `${import.meta.env.VITE_BACKEND_URL}/api/resume/ats-score`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ resumeId: pending.resumeId }),
          },
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to analyze resume");
        }

        const result = {
          ...(isBuilderResume ? data.data : data),
          filename: pending.filename,
          resumeId: pending.resumeId,
        } as ATSAnalysisResult;

        setAnalysis(result);
        navigate("/resume/ats-result", {
          replace: true,
          state: { analysis: result },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to analyze resume");
      } finally {
        setIsGenerating(false);
      }
    }

    generateAtsScore();
  }, [analysis, getToken, navigate, pendingAnalysis]);

  if (isGenerating) {
    return (
      <div className="min-h-[560px] flex items-center justify-center px-4">
        <Card className="w-full max-w-2xl rounded-2xl border-border/60 shadow-sm">
          <CardContent className="px-8 py-10">
            <div className="flex flex-col items-center text-center gap-6">
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Loader2 className="h-9 w-9 animate-spin text-blue-600" />
                </div>
                <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-background border shadow-sm flex items-center justify-center">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">
                  ATS score is generating
                </h1>
                <p className="text-sm text-muted-foreground max-w-md">
                  We are analyzing resume structure, keyword coverage, strengths,
                  weaknesses, and improvement suggestions.
                </p>
              </div>

              {pendingAnalysis?.filename && (
                <div className="rounded-full border bg-muted/40 px-4 py-2 text-sm font-medium max-w-full truncate">
                  {pendingAnalysis.filename}
                </div>
              )}

              <div className="w-full space-y-2 pt-2">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full w-2/3 rounded-full bg-blue-600 animate-pulse" />
                </div>
                <p className="text-xs text-muted-foreground">
                  This page will show the ATS report automatically when analysis finishes.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4 px-4 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <div>
          <p className="font-semibold">ATS analysis failed</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
        <Button onClick={() => navigate("/resume/all")}>
          Back to resumes
        </Button>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <p className="text-muted-foreground">No analysis data found.</p>
        <Button onClick={() => navigate("/resume/ats-analysis")}>
          Go back to Analysis
        </Button>
      </div>
    );
  }

  const getMatchInfo = (score: number) => {
    if (score >= 85)
      return {
        label: "Excellent Match",
        color: "text-green-500 bg-green-500/10 border-green-500/20",
        description:
          "Your resume is highly optimized for this role and likely to pass most ATS filters.",
      };
    if (score >= 70)
      return {
        label: "Good Match",
        color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
        description:
          "Your resume has a strong foundation but could benefit from some keyword optimization.",
      };
    if (score >= 50)
      return {
        label: "Needs Improvement",
        color: "text-yellow-500 bg-yellow-500/10 border-yellow-500/20",
        description:
          "There are significant gaps between your resume and the job requirements.",
      };
    return {
      label: "Low Match",
      color: "text-red-500 bg-red-500/10 border-red-500/20",
      description:
        "Your resume requires substantial changes to be competitive for this position.",
    };
  };

  const match = getMatchInfo(analysis.score);

  return (
    <div className="space-y-10 max-w-7xl mx-auto py-5 px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link
                to="/resume/ats-analysis"
                className="hover:text-primary transition-colors"
              >
                ATS Analysis
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Report</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Score Section */}
      <Card className="w-full rounded-xl border border-border/50 bg-muted/40 shadow-sm px-1">
        <CardContent className="flex items-center gap-6 px-6 py-5">
          {/* Score Circle */}
          <div className="relative h-16 w-16 flex items-center justify-center shrink-0">
            <svg className="h-full w-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="26"
                stroke="currentColor"
                strokeWidth="6"
                fill="transparent"
                className="text-muted opacity-20"
              />
              <circle
                cx="32"
                cy="32"
                r="26"
                stroke="currentColor"
                strokeWidth="6"
                fill="transparent"
                strokeDasharray={163}
                strokeDashoffset={163 - (163 * analysis.score) / 100}
                strokeLinecap="round"
                className="text-green-500 transition-all duration-700"
              />
            </svg>

            <span className="absolute text-sm font-semibold">
              {analysis.score}
            </span>
          </div>

          {/* Right Content */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">ATS Score</span>

              <Badge
                className={`text-xs px-2 py-0.5 rounded-md font-medium ${match.color}`}
              >
                {match.label}
              </Badge>
            </div>

            <p className="text-sm text-muted-foreground">{match.description}</p>
          </div>
        </CardContent>
      </Card>

      {/* Summary Section */}
      <Card className="border-border/40 shadow-sm rounded-xl bg-card/30 backdrop-blur-sm h-full flex flex-col">
        <CardHeader className="px-6 pt-4 pb-4">
          <div className="flex items-center gap-3 text-primary mb-2">
            <Target className="h-6 w-6" />
            <span className="font-bold uppercase tracking-wider text-xs">
              Analysis Summary
            </span>
          </div>
        </CardHeader>
        <CardContent className="px-10 pb-10 pt-0 grow">
          <div className="relative">
            <p className="text-md text-foreground/90 leading-relaxed font-medium italic relative z-10 pl-4 border-l-2 border-primary/20">
              {analysis.summary}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Strengths */}
        <Card className="rounded-xl border border-border/50 bg-muted/40 shadow-sm">
          <CardHeader className="px-6 py-5 border-b border-border/40">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-green-500">
              <ShieldCheck className="h-4 w-4" />
              Strengths
            </CardTitle>
          </CardHeader>

          <CardContent className="px-6 py-5">
            <ul className="space-y-3">
              {analysis.strengths.map((strength, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Check className="h-4 w-4 mt-1 text-green-500 shrink-0" />
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    {strength}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Weaknesses */}
        <Card className="rounded-xl border border-border/50 bg-muted/40 shadow-sm">
          <CardHeader className="px-6 py-5 border-b border-border/40">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-yellow-500">
              <AlertCircle className="h-4 w-4" />
              Weaknesses
            </CardTitle>
          </CardHeader>

          <CardContent className="px-6 py-5">
            <ul className="space-y-3">
              {analysis.weaknesses.map((weakness, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-yellow-500 mt-1 text-sm">✕</span>
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    {weakness}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Missing Keywords */}
      <Card className="border-border/40 shadow-md rounded-xl">
        <CardHeader className="px-6 py-4 border-b border-border/40">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold flex items-center gap-3">
              <X className="h-6 w-6 text-destructive" />
              Missing Keywords
            </CardTitle>
            <Badge
              variant="outline"
              className="px-3 py-1 bg-destructive/5 text-destructive border-destructive/20 rounded-lg"
            >
              {analysis.missingKeywords.length} Gaps
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-6 py-4">
          <div className="flex flex-wrap gap-3">
            {analysis.missingKeywords.map((keyword, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-destructive/3 text-destructive border border-destructive/10 hover:bg-destructive/10 transition-colors"
              >
                {keyword}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Suggestions */}
      <Card className="border-border/40 shadow-md rounded-xl">
        <CardHeader className="px-10 py-5 border-b border-border/40">
          <CardTitle className="text-xl font-bold flex items-center gap-3 text-blue-600 dark:text-blue-400">
            <Lightbulb className="h-6 w-6" />
            Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent className="px-10 py-8">
          <div className="space-y-4">
            {analysis.suggestions.map((suggestion, i) => (
              <div
                key={i}
                className="p-2 rounded-lg bg-blue-500/3 border border-blue-500/10 flex gap-5 items-start group hover:border-blue-500/30 transition-all"
              >
                <span className="flex shrink-0 items-center justify-center h-10 w-10 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-black text-sm">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-sm leading-relaxed text-foreground/80 font-medium pt-2">
                  {suggestion}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
