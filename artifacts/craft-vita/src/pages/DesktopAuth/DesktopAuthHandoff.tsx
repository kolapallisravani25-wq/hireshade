import { useEffect, useRef, useState } from "react";
import { SignIn, useAuth } from "@clerk/clerk-react";

/**
 * Desktop auth handoff (external-browser flow, C1).
 *
 * The Tauri app opens this page in the system browser at
 *   https://hireshade.com/desktop-auth?port=<loopbackPort>
 * The user signs in here with production Clerk (which works in a real browser).
 * Once signed in, we call POST /api/desktop/link to mint a desktop refresh token
 * and hand it back to the app by redirecting to its loopback server:
 *   http://localhost:<port>/?desktop_refresh=<token>
 * The app stores the token (OS keychain) and exchanges it for short-lived access
 * tokens — no Clerk session lives in the webview, so it survives restarts.
 */
export function DesktopAuthHandoff() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [status, setStatus] = useState<
    "idle" | "linking" | "done" | "error"
  >("idle");
  const [message, setMessage] = useState<string>("");
  const startedRef = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const port = params.get("port");
  const returnUrl = `/desktop-auth${window.location.search}`;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      if (!port || !/^\d+$/.test(port)) {
        setStatus("error");
        setMessage(
          "Missing the app connection port. Please start the sign-in from the desktop app again.",
        );
        return;
      }

      setStatus("linking");
      try {
        const token = await getToken();
        const res = await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/desktop/link`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ label: "HireShade Desktop" }),
          },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setStatus("error");
          setMessage(
            body?.error ??
              "Couldn't link the desktop app. Please try again from the app.",
          );
          return;
        }

        const data = (await res.json()) as { refreshToken?: string };
        if (!data.refreshToken) {
          setStatus("error");
          setMessage("The server did not return a desktop token. Please try again.");
          return;
        }

        setStatus("done");
        // Hand the token back to the app's loopback server, then the app closes
        // this tab / the user returns to the app.
        window.location.href = `http://localhost:${port}/?desktop_refresh=${encodeURIComponent(
          data.refreshToken,
        )}`;
      } catch {
        setStatus("error");
        setMessage("Network error while linking the desktop app. Please try again.");
      }
    })();
  }, [isLoaded, isSignedIn, getToken, port]);

  // Still loading Clerk.
  if (!isLoaded) {
    return <CenteredCard title="Loading…" />;
  }

  // Not signed in yet — show the Clerk sign-in UI; after sign-in it returns here
  // (now signed in) and the effect above runs the handoff.
  if (!isSignedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-white p-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            Sign in to connect the desktop app
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            After you sign in, you'll be sent back to HireShade automatically.
          </p>
        </div>
        <SignIn
          routing="virtual"
          forceRedirectUrl={returnUrl}
          signUpForceRedirectUrl={returnUrl}
        />
      </div>
    );
  }

  if (status === "error") {
    return (
      <CenteredCard
        title="Couldn't connect the app"
        body={message}
        tone="error"
      />
    );
  }

  return (
    <CenteredCard
      title="You're signed in!"
      body="Connecting the desktop app… you can return to HireShade. This tab will hand you back automatically."
    />
  );
}

function CenteredCard({
  title,
  body,
  tone = "normal",
}: {
  title: string;
  body?: string;
  tone?: "normal" | "error";
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div
          className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
            tone === "error"
              ? "bg-red-50 text-red-500"
              : "bg-indigo-50 text-indigo-500"
          }`}
        >
          <div className="h-6 w-6 rounded-full border-2 border-current border-t-transparent animate-spin" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        {body && <p className="mt-2 text-sm text-slate-500">{body}</p>}
      </div>
    </div>
  );
}

export default DesktopAuthHandoff;
