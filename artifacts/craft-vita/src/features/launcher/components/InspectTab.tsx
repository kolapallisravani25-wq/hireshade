import React, { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import { Activity, Wifi, WifiOff, LayoutDashboard, History, CreditCard, ExternalLink, Loader2, Cpu, Tag, RefreshCw } from "lucide-react";
import { checkForUpdates, getPendingUpdate, restartToApplyDownloadedUpdate } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { useInspectAuth } from "@/features/launcher/components/InspectAuthContext";
import { BACKEND_URL, FRONTEND_URL, APP_NAME } from "@/features/launcher/constants";

type HealthStatus = "checking" | "ok" | "error";

type CreditsBalance = { totalAvailable?: string; heldCredits?: string } | null;

function useBackendHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!cancelled) setStatus(res.ok ? "ok" : "error");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };
    check();
    return () => { cancelled = true; };
  }, []);

  return status;
}

function useInspectCredits(token: string | null): { balance: CreditsBalance; isLoading: boolean } {
  const [balance, setBalance] = useState<CreditsBalance>(null);
  const [loadedForToken, setLoadedForToken] = useState<string | null>(null);
  const isLoading = !!token && loadedForToken !== token;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((json) => { if (!cancelled) setBalance(json.data ?? json); })
      .catch(() => { if (!cancelled) setBalance(null); })
      .finally(() => { if (!cancelled) setLoadedForToken(token); });
    return () => { cancelled = true; };
  }, [token]);

  return { balance, isLoading };
}

export function InspectTab() {
  const { token, email, userId } = useInspectAuth();
  const { balance, isLoading: isLoadingBalance } = useInspectCredits(token);
  const health = useBackendHealth();
  const [appVersion, setAppVersion] = useState<string>("…");
  const [pendingUpdateVersion, setPendingUpdateVersion] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("—"));
  }, []);

  useEffect(() => {
    const syncPending = () => {
      const pending = getPendingUpdate();
      setPendingUpdateVersion(pending?.availableVersion ?? null);
    };
    syncPending();
    window.addEventListener("updater:pending-changed", syncPending);
    return () => window.removeEventListener("updater:pending-changed", syncPending);
  }, []);

  const credits = balance
    ? `${parseFloat(balance.totalAvailable ?? "0").toFixed(1)} available`
    : isLoadingBalance
      ? "loading…"
      : token
        ? "—"
        : "sign in required";
  const held = balance?.heldCredits ? `${parseFloat(balance.heldCredits).toFixed(1)} held` : null;

  const row = "flex items-center justify-between py-2 border-b border-zinc-100 last:border-0";
  const key = "text-xs font-semibold text-zinc-500 flex items-center gap-1.5";
  const val = "text-xs font-medium text-zinc-800 text-right max-w-[200px] truncate";

  return (
    <div className="px-4 py-3 flex flex-col gap-4">

      {/* ── Status ─────────────────────────────────────────────────────────── */}
      <section>
        <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Status</p>
        <div className="bg-zinc-50 rounded-2xl px-3 divide-y divide-zinc-100">

          <div className={row}>
            <span className={key}>
              {health === "checking"
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : health === "ok"
                  ? <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                  : <WifiOff className="w-3.5 h-3.5 text-red-400" />}
              Backend
            </span>
            <span className={cn(
              val,
              health === "ok" ? "text-emerald-600" :
              health === "error" ? "text-red-500" : "text-zinc-500",
            )}>
              {health === "checking" ? "Checking…" : health === "ok" ? "Connected" : "Unreachable"}
            </span>
          </div>

          <div className={row}>
            <span className={key}><Activity className="w-3.5 h-3.5 text-zinc-400" />App</span>
            <span className={val}>{APP_NAME}</span>
          </div>

          <div className={row}>
            <span className={key}><Tag className="w-3.5 h-3.5 text-zinc-400" />Version</span>
            <div className="flex items-center gap-2">
              <span className={cn(val, "font-mono text-[11px]")}>v{appVersion}</span>
              <button
                onClick={() => checkForUpdates(true)}
                title="Check for updates"
                className="p-0.5 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {pendingUpdateVersion && (
            <div className={row}>
              <span className={key}>
                <RefreshCw className="w-3.5 h-3.5 text-amber-500" />
                Update Ready
              </span>
              <div className="flex items-center gap-2">
                <span className={cn(val, "text-amber-700")}>v{pendingUpdateVersion} downloaded</span>
                <button
                  onClick={() => {
                    setIsRestarting(true);
                    restartToApplyDownloadedUpdate().catch(() => setIsRestarting(false));
                  }}
                  className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
                  disabled={isRestarting}
                >
                  {isRestarting ? "Restarting…" : "Restart"}
                </button>
              </div>
            </div>
          )}

        </div>
      </section>

      {/* ── Account ────────────────────────────────────────────────────────── */}
      <section>
        <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Account</p>
        <div className="bg-zinc-50 rounded-2xl px-3 divide-y divide-zinc-100">

          <div className={row}>
            <span className={key}><span className="w-3.5 h-3.5 inline-block">@</span>Email</span>
            <span className={val}>{email}</span>
          </div>

          <div className={row}>
            <span className={key}><Cpu className="w-3.5 h-3.5 text-zinc-400" />User ID</span>
            <span className={cn(val, "font-mono text-[11px]")}>{userId.slice(0, 12)}{userId.length > 12 ? "…" : ""}</span>
          </div>

          <div className={row}>
            <span className={key}><CreditCard className="w-3.5 h-3.5 text-amber-500" />Credits</span>
            <span className={cn(val, "text-zinc-800")}>
              {credits}
              {held ? <span className="text-zinc-400 ml-1">({held})</span> : null}
            </span>
          </div>

        </div>
      </section>

      {/* ── Quick links ────────────────────────────────────────────────────── */}
      <section>
        <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide mb-2">Quick Links</p>
        <div className="flex flex-col gap-1.5">
          {([
            { label: "Dashboard",      href: "/dashboard",  Icon: LayoutDashboard },
            { label: "Past Sessions",  href: "/sessions",   Icon: History         },
            { label: "Billing",        href: "/billing",    Icon: CreditCard      },
          ] as const).map(({ label, href, Icon }) => (
            <button
              key={href}
              onClick={() => openUrl(`${FRONTEND_URL}${href}`).catch(console.error)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 transition-all text-left active:scale-[0.98]"
            >
              <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-zinc-800">{label}</span>
              </div>
              <ExternalLink className="w-3 h-3 text-zinc-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      </section>

    </div>
  );
}
