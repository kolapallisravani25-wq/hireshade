import React, { useRef, useState } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { start, cancel } from "@fabianlars/tauri-plugin-oauth";
import { listen } from "@tauri-apps/api/event";
import { LogIn, Loader2 } from "lucide-react";
import {
  APP_NAME,
  FRONTEND_URL,
  TAURI_AUTH_PORT,
  AUTH_CALLBACK_HTML,
} from "@/features/launcher/constants";
import { emitDesktopAuthStateChanged, persistDesktopSession } from "@/lib/desktopAuthSession";

export function AuthScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn: clerkSignIn, setActive: clerkSetActive } = useSignIn();

  // Use a ref instead of a module-level mutable to prevent port leaks across
  // component remounts and hot-reloads (eliminates the `_activeAuthPort` global).
  const activePortRef = useRef<number | undefined>(undefined);

  const handleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    let port: number | undefined;
    let unlisten: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = async () => {
      clearTimeout(timeoutId);
      unlisten?.();
      if (port !== undefined) {
        await cancel(port).catch(() => undefined);
        activePortRef.current = undefined;
        port = undefined;
      }
    };

    try {
      // Cancel any leftover server from a previous attempt
      if (activePortRef.current !== undefined) {
        await cancel(activePortRef.current).catch(() => undefined);
        activePortRef.current = undefined;
      }

      port = await start({
        ports: [TAURI_AUTH_PORT],
        response: AUTH_CALLBACK_HTML,
      });
      activePortRef.current = port;

      const authPromise = new Promise<string>((resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("Login timed out — please try again")),
          120_000,
        );
        listen<string>("oauth://url", (event) => {
          clearTimeout(timeoutId);
          try {
            const ticket = new URL(event.payload).searchParams.get("ticket");
            if (ticket) resolve(ticket);
            else reject(new Error("Auth callback missing ticket"));
          } catch {
            reject(new Error("Invalid callback URL"));
          }
        }).then((fn) => {
          unlisten = fn;
        });
      });

      await openUrl(`${FRONTEND_URL}/sign-in?from=tauri&port=${port}`);
      const ticket = await authPromise;

      if (!clerkSignIn || !clerkSetActive) throw new Error("Clerk not ready");
      const result = await clerkSignIn.create({ strategy: "ticket", ticket });
      if (result.status === "complete") {
        const createdSessionId = result.createdSessionId;
        if (!createdSessionId) throw new Error("Clerk did not return a session id");
        await clerkSetActive({ session: createdSessionId });
        await persistDesktopSession(createdSessionId);
        await emitDesktopAuthStateChanged({
          source: "launcher",
          sessionId: createdSessionId,
          signedIn: true,
        });
      } else {
        throw new Error("Unexpected sign-in status: " + result.status);
      }
    } catch (err) {
      const e = err as { message?: string };
      setError(e?.message ?? "Login failed");
      setLoading(false);
    } finally {
      await cleanup();
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 px-5 pt-3 pb-5">
      <h2 className="text-lg font-bold text-zinc-900 text-center">
        {APP_NAME}
      </h2>
      <p className="text-sm text-zinc-500 text-center leading-snug">
        Login to your {APP_NAME} account to start your interview.
      </p>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      <button
        onClick={handleLogin}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 mt-1 rounded-2xl bg-zinc-900 text-white text-sm font-semibold hover:bg-zinc-800 transition-colors active:scale-[0.97] disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <LogIn className="w-3.5 h-3.5" />
        )}
        {loading ? "Waiting for browser…" : "Login"}
      </button>
    </div>
  );
}
