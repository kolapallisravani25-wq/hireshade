 ;

import { useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import { Coins, Zap, TrendingUp, CheckCircle2, Sparkles, ShieldCheck, TimerOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useCreditPlans,
  type CreditPlan,
} from "@/hooks/useCreditPlans";
import { useUserCurrency } from "@/hooks/useUserCurrency";
import { useCreditBrackets } from "@/hooks/useCreditBrackets";
import {
  CURRENCY_SYMBOLS,
  CURRENCY_FLAGS,
} from "@/lib/userCurrency";

// ─── Razorpay types ───────────────────────────────────────────────────────────
declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open(): void };
  }
}
interface RazorpayOptions {
  key: string; amount: number; currency: string; name: string;
  description: string; order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "payment_failed"?: (response: { error: { code: string; description: string; reason: string; source: string; step: string; metadata: { order_id: string; payment_id: string } } }) => void;
}
interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

// Use database-driven isPopular and valuePct instead of hardcoded codes
function valueScore(plan: CreditPlan): number {
  return plan.valuePct;
}

// ─────────────────────────────────────────────────────────────────────────────

interface CreditPlansSectionProps {
  onSuccess?: () => void;
}

export function CreditPlansSection({ onSuccess }: CreditPlansSectionProps) {
  const { getToken } = useAuth();
  // Resolved once synchronously — no flicker, no switcher shown to user.
  const { currency }               = useUserCurrency();
  const [selectedPlan, setSelectedPlan] = useState<CreditPlan | null>(null);
  const [paying, setPaying]             = useState(false);

  const { plans, isLoading } = useCreditPlans(currency);
  const { brackets } = useCreditBrackets();
  
  // Calculate best value dynamically from database valuePct
  const maxScore = plans.reduce((m, p) => Math.max(m, p.valuePct), 0);
  const bestValuePlan = plans.find(p => p.valuePct === maxScore);
  const sym      = CURRENCY_SYMBOLS[currency];

  const rateLabel = brackets[0]
    ? `${parseFloat(brackets[0].creditsPerMinute) * 60} cr / hour`
    : "0.5 cr / min";

  const handlePay = useCallback(async (plan: CreditPlan) => {
    setPaying(true);
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast.error("Failed to load payment SDK. Check your connection.");
        return;
      }

      const token = await getToken();
      const orderRes = await fetch(
        `${import.meta.env.VITE_BACKEND_URL}/api/credits/purchase/order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ packCode: plan.code, currency: plan.currency }),
        },
      );

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        const msg = err.error ?? "";
        if (msg === "Razorpay is not configured") {
          toast.error("Payment gateway is not available right now.", { description: "Please contact support or try again later." });
        } else if (msg === "Invalid packCode") {
          toast.error("Invalid pack selected. Please refresh and try again.");
        } else {
          toast.error(msg || "Could not create payment order. Please try again.");
        }
        return;
      }

      const { data: order } = await orderRes.json();

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: order.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID,
          amount: order.amountMinor,
          currency: order.currency,
          name: "HireShade",
          description: `${plan.name} — ${plan.credits} credits`,
          order_id: order.orderId,
          theme: { color: "#458fff" },
          modal: {
            ondismiss: () => {
              getToken().then((failToken) => {
                fetch(`${import.meta.env.VITE_BACKEND_URL}/api/credits/purchase/fail`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${failToken}`,
                  },
                  body: JSON.stringify({
                    razorpay_order_id: order.orderId,
                    failure_reason: "cancelled_by_user",
                  }),
                }).catch(() => { /* best-effort */ });
              }).catch(() => { /* best-effort */ });
              reject(new Error("DISMISSED"));
            },
          },
          "payment_failed": async (response) => {
            try {
              const failToken = await getToken();
              await fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/credits/purchase/fail`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${failToken}` },
                  body: JSON.stringify({
                    razorpay_order_id: order.orderId,
                    failure_reason: response?.error?.description ?? response?.error?.reason,
                  }),
                },
              );
            } catch {
              // best-effort
            }
            toast.error("Payment failed", {
              description: response?.error?.description ?? "Please try a different payment method.",
            });
            reject(new Error("PAYMENT_FAILED"));
          },
          handler: async (response: RazorpayResponse) => {
            try {
              const verifyToken = await getToken();
              const verifyRes = await fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/credits/purchase/verify`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${verifyToken}` },
                  body: JSON.stringify({
                    razorpay_order_id:  response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature:  response.razorpay_signature,
                  }),
                },
              );
              if (!verifyRes.ok) {
                const err = await verifyRes.json().catch(() => ({}));
                toast.error(err.error ?? "Payment verification failed.");
                reject(new Error("VERIFY_FAILED"));
                return;
              }
              const { data: result } = await verifyRes.json();
              toast.success(`${result.creditsAdded} credits added to your account!`, {
                description: result.packName,
                duration: 5000,
              });
              setSelectedPlan(null);
              onSuccess?.();
              resolve();
            } catch (e) { reject(e); }
          },
        });
        rzp.open();
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "DISMISSED") {
        // silent — user closed Razorpay modal
      } else if (err instanceof Error && err.message === "PAYMENT_FAILED") {
        // already toasted in payment_failed callback
      } else if (err instanceof Error && err.message !== "VERIFY_FAILED") {
        toast.error("Payment failed. Please try again.");
      }
    } finally {
      setPaying(false);
    }
  }, [getToken, onSuccess]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)] space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Coins className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-slate-950">Buy credits</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-slate-600">
            One-time credit packs for teams and individual users. Structured pricing, persistent balances, and quick checkout.
          </p>
        </div>

        {/* Trust pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { icon: <TimerOff className="h-3 w-3" />, label: "Never expire" },
            { icon: <ShieldCheck className="h-3 w-3" />, label: "Instant delivery" },
            { icon: <Sparkles className="h-3 w-3" />, label: rateLabel },
          ].map((t) => (
            <span
              key={t.label}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500"
            >
              <span className="text-brand">{t.icon}</span>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Currency badge (read-only, derived from location) ── */}
      <div className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 select-none">
        <span className="text-sm">{CURRENCY_FLAGS[currency]}</span>
        <span>{currency}</span>
      </div>

      {/* ── Plan grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 py-20 text-center text-slate-500">
          <Coins className="mb-4 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No plans available right now.</p>
          <p className="mt-1 text-xs">Please try a different currency or check back later.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const isSelected  = selectedPlan?.code === plan.code;
            const isPopular   = plan.isPopular;
            const isBestValue = bestValuePlan?.code === plan.code;
            const score        = plan.valuePct;
            const valuePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

            return (
              <div
                key={plan.code}
                onClick={() => setSelectedPlan(isSelected ? null : plan)}
                className={`relative flex cursor-pointer flex-col gap-4 rounded-lg border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] ${
                  isSelected
                    ? "border-brand/50 bg-brand/[0.03] shadow-[0_10px_24px_rgba(69,143,255,0.08)]"
                    : isPopular
                    ? "border-slate-300 bg-slate-50/60"
                    : "border-slate-200 bg-white"
                }`}
              >
                {/* Badge */}
                {(isPopular || isBestValue) && (
                  <span className={`absolute left-4 top-0 -translate-y-1/2 rounded-md px-2 py-1 text-[10px] font-medium ${
                    isBestValue ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-brand/20 bg-brand/[0.08] text-brand"
                  }`}>
                    {isBestValue ? "Best Value" : "Popular"}
                  </span>
                )}

                {/* Selected check */}
                {isSelected && (
                  <CheckCircle2 className="absolute top-3 right-3 h-4 w-4 text-brand" />
                )}

                {/* Credits pill */}
                <div className="flex items-center gap-1.5 pt-2">
                  <Zap className={`h-3.5 w-3.5 ${isSelected ? "text-brand" : "text-slate-400"}`} />
                  <span className={`text-[11px] font-medium tabular-nums ${isSelected ? "text-brand" : "text-slate-500"}`}>
                    {plan.credits} credits
                  </span>
                </div>

                {/* Name + price */}
                <div>
                  <p className="text-sm font-medium leading-tight text-slate-700">{plan.name}</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <p className={`text-3xl font-semibold tabular-nums tracking-tight ${isSelected ? "text-brand" : "text-slate-950"}`}>
                    {sym}{plan.amountMajor}
                    </p>
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Value</p>
                      <p className="text-sm font-medium text-slate-700">{valuePercent}%</p>
                    </div>
                  </div>
                </div>

                {/* Feature blurb */}
                {plan.feature && (
                  <p className="min-h-10 text-[12px] leading-5 text-slate-500 line-clamp-2">{plan.feature}</p>
                )}

                {/* Value bar */}
                <div className="mt-auto space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><TrendingUp className="h-3 w-3" /> efficiency</span>
                    <span>{valuePercent}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${isSelected ? "bg-brand" : isBestValue ? "bg-emerald-500/70" : "bg-slate-300"}`}
                      style={{ width: `${valuePercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Buy CTA ── */}
      {selectedPlan ? (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-slate-50 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Selected pack</p>
            <p className="text-lg font-semibold text-slate-950">
              {selectedPlan.credits} credits — {sym}{selectedPlan.amountMajor}
            </p>
            <p className="text-xs text-slate-500">{selectedPlan.name}</p>
          </div>
          <Button
            onClick={() => handlePay(selectedPlan)}
            disabled={paying}
            className="h-11 shrink-0 rounded-lg bg-brand px-6 font-medium text-white transition-all duration-200 hover:bg-brand/90 disabled:opacity-60"
          >
            {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Coins className="h-5 w-5" />}
            {paying ? "Processing…" : `Buy Now — ${sym}${selectedPlan.amountMajor}`}
          </Button>
        </div>
      ) : (
        !isLoading && plans.length > 0 && (
          <p className="py-2 text-center text-sm text-slate-500">
            ↑ Select a pack above to purchase
          </p>
        )
      )}
    </section>
  );
}


