import { useEffect, useState } from "react";
import { useSignIn, useClerk, useAuth } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleOAuthButton } from "@/components/GoogleOAuthButton";
import {
  clearDesktopClerkSessionId,
} from "@/lib/desktopClerkSession";
import { emitDesktopAuthStateChanged, persistDesktopSession } from "@/lib/desktopAuthSession";

type Step = "email" | "password";

// ── Tauri return helper ────────────────────────────────────────────────────────
// After the user signs in, redirect the browser to the local HTTP server that
// the Tauri widget started (tauri-plugin-oauth). The server receives the request,
// fires oauth://url, and the widget signs in with the ticket.
//
// Port is passed as ?port=PORT in the sign-in URL and stored in sessionStorage
// so it survives internal React Router navigations.
export async function returnToTauri(getToken: () => Promise<string | null>) {
  const rawPort = sessionStorage.getItem("tauri_auth_port");
  if (!rawPort) {
    console.error("[tauri-auth] No tauri_auth_port in sessionStorage — widget may have timed out");
    return;
  }
  // SECURITY: the port is used to build the ticket-delivery URL. It is
  // attacker-influenceable (it arrives as ?port= in the sign-in URL, which a
  // phishing link controls). Without strict validation, a value like
  // "@evil.com" turns `http://127.0.0.1:${port}/` into
  // `http://127.0.0.1:@evil.com/` — where 127.0.0.1 is parsed as userinfo and
  // the real host becomes evil.com, exfiltrating the freshly-minted Clerk
  // sign-in ticket (a full-session credential) to the attacker.
  // Only accept a bare integer in the ephemeral/registered port range.
  if (!/^\d{1,5}$/.test(rawPort)) {
    console.error("[tauri-auth] Rejected non-numeric callback port:", rawPort);
    sessionStorage.removeItem("from_tauri");
    sessionStorage.removeItem("tauri_auth_port");
    return;
  }
  const portNum = Number(rawPort);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    console.error("[tauri-auth] Rejected out-of-range callback port:", rawPort);
    sessionStorage.removeItem("from_tauri");
    sessionStorage.removeItem("tauri_auth_port");
    return;
  }
  try {
    const token = await getToken();
    console.log("[tauri-auth] token:", token ? "ok" : "null");
    if (token) {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/auth/tauri-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      console.log("[tauri-auth] ticket endpoint:", res.status);
      if (res.ok) {
        const { ticket } = await res.json();
        sessionStorage.removeItem("from_tauri");
        sessionStorage.removeItem("tauri_auth_port");
        // Host is hard-pinned to the loopback literal; only the validated
        // numeric port is interpolated. The ticket value is encoded.
        window.location.href = `http://127.0.0.1:${portNum}/?ticket=${encodeURIComponent(ticket)}`;
        return;
      }
    }
  } catch (err) {
    console.warn("[tauri-auth] ticket fetch failed:", err);
  }
  console.error("[tauri-auth] Failed to obtain ticket — widget will not sign in");
}

