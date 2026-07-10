import { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { APP_NAME } from "@/features/launcher/constants";
import { useDesktopAuth } from "@/contexts/DesktopAuthProvider";

/**
 * Desktop login. Delegates to the desktop auth provider, which opens the system
 * browser to the web /desktop-auth handoff (production Clerk works there), gets a
 * refresh token back over the loopback, stores it, and flips the app to signed-in.
 * No Clerk session is created inside the webview — so it persists across launches.
 */
export function AuthScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn } = useDesktopAuth();

  const handleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      const e = err as { message?: string };
      setError(e?.message ?? "Login failed — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 px-5 pt-3 pb-5">
      <h2 className="text-lg font-bold text-zinc-900 text-center">{APP_NAME}</h2>
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
