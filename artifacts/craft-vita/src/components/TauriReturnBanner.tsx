import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { returnToTauri } from "@/pages/Auth/SignIn/page";

export function TauriReturnBanner() {
  const { isSignedIn, getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fromTauri = sessionStorage.getItem("from_tauri") === "true";

  // Auto-redirect as soon as we land here with a port in sessionStorage.
  // This covers the case where the user was already signed in and App.tsx
  // redirected /sign-in?from=tauri&port=PORT straight to /dashboard.
  useEffect(() => {
    if (!fromTauri || !isSignedIn || dismissed) return;
    const port = sessionStorage.getItem("tauri_auth_port");
    if (!port) return;
    let timerId = 0;
    setLoading(true);
    returnToTauri(() => getToken()).finally(() => {
      timerId = window.setTimeout(() => setLoading(false), 3000);
    });
    return () => clearTimeout(timerId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, fromTauri]);

  if (!fromTauri || !isSignedIn || dismissed) return null;

  const handleReturn = async () => {
    setLoading(true);
    await returnToTauri(() => getToken());
    setTimeout(() => setLoading(false), 3000);
  };

  const handleDismiss = () => {
    sessionStorage.removeItem("from_tauri");
    sessionStorage.removeItem("tauri_auth_port");
    setDismissed(true);
  };

  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-3 bg-zinc-900 text-white px-4 py-2.5 shadow-lg">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 17l-5-5m0 0l5-5m-5 5h16" />
            </svg>
          )}
        </div>
        <span className="text-sm font-medium truncate">
          {loading ? "Returning to HireShade…" : "You signed in via HireShade desktop"}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={handleReturn}
          disabled={loading}
          className="text-xs font-semibold bg-white text-zinc-900 rounded-lg px-3 py-1.5 hover:bg-zinc-100 transition disabled:opacity-60"
        >
          {loading ? "Redirecting…" : "↩ Return to HireShade"}
        </button>
        <button
          onClick={handleDismiss}
          className="text-zinc-400 hover:text-white transition p-1"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>

        </button>
      </div>
    </div>
  );
}
