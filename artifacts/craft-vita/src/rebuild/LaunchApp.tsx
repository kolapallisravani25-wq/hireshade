import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useUser } from "@clerk/clerk-react";
import { Briefcase, CreditCard, FileText, FolderKanban, HelpCircle, Home, Loader2, LogOut, MessageSquare, Play, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { LaunchProject, LaunchResume, LaunchSession } from "./types";

const API = import.meta.env.VITE_BACKEND_URL || "";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return "—";
  }
}

async function readJson<T>(path: string, token?: string | null): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postForm<T>(path: string, token: string | null | undefined, body: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.append(key, value);
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `${res.status} ${res.statusText}`);
  return payload as T;
}

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
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-black tracking-tight">HireShade</p>
            <p className="text-xs font-medium text-slate-500">Launch build</p>
          </div>
        </div>
        <nav className="space-y-1.5">
          {items.map(([href, label, Icon]) => (
            <Link
              key={href}
              to={href}
              className={cx(
                "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition",
                location.pathname.startsWith(href)
                  ? "bg-slate-950 text-white shadow-lg shadow-slate-900/15"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => signOut()}
          className="absolute bottom-5 left-5 right-5 flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </aside>
      <main className="lg:pl-72">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function Header({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 rounded-[2rem] border border-white bg-white/80 p-6 shadow-xl shadow-slate-200/70 backdrop-blur md:flex-row md:items-center">
      <div>
        <p className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-blue-600">HireShade</p>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("rounded-[1.7rem] border border-slate-200 bg-white p-5 shadow-sm", className)}>{children}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">{text}</div>;
}

function DashboardPage() {
  return (
    <>
      <Header title="Launch Dashboard" subtitle="Clean launch shell focused on stable customer workflows: sessions, resumes, projects, credits, and support." />
      <div className="grid gap-5 md:grid-cols-3">
        <Card><p className="text-sm font-bold text-slate-500">Launch status</p><p className="mt-3 text-3xl font-black">Active</p><p className="mt-2 text-sm text-slate-500">Stable modules only are exposed in this rebuild shell.</p></Card>
        <Card><p className="text-sm font-bold text-slate-500">Primary workflow</p><p className="mt-3 text-3xl font-black">Sessions</p><p className="mt-2 text-sm text-slate-500">Create, start, answer, review, and Ask AI.</p></Card>
        <Card><p className="text-sm font-bold text-slate-500">Mode</p><p className="mt-3 text-3xl font-black">Production</p><p className="mt-2 text-sm text-slate-500">No dummy data shown as real user content.</p></Card>
      </div>
    </>
  );
}

function SessionsPage() {
  const { getToken } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<LaunchSession[]>([]);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const payload = await readJson<{ data?: LaunchSession[] }>("/api/session/list", token);
      setSessions(Array.isArray(payload.data) ? payload.data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createFreeSession = async () => {
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      const session = await postForm<LaunchSession>("/api/session/create-session", token, {
        companyName: "Practice Session",
        round: "Practice",
        jobDescription: "General interview practice",
        language: "English",
        simpleLanguage: "false",
        extraContext: "",
        instructions: "Answer in first person with clear structure, keywords, and practical examples.",
        free: "true",
        autoGenerateAI: "true",
        saveTranscript: "true",
        projectIds: "[]",
      });
      navigate(`/sessions/${session.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create session");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Header
        title="Sessions"
        subtitle="Launch-safe session center with creation, rejoin, review, and clear error handling."
        action={<button onClick={createFreeSession} disabled={creating} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/20 disabled:opacity-60"><Plus className="h-4 w-4" />{creating ? "Creating..." : "New free session"}</button>}
      />
      {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {loading ? <Empty text="Loading sessions..." /> : sessions.length === 0 ? <Empty text="No sessions yet. Create a free practice session to begin." /> : (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <Card key={session.id} className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{session.status || "UNKNOWN"}</span>{session.free && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">FREE</span>}</div>
                <h3 className="mt-3 text-xl font-black">{session.companyName || "Untitled Session"}</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">{session.round || "Interview practice"} • {formatDate(session.createdAt)}</p>
              </div>
              <button onClick={() => navigate(`/sessions/${session.id}`)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700 hover:bg-slate-50"><Play className="h-4 w-4" />Open</button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ResumePage() {
  const { getToken } = useAuth();
  const [resumes, setResumes] = useState<LaunchResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const payload = await readJson<{ data?: LaunchResume[] }>("/api/resume/list", token);
        setResumes(Array.isArray(payload.data) ? payload.data : []);
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load resumes"); }
      finally { setLoading(false); }
    })();
  }, []);
  return <><Header title="Resumes" subtitle="Stable resume library surface for launch." />{error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}{loading ? <Empty text="Loading resumes..." /> : resumes.length ? <div className="grid gap-4 md:grid-cols-2">{resumes.map(r => <Card key={r.id}><h3 className="font-black">{r.title || r.filename || "Resume"}</h3><p className="mt-2 text-sm text-slate-500">{r.source || "uploaded"} • {formatDate(r.createdAt)}</p></Card>)}</div> : <Empty text="No resumes found." />}</>;
}

function ProjectsPage() {
  const { getToken } = useAuth();
  const [projects, setProjects] = useState<LaunchProject[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const token = await getToken(); const payload = await readJson<{ data?: LaunchProject[]; projects?: LaunchProject[] }>("/api/projects/mine", token); setProjects(Array.isArray(payload.data) ? payload.data : Array.isArray(payload.projects) ? payload.projects : []); } finally { setLoading(false); } })(); }, []);
  return <><Header title="Projects" subtitle="AI project library for answer grounding and preparation." />{loading ? <Empty text="Loading projects..." /> : projects.length ? <div className="grid gap-4 md:grid-cols-2">{projects.map(p => <Card key={p.id}><h3 className="font-black">{p.title || "Project"}</h3><p className="mt-2 text-sm text-slate-500">{p.description || p.roleType || "No description"}</p></Card>)}</div> : <Empty text="No projects found." />}</>;
}

function BillingPage() {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { (async () => { try { const token = await getToken(); setBalance(await readJson<any>("/api/credits/balance", token)); } finally { setLoading(false); } })(); }, []);
  const data = balance?.data || balance || {};
  return <><Header title="Billing and Credits" subtitle="Credit balance and plan surface for launch." />{loading ? <Empty text="Loading credits..." /> : <div className="grid gap-5 md:grid-cols-3"><Card><p className="text-sm font-bold text-slate-500">Purchased</p><p className="mt-3 text-3xl font-black">{data.purchasedCredits ?? 0}</p></Card><Card><p className="text-sm font-bold text-slate-500">Earned</p><p className="mt-3 text-3xl font-black">{data.earnedCredits ?? 0}</p></Card><Card><p className="text-sm font-bold text-slate-500">Held</p><p className="mt-3 text-3xl font-black">{data.heldCredits ?? 0}</p></Card></div>}</>;
}

function HelpPage() {
  return <><Header title="Help" subtitle="Customer-safe support page." /><Card><h3 className="text-xl font-black">Need help?</h3><p className="mt-2 text-sm leading-6 text-slate-500">Contact support for account, billing, session, or desktop help. This launch shell intentionally hides unfinished surfaces.</p></Card></>;
}

function ActiveSessionRedirect() {
  const location = useLocation();
  return <Navigate to={location.pathname} replace />;
}

export default function LaunchApp() {
  const { isLoaded, isSignedIn, user } = useUser();
  const firstName = useMemo(() => user?.firstName || user?.primaryEmailAddress?.emailAddress || "there", [user]);
  if (!isLoaded) return <div className="grid min-h-screen place-items-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-slate-900" /></div>;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return (
    <Shell>
      <div className="mb-5 flex items-center justify-between rounded-3xl bg-slate-950 px-5 py-4 text-white shadow-xl shadow-slate-900/20">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Welcome</p><p className="font-black">{firstName}</p></div>
        <RefreshCw className="h-4 w-4 text-slate-400" />
      </div>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:id" element={<ActiveSessionRedirect />} />
        <Route path="/resume/all" element={<ResumePage />} />
        <Route path="/ai-projects" element={<ProjectsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Shell>
  );
}
