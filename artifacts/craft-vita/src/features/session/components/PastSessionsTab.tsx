import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, ExternalLink, Briefcase, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { safeJson } from "@/shared/utils/safeJson";
import { formatRelativeDate, sessionStatusLabel } from "@/shared/utils/formatters";
import { BACKEND_URL, FRONTEND_URL } from "@/features/launcher/constants";
import type { PastSession } from "@/features/launcher/types";

export function PastSessionsTab() {
  const { getToken } = useAuth();
  const [sessions, setSessions] = useState<PastSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let userId = localStorage.getItem("userId");
        if (!userId) {
          const token = await getToken();
          if (token) {
            const meRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (meRes.ok) {
              const meData = await safeJson<{ id: string }>(meRes);
              if (meData?.id) {
                userId = meData.id;
                localStorage.setItem("userId", userId);
              }
            }
          }
        }
        if (!userId || cancelled) return;

        const token = await getToken();
        const res = await fetch(
          `${BACKEND_URL}/api/session/list?userId=${userId}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (!res.ok || cancelled) return;
        const data = await safeJson<unknown>(res);
        const all: PastSession[] = Array.isArray(data)
          ? data
          : ((data as any)?.data ?? []);
        if (!cancelled) setSessions(all.slice(0, 3));
      } catch (e) {
        console.error("[PastSessionsTab] fetch error", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Live statuses where the user should land on the live ActiveSession page.
  // Anything else (COMPLETED, ABANDONED, FORCE_ENDED, AUTO_ENDED, CREDIT_EXHAUSTED,
  // COMPLETING, PRE_CHECK) is treated as terminal/summary-only — open the
  // sessions list with the transcript dialog auto-opened for that session.
  const LIVE_STATUSES = new Set(["ACTIVE", "PAUSED", "DISCONNECTED"]);
  const openSession = (s: PastSession) => {
    const isLive = s.status && LIVE_STATUSES.has(String(s.status).toUpperCase());
    const url = isLive
      ? `${FRONTEND_URL}/sessions/${s.id}`
      : `${FRONTEND_URL}/sessions?view=${s.id}`;
    openUrl(url).catch(console.error);
  };

  return (
    <div className="flex flex-col gap-2 px-3 pt-3 pb-4">
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center">
            <History className="w-4 h-4 text-zinc-400" />
          </div>
          <p className="text-xs text-zinc-500 text-center leading-snug">
            No past sessions yet. Start your first one!
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide px-0.5">
            Recent Sessions
          </p>
          {sessions.map((s) => {
            const { label, color } = sessionStatusLabel(s.status);
            const title =
              [s.position, s.companyName].filter(Boolean).join(" @ ") ||
              "Session";
            return (
              <button
                key={s.id}
                onClick={() => openSession(s)}
                className="w-full flex items-center gap-3 p-3 rounded-2xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-100 hover:border-zinc-200 transition-all active:scale-[0.98] text-left"
              >
                <div className="w-8 h-8 rounded-xl bg-zinc-200 flex items-center justify-center flex-shrink-0">
                  <Briefcase className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-800 truncate">
                    {title}
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {formatRelativeDate(s.createdAt)}
                    {s.isFree ? " · Free" : " · Premium"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                      color,
                    )}
                  >
                    {label}
                  </span>
                  <ExternalLink className="w-3 h-3 text-zinc-400" />
                </div>
              </button>
            );
          })}
        </>
      )}
      <button
        onClick={() =>
          openUrl(`${FRONTEND_URL}/sessions`).catch(console.error)
        }
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-semibold transition-all active:scale-[0.97] mt-1"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        View All Sessions
      </button>
    </div>
  );
}
