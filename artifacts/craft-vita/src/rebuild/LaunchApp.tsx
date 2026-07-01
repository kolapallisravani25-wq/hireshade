import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { CreditCard, FileText, FolderKanban, HelpCircle, Home, LogOut, MessageSquare, Play, Plus, Sparkles } from "lucide-react";
import type { LaunchProject, LaunchResume, LaunchSession } from "./types";
import { getJson, postForm } from "./http";
import { RebuildCard, RebuildEmpty, RebuildHeader, formatDisplayDate, joinClasses } from "./ui";
import LaunchActiveSession from "./LaunchActiveSession";

function Shell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { signOut } = useAuth();
  const items = [
    ["/dashboard", "Dashboard", Home],
    ["/sessions", "Sessions", MessageSquare],
    ["/resume/all", "Resumes", FileText],
    ["/ai-projects", "Projects", FolderKanban],
    ["/billing", "Billing", CreditCard],
    ["/help", "Help", HelpCircle],
  ] as const;
  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur lg:block">
        <div className="mb-8 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white"><Sparkles className="h-5 w-5" /></div><div><p className="text-lg font-black">HireShade</p><p className="text-xs font-medium text-slate-500">Launch build</p></div></div>
        <nav className="space-y-1.5">{items.map(([href, label, Icon]) => <Link key={href} to={href} className={joinClasses("flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition", location.pathname.startsWith(href) ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100")}><Icon className="h-4 w-4" />{label}</Link>)}</nav>
        <button onClick={() => signOut()} className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600"><LogOut className="h-4 w-4" />Sign out</button>
      </aside>
      <main className="lg:pl-72"><div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div></main>
    </div>
  );
}

function DashboardPage() {
  return <><RebuildHeader title="Launch Dashboard" subtitle="Stable customer workflows for sessions, resumes, projects, billing, and support." /><div className="grid gap-5 md:grid-cols-3"><RebuildCard><p className="text-sm font-bold text-slate-500">Launch status</p><p className="mt-3 text-3xl font-black">Active</p></RebuildCard><RebuildCard><p className="text-sm font-bold text-slate-500">Primary workflow</p><p className="mt-3 text-3xl font-black">Sessions</p></RebuildCard><RebuildCard><p className="text-sm font-bold text-slate-500">Mode</p><p className="mt-3 text-3xl font-black">Production shell</p></RebuildCard></div></>;
}

function SessionsPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<LaunchSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { setLoading(true); setError(null); try { const token = await getToken(); const payload = await getJson<{ data?: LaunchSession[] }>("/api/session/list", token); setSessions(Array.isArray(payload.data) ? payload.data : []); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load sessions"); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const create = async () => { setCreating(true); setError(null); try { const token = await getToken(); const session = await postForm<LaunchSession>("/api/session/create-session", token, { companyName: "Practice Session", round: "Practice", jobDescription: "General interview practice", language: "English", simpleLanguage: "false", instructions: "Answer in first person with structure, keywords, and practical examples.", free: "true", autoGenerateAI: "true", saveTranscript: "true", projectIds: "[]" }); navigate(`/sessions/${session.id}`); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create session"); } finally { setCreating(false); } };
  return <><RebuildHeader title="Sessions" subtitle="Create, start, answer, save transcript, and review." action={<button onClick={create} disabled={creating} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60"><Plus className="mr-2 inline h-4 w-4" />{creating ? "Creating" : "New free session"}</button>} />{error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}{loading ? <RebuildEmpty text="Loading sessions..." /> : sessions.length ? <div className="grid gap-4">{sessions.map((s) => <RebuildCard key={s.id} className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><p className="text-xs font-black uppercase text-blue-600">{s.status || "UNKNOWN"}</p><h3 className="mt-2 text-xl font-black">{s.companyName || "Untitled Session"}</h3><p className="mt-1 text-sm text-slate-500">{s.round || "Practice"} • {formatDisplayDate(s.createdAt)}</p></div><button onClick={() => navigate(`/sessions/${s.id}`)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black"><Play className="mr-2 inline h-4 w-4" />Open</button></RebuildCard>)}</div> : <RebuildEmpty text="No sessions yet." />}</>;
}

