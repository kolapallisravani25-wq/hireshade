import { useState, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Coins, Zap, Loader2, CheckCircle2, TrendingUp } from "lucide-react";
import {
  useCreditPlans,
  type SupportedCurrency,
  type CreditPlan,
} from "@/hooks/useCreditPlans";
import {
  detectUserCurrency,
  CURRENCY_SYMBOLS,
  CURRENCY_FLAGS,
} from "@/lib/userCurrency";

// ── Razorpay types ────────────────────────────────────────────────────────────
declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open(): void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
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
// ─────────────────────────────────────────────────────────────────────────────

function loadRazorpayScript(): Promise<boolean> {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const POPULAR_CODE = "standard_60";
const BEST_VALUE_CODE = "mega_600";

// Computes credits per unit of major currency (higher = better value)
function valueScore(plan: CreditPlan): number {
  const price = parseFloat(plan.amountMajor);
  return price > 0 ? parseFloat(plan.credits) / price : 0;
}

interface BuyCreditsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialPlan?: CreditPlan;
  initialCurrency?: SupportedCurrency;
}

export function BuyCreditsDialog({
  open,
  onOpenChange,
  onSuccess,
  initialPlan,
  initialCurrency,
}: BuyCreditsDialogProps) {
  const { getToken } = useAuth();
  // Auto-detect from OS timezone / browser locale (IN → INR, GB → GBP, else → USD).
  // Explicit user overrides (if any) are stored with an ".explicit" marker so
  // stale defaults from older code are ignored.
  const [currency] = useState<SupportedCurrency>(
    initialCurrency ?? detectUserCurrency(),
  );
  const [selectedPlan, setSelectedPlan] = useState<CreditPlan | null>(initialPlan ?? null);
  const [paying, setPaying] = useState(false);

  const { plans, isLoading } = useCreditPlans(currency);

  // Derived: best value score to show relative bar
  const maxScore = plans.reduce((m, p) => Math.max(m, valueScore(p)), 0);

  const handlePay = useCallback(async () => {
    if (!selectedPlan) return;
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            packCode: selectedPlan.code,
            currency: selectedPlan.currency,
          }),
        },
      );

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({}));
        const msg = err.error ?? "";
        if (msg === "Razorpay is not configured") {
          toast.error("Payment gateway is not available right now.", {
            description: "Please contact support or try again later.",
          });
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
          description: `${selectedPlan.name} — ${selectedPlan.credits} credits`,
          order_id: order.orderId,
          theme: { color: "#458fff" },
          modal: {
            ondismiss: () => {
              // Mark PENDING order as FAILED when user closes the modal without paying
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
            // Notify backend so the PENDING record is marked FAILED
            try {
              const failToken = await getToken();
              await fetch(
                `${import.meta.env.VITE_BACKEND_URL}/api/credits/purchase/fail`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${failToken}`,
                  },
                  body: JSON.stringify({
                    razorpay_order_id: order.orderId,
                    failure_reason: response?.error?.description ?? response?.error?.reason,
                  }),
                },
              );
            } catch {
              // best-effort — don't block the UI
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
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${verifyToken}`,
                  },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
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
              toast.success(
                `${result.creditsAdded} credits added to your account!`,
                { description: result.packName, duration: 5000 },
              );
              onSuccess?.();
              onOpenChange(false);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        });
        onOpenChange(false); // Close plans dialog before opening Razorpay
        rzp.open();
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "DISMISSED") {
        // silent — user closed modal
      } else if (err instanceof Error && err.message === "PAYMENT_FAILED") {
        // already toasted in payment_failed callback
      } else if (err instanceof Error && err.message !== "VERIFY_FAILED") {
        toast.error("Payment failed. Please try again.");
      }
    } finally {
      setPaying(false);
    }
  }, [selectedPlan, getToken, onSuccess, onOpenChange]);

  const sym = CURRENCY_SYMBOLS[currency];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[480px] lg:max-w-[720px] p-0 overflow-hidden gap-0 border-none shadow-2xl rounded-3xl bg-background/95 backdrop-blur-xl">


        {/* ── Header ─────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-border/40 bg-gradient-to-br from-brand/5 via-transparent to-transparent">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="flex items-center gap-3 text-xl font-bold tracking-tight">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand/10 text-brand shadow-sm">
                <Coins className="h-5 w-5" />
              </span>
              Buy Credits
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground font-medium leading-relaxed">
              One-time purchase · credits never expire · instant delivery
            </DialogDescription>
          </DialogHeader>


          {/* Currency indicator — auto-detected, no manual switcher */}
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 border border-border/40 text-xs font-semibold text-muted-foreground select-none">
            <span className="text-sm">{CURRENCY_FLAGS[currency]}</span>
            <span>{currency}</span>
          </div>

        </div>

        {/* ── Plan grid ──────────────────────────────────────── */}
        <div className="px-6 py-4 overflow-y-auto max-h-[360px]">
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {plans.map((plan) => {
                const isSelected = selectedPlan?.code === plan.code;
                const isPopular = plan.code === POPULAR_CODE;
                const isBestValue = plan.code === BEST_VALUE_CODE;
                const score = valueScore(plan);
                const valuePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

                return (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setSelectedPlan(plan)}
                    className={`relative rounded-2xl border p-4 text-left transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      isSelected
                        ? "border-brand bg-brand/[0.03] ring-1 ring-brand/20 shadow-lg shadow-brand/10"
                        : "border-border/60 bg-card hover:border-brand/40 hover:bg-brand/[0.01] hover:shadow-md"
                    }`}
                  >

                    {/* Badge */}
                    {(isPopular || isBestValue) && (
                      <span className={`absolute -top-2.5 left-3 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isBestValue
                          ? "bg-emerald-500 text-white"
                          : "bg-brand text-white"
                      }`}>
                        {isBestValue ? "Best Value" : "Popular"}
                      </span>
                    )}

                    {/* Selected check */}
                    {isSelected && (
                      <CheckCircle2 className="absolute top-2.5 right-2.5 h-4 w-4 text-brand" />
                    )}

                    {/* Credits pill */}
                    <div className="flex items-center gap-1 mb-2">
                      <Zap className={`h-3 w-3 ${isSelected ? "text-brand" : "text-muted-foreground"}`} />
                      <span className={`text-[11px] font-bold tabular-nums ${isSelected ? "text-brand" : "text-muted-foreground"}`}>
                        {plan.credits} credits
                      </span>
                    </div>

                    <p className="text-sm font-bold text-foreground leading-tight">{plan.name}</p>
                    <p className={`text-2xl font-black tabular-nums mt-1 tracking-tight ${isSelected ? "text-brand" : "text-foreground"}`}>
                      {sym}{plan.amountMajor}
                    </p>


                    {/* Value bar */}
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <TrendingUp className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isSelected ? "bg-brand" : "bg-muted-foreground/30"}`}
                          style={{ width: `${valuePercent}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-border/40 bg-muted/20">
          {selectedPlan ? (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">You're buying</p>
                <p className="text-[15px] font-extrabold text-foreground truncate">
                  {selectedPlan.credits} credits · {selectedPlan.name}
                </p>
              </div>

              <Button
                onClick={handlePay}
                disabled={paying}
                className="shrink-0 gap-2.5 bg-brand hover:bg-brand/90 text-white font-bold h-12 px-6 rounded-2xl shadow-lg shadow-brand/20 active:scale-95 transition-all"
              >
                {paying ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Coins className="h-5 w-5" />
                )}
                {paying ? "Processing…" : `Pay ${sym}${selectedPlan.amountMajor}`}
              </Button>

            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                ← Select a pack to continue
              </p>
              <Button
                disabled
                className="shrink-0 gap-2 h-10 px-5 rounded-xl opacity-40"
              >
                <Coins className="h-4 w-4" />
                Pay & Add Credits
              </Button>
            </div>
          )}
        </div>

      </DialogContent>
    </Dialog>
  );
}