const SignInPage = () => {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { signOut } = useClerk();
  const { isSignedIn, getToken } = useAuth();
  const navigate = useNavigate();

  // If ?from=tauri is present, persist it so even after navigate/redirect
  // inside the app we remember the user came from the widget.
  const fromTauriParam = new URLSearchParams(window.location.search).get("from") === "tauri";
  const portParam = new URLSearchParams(window.location.search).get("port");
  useEffect(() => {
    if (fromTauriParam) {
      sessionStorage.setItem("from_tauri", "true");
    }
    if (portParam) {
      sessionStorage.setItem("tauri_auth_port", portParam);
    }
  }, [fromTauriParam, portParam]);

  const fromTauri = fromTauriParam || sessionStorage.getItem("from_tauri") === "true";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const afterSignIn = async () => {
    if (fromTauri) {
      await returnToTauri(() => getToken());
    } else {
      navigate("/dashboard");
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn!.create({ identifier: email });
      if (result.status === "complete") {
        const createdSessionId = result.createdSessionId;
        if (!createdSessionId) throw new Error("Clerk did not return a session id");
        await setActive!({ session: createdSessionId });
        await persistDesktopSession(createdSessionId);
        await emitDesktopAuthStateChanged({
          source: "main",
          sessionId: createdSessionId,
          signedIn: true,
        });
        await afterSignIn();
      } else {
        setStep("password");
      }
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[] };
      setError(e?.errors?.[0]?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setError("");
    setLoading(true);
    try {
      const result = await signIn!.attemptFirstFactor({ strategy: "password", password });
      if (result.status === "complete") {
        const createdSessionId = result.createdSessionId;
        if (!createdSessionId) throw new Error("Clerk did not return a session id");
        await setActive!({ session: createdSessionId });
        await persistDesktopSession(createdSessionId);
        await emitDesktopAuthStateChanged({
          source: "main",
          sessionId: createdSessionId,
          signedIn: true,
        });
        await afterSignIn();
      } else {
        setError("Sign-in incomplete. Please try again.");
      }
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[] };
      setError(e?.errors?.[0]?.message ?? "Incorrect password");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep("email");
    setPassword("");
    setError("");
    clearDesktopClerkSessionId();
    signOut();
  };

  // ── Already signed in + came from Tauri → auto-redirect ────────────────
  // Fire returnToTauri immediately on mount. Show a manual button as fallback
  // in case the redirect is slow or the user dismisses it.
  const [autoRedirecting, setAutoRedirecting] = useState(false);
  const [autoRedirectDone, setAutoRedirectDone] = useState(false);
  useEffect(() => {
    if (isLoaded && isSignedIn && fromTauri && !autoRedirectDone) {
      setAutoRedirecting(true);
      setAutoRedirectDone(true);
      returnToTauri(() => getToken()).finally(() => setAutoRedirecting(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, fromTauri]);

  if (isLoaded && isSignedIn && fromTauri) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-4">
        <div className="w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 bg-white p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mx-auto">
            {autoRedirecting ? (
              <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">You're signed in!</h1>
            <p className="mt-1 text-sm text-slate-500">
              {autoRedirecting ? "Returning to HireShade…" : "Ready to return to HireShade."}
            </p>
          </div>
          <button
            type="button"
            disabled={autoRedirecting}
            onClick={() => returnToTauri(() => getToken())}
            className="w-full h-11 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800 transition active:scale-[0.97] disabled:opacity-60"
          >
            ↩ Open HireShade
          </button>
          <button
            type="button"
            onClick={() => {
              clearDesktopClerkSessionId();
              signOut();
              sessionStorage.removeItem("from_tauri");
              sessionStorage.removeItem("tauri_auth_port");
            }}
            className="w-full text-xs text-slate-400 hover:text-slate-600 transition"
          >
            Sign in as a different user
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-2xl shadow-xl border border-slate-100 bg-white">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Sign in to HireShade</h1>
          {fromTauri && (
            <p className="mt-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-full px-3 py-1 inline-block">
              Signing in for HireShade desktop app
            </p>
          )}
          {!fromTauri && (
            <p className="mt-1.5 text-sm text-slate-500">Welcome back! Please sign in to continue</p>
          )}
        </div>

        {step === "email" && (
          <>
            <div className="px-8 pb-4">
              <GoogleOAuthButton label="Continue with Google" />
            </div>
            <div className="flex items-center gap-3 px-8 pb-5">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-medium text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          </>
        )}

        <div className="px-8 pb-8">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email address</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !isLoaded}
                className="w-full h-10 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Checking…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !isLoaded}
                className="w-full h-10 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" onClick={handleBack} className="w-full text-sm text-slate-500 hover:text-slate-700 transition">
                ← Use a different account
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <Link to="/sign-up" className="font-medium text-blue-600 hover:text-blue-500 transition">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
