import { useState } from "react";
import { useSignUp } from "@clerk/clerk-react";
import { Link, useNavigate } from "react-router-dom";
import { GoogleOAuthButton } from "@/components/GoogleOAuthButton";

type Step = "details" | "verify";

const SignUpPage = () => {
  const { isLoaded, signUp, setActive } = useSignUp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("details");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setError("");
    setLoading(true);
    try {
      await signUp!.create({ emailAddress: email, password });
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
      setStep("verify");
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[] };
      setError(e?.errors?.[0]?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;
    setError("");
    setLoading(true);
    try {
      const result = await signUp!.attemptEmailAddressVerification({ code });
      if (result.status === "complete") {
        await setActive!({ session: result.createdSessionId });
        navigate("/");
      } else {
        setError("Verification incomplete. Please try again.");
      }
    } catch (err: unknown) {
      const e = err as { errors?: { message: string }[] };
      setError(e?.errors?.[0]?.message ?? "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!isLoaded) return;
    try {
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch { /* ignore */ }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-2xl shadow-xl border border-slate-100 bg-white">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            {step === "details" ? "Create your account" : "Check your email"}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {step === "details"
              ? "Welcome! Please fill in the details to get started"
              : `We sent a 6-digit code to ${email}`}
          </p>
        </div>

        {/* Google button — only on details step */}
        {step === "details" && (
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

        {/* Forms */}
        <div className="px-8 pb-8">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {step === "details" ? (
            <form onSubmit={handleDetailsSubmit} className="space-y-4">
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
              <div className="space-y-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !isLoaded}
                className="w-full h-10 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating account…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="code" className="block text-sm font-medium text-slate-700">Verification code</label>
                <input
                  id="code"
                  type="text"
                  required
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 tracking-widest text-center"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !isLoaded}
                className="w-full h-10 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Verifying…" : "Verify email"}
              </button>
              <button
                type="button"
                onClick={handleResend}
                className="w-full text-sm text-slate-500 hover:text-slate-700 transition"
              >
                Didn&apos;t receive it? Resend code
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link to="/sign-in" className="font-medium text-blue-600 hover:text-blue-500 transition">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignUpPage;



