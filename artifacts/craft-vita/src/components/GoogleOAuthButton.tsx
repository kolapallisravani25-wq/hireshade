import { useState } from "react";
import { useSignIn, useClerk } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { start, cancel } from "@fabianlars/tauri-plugin-oauth";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "../lib/utils";

interface GoogleOAuthButtonProps {
  label?: string;
}

export function GoogleOAuthButton({ label = "Continue with Google" }: GoogleOAuthButtonProps) {
  const { signIn, isLoaded } = useSignIn();
  const { handleRedirectCallback, setActive, client } = useClerk();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (!isLoaded || loading) return;
    setLoading(true);
    setError(null);

    if (!isTauri()) {
      // Standard web browser fallback (Vercel deployment / dev server)
      try {
        await signIn!.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/dashboard",
        });
      } catch (err: unknown) {
        const e = err as { errors?: { longMessage?: string; message?: string }[]; message?: string };
        setError(e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || "Google sign-in failed");
        setLoading(false);
      }
      return;
    }

    let port: number | undefined;
    let unlisten: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // 1. Start the localhost OAuth capture server. The success page shown in
      //    the system browser is purely cosmetic — the actual auth handshake is
      //    driven by the oauth://url Tauri event captured below.
      const successHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HireShade – Signed In</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;
         background:#0f0f12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb}
    .card{background:#1a1a24;border:1px solid #2d2d3a;border-radius:16px;padding:40px 48px;
          text-align:center;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
    .icon{width:56px;height:56px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
          border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .icon svg{width:28px;height:28px}
    h1{font-size:1.4rem;font-weight:600;color:#f9fafb;margin-bottom:8px}
    p{font-size:.9rem;color:#9ca3af;line-height:1.5}
    .note{margin-top:20px;font-size:.78rem;color:#6b7280}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    <h1>You're signed in!</h1>
    <p>Authentication successful. Switch back to the HireShade app to continue.</p>
    <p class="note">You may close this tab.</p>
  </div>
</body>
</html>`;

      // Fixed port so Clerk's Allowed Redirect URLs can be whitelisted.
      // In Clerk Dashboard → Redirects → Allowed redirect URLs, add:
      //   http://localhost:10001
      // A random port can never be pre-approved by Clerk, which causes the
      // "cannot redirect to your application" fallback page.
      const OAUTH_PORT = 10001;
      port = await start({ ports: [OAUTH_PORT], response: successHtml });
      const callbackUrl = `http://localhost:${port}`;

      // 2. Register the event listener synchronously inside the Promise constructor
      //    so it is guaranteed active before openUrl() is called (eliminates race).
      const callbackPromise = new Promise<URL>((resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Google sign-in timed out (2 min)")),
          120_000,
        );
        listen<string>("oauth://url", (event) => {
          clearTimeout(timeoutId);
          try { resolve(new URL(event.payload)); }
          catch { reject(new Error("Invalid callback URL received")); }
        }).then((fn) => { unlisten = fn; });
      });

      // 3. Prepare the Clerk OAuth flow — returns the Google authorization URL
      const result = await signIn!.create({
        strategy: "oauth_google",
        redirectUrl: callbackUrl,
        actionCompleteRedirectUrl: callbackUrl,
      });

      const authUrl =
        result.firstFactorVerification.externalVerificationRedirectURL?.toString();
      if (!authUrl) throw new Error("No OAuth URL returned from Clerk");

      // 4. Open Google OAuth in the OS browser via tauri-plugin-opener
      await openUrl(authUrl);

      // 5. Wait for the browser to complete OAuth and hit our localhost server
      const callbackParsed = await callbackPromise;

      // 6. Update window.location so handleRedirectCallback can read the
      //    __clerk_handshake params. replaceState does NOT fire a popstate
      //    event, which means:
      //      - React Router does NOT re-render (SignIn stays in the tree)
      //      - ClerkProvider does NOT detect a route change or re-process the URL
      //      - The handshake token is NOT auto-consumed before we call it
      window.history.replaceState({}, "", `/sso-callback${callbackParsed.search}`);
      getCurrentWebviewWindow().setFocus().catch(() => undefined);

      // 7. Process the handshake token here — single controlled execution point.
      //    Clerk reads params from window.location (set by replaceState above),
      //    establishes the session, then calls routerPush via ClerkProvider.
      await handleRedirectCallback({
        signInForceRedirectUrl: "/dashboard",
        signUpForceRedirectUrl: "/dashboard",
      });

      // Belt-and-suspenders: ensure session is active and navigate
      const session = client?.activeSessions?.[0];
      if (session) await setActive({ session: session.id }).catch(() => undefined);
      navigate("/dashboard", { replace: true });

      // Defer cancel — give the browser ~3 s to finish loading the success page.
      const capturedPort = port;
      port = undefined;
      setTimeout(() => {
        cancel(capturedPort).catch(() => undefined);
      }, 3000);

    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (port !== undefined) {
        await cancel(port).catch(() => undefined);
        port = undefined;
      }
      const e = err as { errors?: { message: string }[]; message?: string };
      setError(e?.errors?.[0]?.message ?? e?.message ?? "Google sign-in failed");
      setLoading(false);
    } finally {
      unlisten?.();
    }
  };

  return (
    <div>
      {error && (
        <p className="text-red-500 text-sm mb-2 text-center">{error}</p>
      )}
      <button
        onClick={handleClick}
        disabled={loading || !isLoaded}
        className="w-full flex items-center justify-center gap-3 h-10 px-4 border border-slate-200 rounded-lg bg-white text-slate-900 font-medium text-sm shadow-sm transition-all duration-150 hover:bg-slate-50 hover:shadow-md hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
          <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
        </svg>
        {loading ? "Opening browser…" : label}
      </button>
    </div>
  );
}
