import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ArrowLeft, Bot, FileText, Loader2, Send } from "lucide-react";
import { getJson } from "./http";
import { RebuildCard, RebuildEmpty, RebuildHeader, formatDisplayDate } from "./ui";

type NoteMessage = {
  id: string;
  role?: string | null;
  content?: string | null;
  text?: string | null;
  question?: string | null;
  answer?: string | null;
  source?: string | null;
  createdAt?: string | null;
};

export default function LaunchSessionReview() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<NoteMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const payload = await getJson<any>(`/api/session-notes/${id}`, token);
        const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.transcript) ? payload.transcript : [];
        setMessages(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load review");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="grid min-h-screen place-items-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-6xl">
        <Link to={id ? `/sessions/${id}` : "/sessions"} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Back to session</Link>
        <RebuildHeader title="Session Review" subtitle="Transcript, generated answers, notes, and session-scoped Ask AI." />
        {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <RebuildCard>
            <div className="mb-4 flex items-center gap-2"><FileText className="h-4 w-4" /><h2 className="text-lg font-black">Transcript and Answers</h2></div>
            {messages.length ? <div className="space-y-3">{messages.map((m) => <div key={m.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-2 flex items-center justify-between"><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black uppercase text-slate-500">{m.role || m.source || "note"}</span><span className="text-xs font-semibold text-slate-400">{formatDisplayDate(m.createdAt)}</span></div><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{m.answer || m.content || m.text || m.question || "—"}</p></div>)}</div> : <RebuildEmpty text="No transcript or answers saved yet." />}
          </RebuildCard>
          <AskAiPanel sessionId={id || ""} />
        </div>
      </div>
    </div>
  );
}

function AskAiPanel({ sessionId }: { sessionId: string }) {
  const { getToken } = useAuth();
  const [query, setQuery] = useState("Summarize weak answers and key improvement areas");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!sessionId || !query.trim()) return;
    setBusy(true);
    setAnswer("");
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || ""}/api/ask-ai/${sessionId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) throw new Error("Ask AI failed");
      const text = await res.text();
      const cleaned = text.split("\n").map((line) => {
        if (!line.startsWith("data: ")) return "";
        try { return JSON.parse(line.slice(6)).content || ""; } catch { return ""; }
      }).join("");
      setAnswer(cleaned || text || "No response returned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask AI failed");
    } finally {
      setBusy(false);
    }
  };

  return <RebuildCard><div className="mb-4 flex items-center gap-2"><Bot className="h-4 w-4" /><h2 className="text-lg font-black">Ask AI</h2></div>{error && <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}<textarea value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none" /><button onClick={ask} disabled={busy || !query.trim()} className="mt-3 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><Send className="mr-2 inline h-4 w-4" />{busy ? "Asking" : "Ask AI"}</button><div className="mt-4 min-h-72 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">{answer || "Ask AI response will appear here."}</div></RebuildCard>;
}
