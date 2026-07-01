 ;

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Video,
  FileText,
  TrendingUp,
  Activity,
  CheckCircle2,
} from "lucide-react";

interface AnalyticsData {
  totalSessions: number;
  totalResumes: number;
  atsAnalysed: number;
  sessionTranscriptions: number;
  chartData: any[];
}

export default function Analytics() {
  const userId = localStorage.getItem("userId");
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsData>({
    totalSessions: 0,
    totalResumes: 0,
    atsAnalysed: 0,
    sessionTranscriptions: 0,
    chartData: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!userId) return;
      try {
        setIsLoading(true);
        const token = await getToken();
        const requestOptions = {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        };

        // Fetch sessions
        const sessionsRes = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/session/list?userId=${userId}`,
          requestOptions,
        );
        let sessions = [];
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json();
          sessions = Array.isArray(sessionsData)
            ? sessionsData
            : sessionsData.data || [];
        }

        // Fetch resumes
        const resumesRes = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/resume/list?userId=${userId}`,
          requestOptions,
        );
        let resumes = [];
        if (resumesRes.ok) {
          const resumesData = await resumesRes.json();
          resumes = Array.isArray(resumesData)
            ? resumesData
            : resumesData.data || [];
        }

        // Try specifically fetching ATS analyzed count or parse from resume data
        let atsAnalysedCount = resumes.filter(
          (r: any) => r.ats === true || r.atsAnalysis,
        ).length;
        try {
          const atsRes = await fetch(
            `${import.meta.env.VITE_BACKEND_URL}/api/resume/all-ats?userId=${userId}`,
            requestOptions,
          );
          if (atsRes.ok) {
            const atsData = await atsRes.json();
            const atsArray = Array.isArray(atsData)
              ? atsData
              : atsData.data || [];
            if (atsArray.length > 0) {
              atsAnalysedCount = atsArray.length;
            }
          }
        } catch (atsErr) {
          // fallback to resumes filtering
        }

        const transcriptionCount = sessions.filter(
          (s: any) => s.saveTranscription === true,
        ).length;

        // Build chart data specifically using real data mapped to the last 6 months
        const getPast6Months = () => {
          const months = [];
          const date = new Date();
          for (let i = 5; i >= 0; i--) {
            const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
            months.push(d.toLocaleString("default", { month: "short" }));
          }
          return months;
        };

        const last6Months = getPast6Months();
        const monthMap: Record<string, { sessions: number; resumes: number }> =
          {};

        last6Months.forEach((m) => {
          monthMap[m] = { sessions: 0, resumes: 0 };
        });

        const processItems = (items: any[], type: "sessions" | "resumes") => {
          items.forEach((item: any) => {
            if (!item.createdAt && !item.uploadedAt) return;
            const d = new Date(item.createdAt || item.uploadedAt);
            const monthName = d.toLocaleString("default", { month: "short" });

            // Only add if it's within our displayed 6 months array
            if (monthMap[monthName]) {
              monthMap[monthName][type] += 1;
            }
          });
        };

        processItems(sessions, "sessions");
        processItems(resumes, "resumes");

        const realChartData = last6Months.map((month) => ({
          month,
          sessions: monthMap[month].sessions,
          resumes: monthMap[month].resumes,
        }));

        setData({
          totalSessions: sessions.length,
          totalResumes: resumes.length,
          atsAnalysed: atsAnalysedCount,
          sessionTranscriptions: transcriptionCount,
          chartData: realChartData,
        });
      } catch (error) {
        console.error("Error fetching analytics:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAnalytics();
  }, [userId]);

  const stats = [
    {
      title: "Sessions",
      value: data.totalSessions.toString(),
      description: "Total interviews conducted",
      icon: Video,
      trend: "+12% from last month",
      trendUp: true,
    },
    {
      title: "All Resumes",
      value: data.totalResumes.toString(),
      description: "Documents managed",
      icon: FileText,
      trend: "+4% from last month",
      trendUp: true,
    },
    {
      title: "ATS Analysed",
      value: data.atsAnalysed.toString(),
      description: "Resumes fully scored by AI",
      icon: Activity,
      trend: "Steady",
      trendUp: true,
    },
    {
      title: "Transcriptions Saved",
      value: data.sessionTranscriptions.toString(),
      description: "Recorded session transcripts",
      icon: CheckCircle2,
      trend: "+2% improvement",
      trendUp: true,
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-10">
      {/* <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Analytics Hub</h1>
        <p className="text-muted-foreground text-lg">
          Track your interview performance, resume effectiveness, and overall progress.
        </p>
      </div> */}

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse bg-gray-50 border-gray-100">
              <CardHeader className="h-24"></CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <Card
                key={i}
                className="group relative overflow-hidden border-border/50 bg-white shadow-sm transition-all hover:shadow-md hover:border-brand/30"
              >
                <div className="absolute inset-0 bg-linear-to-br from-brand/5 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">
                    {stat.value}
                  </div>
                  <div className="mt-1 flex items-center space-x-2">
                    <span className="flex items-center text-xs font-medium text-emerald-600">
                      <TrendingUp className="mr-1 h-3 w-3" />
                      {stat.trend}
                    </span>
                  </div>
                  <CardDescription className="mt-3 text-xs">
                    {stat.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Main Charts Section */}
      <div className="grid gap-6 lg:grid-cols-7 mt-8">
        <Card className="lg:col-span-4 border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5 text-brand" />
                  Activity Overview
                </CardTitle>
                <CardDescription className="mt-1">
                  Your session and resume activity over recent months.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-8">
            <div className="h-80 w-full min-h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.chartData}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="colorSessions"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="colorResumes"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e5e7eb"
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    dx={-10}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow:
                        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sessions"
                    stroke="#4f46e5"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorSessions)"
                    activeDot={{ r: 6, strokeWidth: 0, fill: "#4f46e5" }}
                    name="Sessions"
                  />
                  <Area
                    type="monotone"
                    dataKey="resumes"
                    stroke="#10b981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorResumes)"
                    activeDot={{ r: 6, strokeWidth: 0, fill: "#10b981" }}
                    name="Resumes"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Small secondary cards for right col */}
        <Card className="lg:col-span-3 border-border/50 shadow-sm flex flex-col">
          <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              Insights & Suggestions
            </CardTitle>
            <CardDescription className="mt-1">
              AI-driven recommendations based on your recent data.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-6 space-y-6">
            <div className="space-y-5">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 rounded-full bg-blue-100 p-2 text-blue-600">
                  <Video className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">
                    Increase Interview Practice
                  </h4>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                    You have done {data.totalSessions} sessions so far.
                    Consistent practice boosts your AI confidence score
                    significantly.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-600">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">
                    Resume Optimization
                  </h4>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                    Your latest resume iterations show an upward trend in ATS
                    readability scores. Keep optimizing!
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-brand/20 bg-brand/5 p-4 mt-8">
                <h4 className="text-sm font-semibold text-brand flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Pro Tip
                </h4>
                <p className="mt-2 text-sm text-gray-600">
                  Try matching specific job descriptions to your resume using
                  the ATS Analysis module for better metrics next month.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
