import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { AiActivitySection } from "@/components/Billing/AiActivitySection";
import { ReceiptText, Coins } from "lucide-react";

function compactNumber(value: string | number) {
  const parsed = Number(value) || 0;
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

export default function AccountUsagePage() {
  const { balance } = useCreditsBalance();
  const availableCredits = Number(balance?.totalAvailable ?? 0);

  return (
    <div className="min-h-full bg-white px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)] sm:px-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                <ReceiptText className="h-3.5 w-3.5 text-indigo-600" /> Billing
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">AI usage &amp; credit reports</h1>
              <p className="max-w-xl text-sm leading-6 text-slate-600">
                A per-feature breakdown of every credit charged for AI usage across the app.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500 flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5" /> Available credits
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-slate-950">{compactNumber(availableCredits)}</p>
            </div>
          </div>
        </section>

        <AiActivitySection />
      </div>
    </div>
  );
}
