import { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  subtitle: string;
  /** Slot for social auth buttons (GoogleOAuthButton) */
  social: ReactNode;
  /** Slot for the Clerk form (SignIn / SignUp) */
  form: ReactNode;
}

/**
 * AuthCard — reusable auth container primitive.
 * Owns: layout, spacing, header, social slot, divider.
 * Clerk owns: form logic, validation, footer.
 */
export function AuthCard({ title, subtitle, social, form }: AuthCardProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      <div className="w-full max-w-md rounded-2xl shadow-xl border border-slate-100 bg-white">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
        </div>

        {/* Social auth slot */}
        <div className="px-8">{social}</div>

        {/* Divider */}
        <div className="flex items-center gap-3 px-8 py-4">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs font-medium text-slate-400 select-none">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        {/* Form slot — Clerk renders here as a transparent form engine */}
        <div className="pb-0">{form}</div>
      </div>
    </div>
  );
}
