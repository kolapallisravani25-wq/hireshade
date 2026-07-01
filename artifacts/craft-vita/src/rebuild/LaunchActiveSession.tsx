import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { ArrowLeft, Loader2, Play, Save, Square, Wand2 } from "lucide-react";
import { getJson, postJson } from "./http";
import { RebuildCard, RebuildEmpty, RebuildHeader, formatDisplayDate } from "./ui";
import type { LaunchSession } from "./types";

type Msg = { id: string; role: string; content?: string | null; answer?: string | null; question?: string | null; createdAt?: string | null };

export default function LaunchActiveSession() {
  const { id } = useParams();
  const { getToken } = useAuth();
  const [session, setSession] = useState<LaunchSession | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const token = await getToken();
      const data = await getJson<LaunchSession & { messages?: Msg[] }>(`/api/session/${id}`, token);
      setSession(data);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load session");
    }
  };

  useEffect(() => { void load(); }, [id]);

  const start = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const token = await getToken();
      await postJson(`/api/session/${id}/activate`, token);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to start session"); }
    finally { setBusy(false); }
  };

  const end = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const token = await getToken();
      await postJson(`/api/session/${id}/deactivate`, token);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to end session"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!id || !transcript.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      await postJson(`/api/session/${id}/save-message`, token, { role: "transcript", content: transcript.trim() });
      setTranscript("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save transcript"); }
    finally { setBusy(false); }
  };

  const generate = async () => {
    if (!id) return;
    const source = transcript.trim() || messages.map((m) => m.content || m.question || "").join("\n").slice(-3000);
    if (!source) { setError("Add transcript or question first."); return; }
    setBusy(true);
    setAnswer("");
    try {
      const token = await getToken();
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL || ""}/api/session/${id}/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentQuestion: source, transcript: source, answerMode: "auto" }),
      });
      if (!res.ok) throw new Error("Answer generation failed");
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setAnswer(full);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Answer generation failed"); }
    finally { setBusy(false); }
  };

  if (!session && !error) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#f6f7fb] p-5 text-slate-950 md:p-8">
      <div className="mx-auto max-w-7xl">
        <Link to="/sessions" className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />Back to sessions</Link>
        <RebuildHeader title={session?.companyName || "Session"} subtitle={`${session?.status || "UNKNOWN"} • Started ${formatDisplayDate(session?.startedAt)}`} action={session?.status === "ACTIVE" ? <button onClick={end} disabled={busy} className="rounded-2xl bg-red-500 px-5 py-3 text-sm font-black text-white"><Square className="mr-2 inline h-4 w-4" />End</button> : <button onClick={start} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white"><Play className="mr-2 inline h-4 w-4" />Start</button>} />
        {error && <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
        <div className="grid gap-5 lg:grid-cols-2">
          <RebuildCard>
            <h2 className="mb-3 text-lg font-black">Transcript</h2>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="min-h-48 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none" placeholder="Type or paste transcript/question here..." />
            <div className="mt-3 flex flex-wrap gap-3">
              <button onClick={save} disabled={busy || !transcript.trim()} className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><Save className="mr-2 inline h-4 w-4" />Save</button>
              <button onClick={generate} disabled={busy} className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><Wand2 className="mr-2 inline h-4 w-4" />Generate</button>
            </div>
          </RebuildCard>
          <RebuildCard>
            <h2 className="mb-3 text-lg font-black">AI Answer</h2>
            <div className="min-h-60 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-sm leading-6 text-white">{answer || "Generated answer will appear here."}</div>
          </RebuildCard>
          <RebuildCard className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-black">Saved Timeline</h2>
            {messages.length ? <div className="space-y-3">{messages.map((m) => <div key={m.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase text-slate-400">{m.role} • {formatDisplayDate(m.createdAt)}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{m.answer || m.content || m.question || "—"}</p></div>)}</div> : <RebuildEmpty text="No saved transcript yet." />}
          </RebuildCard>
        </div>
      </div>
    </div>
  );
}