function ResumePage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<LaunchResume[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const token = await getToken(); const p = await getJson<{ data?: LaunchResume[] }>("/api/resume/list", token); setRows(Array.isArray(p.data) ? p.data : []); } finally { setLoading(false); } })(); }, []);
  return <><RebuildHeader title="Resumes" subtitle="Stable resume library surface." />{loading ? <RebuildEmpty text="Loading resumes..." /> : rows.length ? <div className="grid gap-4 md:grid-cols-2">{rows.map((r) => <RebuildCard key={r.id}><h3 className="font-black">{r.title || r.filename || "Resume"}</h3><p className="mt-2 text-sm text-slate-500">{r.source || "uploaded"}</p></RebuildCard>)}</div> : <RebuildEmpty text="No resumes found." />}</>;
}

function ProjectsPage() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<LaunchProject[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const token = await getToken(); const p = await getJson<{ data?: LaunchProject[]; projects?: LaunchProject[] }>("/api/projects/mine", token); setRows(Array.isArray(p.data) ? p.data : Array.isArray(p.projects) ? p.projects : []); } finally { setLoading(false); } })(); }, []);
  return <><RebuildHeader title="Projects" subtitle="Project context library." />{loading ? <RebuildEmpty text="Loading projects..." /> : rows.length ? <div className="grid gap-4 md:grid-cols-2">{rows.map((p) => <RebuildCard key={p.id}><h3 className="font-black">{p.title || "Project"}</h3><p className="mt-2 text-sm text-slate-500">{p.description || p.roleType || "No description"}</p></RebuildCard>)}</div> : <RebuildEmpty text="No projects found." />}</>;
}

function BillingPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<any>(null);
  useEffect(() => { (async () => { const token = await getToken(); const p = await getJson<any>("/api/credits/balance", token).catch(() => null); setData(p?.data || p || {}); })(); }, []);
  return <><RebuildHeader title="Billing" subtitle="Credit balance and plan surface." /><div className="grid gap-5 md:grid-cols-3"><RebuildCard><p className="text-sm font-bold text-slate-500">Purchased</p><p className="mt-3 text-3xl font-black">{data?.purchasedCredits ?? 0}</p></RebuildCard><RebuildCard><p className="text-sm font-bold text-slate-500">Earned</p><p className="mt-3 text-3xl font-black">{data?.earnedCredits ?? 0}</p></RebuildCard><RebuildCard><p className="text-sm font-bold text-slate-500">Held</p><p className="mt-3 text-3xl font-black">{data?.heldCredits ?? 0}</p></RebuildCard></div></>;
}

function HelpPage() { return <><RebuildHeader title="Help" subtitle="Customer support and launch-safe guidance." /><RebuildCard><h3 className="text-xl font-black">Support</h3><p className="mt-2 text-sm text-slate-500">Contact support for account, billing, session, or desktop help.</p></RebuildCard></>; }

export default function LaunchApp() {
  const { isLoaded, isSignedIn, user } = useUser();
  const firstName = useMemo(() => user?.firstName || user?.primaryEmailAddress?.emailAddress || "there", [user]);
  if (!isLoaded) return <div className="grid min-h-screen place-items-center">Loading...</div>;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return <Shell><div className="mb-5 rounded-3xl bg-slate-950 px-5 py-4 text-white"><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Welcome</p><p className="font-black">{firstName}</p></div><Routes><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<DashboardPage />} /><Route path="/sessions" element={<SessionsPage />} /><Route path="/sessions/:id" element={<LaunchActiveSession />} /><Route path="/resume/all" element={<ResumePage />} /><Route path="/ai-projects" element={<ProjectsPage />} /><Route path="/billing" element={<BillingPage />} /><Route path="/help" element={<HelpPage />} /><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes></Shell>;
}
