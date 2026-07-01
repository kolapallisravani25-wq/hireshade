 ;

import { useDeferredValue, useMemo, useState } from "react";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { useCreditBrackets } from "@/hooks/useCreditBrackets";
import { useCreditsLedger, type LedgerEntry } from "@/hooks/useCreditsLedger";
import { useCreditsPurchases, type CreditPurchase } from "@/hooks/useCreditsPurchases";
import { Clock, ShieldCheck, ArrowDownLeft, ArrowUpRight, CheckCircle2, XCircle, AlertCircle, Coins, Sparkles, WalletCards, Search, TrendingUp, Activity, ReceiptText, Layers3, ChevronLeft, ChevronRight, Filter, X, Mic, FileText, BotMessageSquare, FolderKanban, ScanText, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CreditPlansSection } from "@/components/Billing/CreditPlansSection";

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function reasonLabel(reason: string) {
  const map: Record<string, string> = {
    FULL_BRACKET: "Full session",
    HALF_BRACKET: "Grace zone",
    FREE_ZONE: "Free zone",
    PER_MINUTE_DEDUCTION: "Session usage",
    EXHAUSTED: "Credit limit reached",
    CAP_REACHED: "Session cap",
    PURCHASE: "Purchase",
    BONUS: "Bonus",
    REFUND: "Refund",
  };
  return map[reason] ?? reason;
}

function compactNumber(value: string | number) {
  const parsed = Number(value) || 0;
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

function isoDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function statusTone(status: CreditPurchase["status"]) {
  if (status === "CONFIRMED") return "positive";
  if (status === "FAILED") return "negative";
  return "pending";
}

type HistoryItem =
  | {
      id: string;
      createdAt: string;
      kind: "purchase";
      purchase: CreditPurchase;
    }
  | {
      id: string;
      createdAt: string;
      kind: "ledger";
      entry: LedgerEntry;
    };

function purchaseStatusBadge(status: CreditPurchase["status"]) {
  if (status === "CONFIRMED") {
    return (
      <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-[11px] gap-1">
        <CheckCircle2 className="h-3 w-3" /> Confirmed
      </Badge>
    );
  }

  if (status === "FAILED") {
    return (
      <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 text-[11px] gap-1">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-[11px] gap-1">
      <AlertCircle className="h-3 w-3" /> Pending
    </Badge>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 10;

export default function BillingPage() {
  const { balance, isLoading: balanceLoading, refresh: refreshBalance } = useCreditsBalance();
  const { brackets, isLoading: bracketsLoading } = useCreditBrackets();
  const {
    entries,
    isLoading: ledgerLoading,
    refresh: refreshLedger,
  } = useCreditsLedger(200);
  const { purchases, isLoading: purchasesLoading, refresh: refreshPurchases } = useCreditsPurchases();
  const [historyFilter, setHistoryFilter] = useState<"all" | "purchases" | "usage" | "credits">("all");
  const [historyQuery, setHistoryQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>("");
  const deferredHistoryQuery = useDeferredValue(historyQuery);

  const purchasedCredits = Number(balance?.purchasedCredits ?? 0);
  const bonusCredits = Number(balance?.earnedCredits ?? 0);
  const heldCredits = Number(balance?.heldCredits ?? 0);
  const availableCredits = Number(balance?.totalAvailable ?? 0);
  const totalCreditPool = purchasedCredits + bonusCredits;
  const visiblePool = Math.max(totalCreditPool, availableCredits + heldCredits, 1);
  const availabilityRatio = Math.min(100, Math.round((availableCredits / visiblePool) * 100));
  const heldRatio = Math.min(100, Math.round((heldCredits / visiblePool) * 100));
  const bonusRatio = Math.min(100, Math.round((bonusCredits / visiblePool) * 100));

  const historyItems = useMemo<HistoryItem[]>(() => {
    const combined: HistoryItem[] = [
      ...entries.map((entry) => ({
        id: `ledger-${entry.id}`,
        createdAt: entry.createdAt,
        kind: "ledger" as const,
        entry,
      })),
      ...purchases.map((purchase) => ({
        id: `purchase-${purchase.id}`,
        createdAt: purchase.createdAt,
        kind: "purchase" as const,
        purchase,
      })),
    ];

    return combined.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }, [entries, purchases]);

  const filteredHistory = useMemo(() => {
    const query = deferredHistoryQuery.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTime = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
    const minAmountNum = minAmount ? parseFloat(minAmount) : 0;
    const maxAmountNum = maxAmount ? parseFloat(maxAmount) : Infinity;

    return historyItems.filter((item) => {
      const itemTime = new Date(item.createdAt).getTime();
      if (itemTime < fromTime || itemTime > toTime) return false;

      if (historyFilter === "purchases" && item.kind !== "purchase") return false;
      if (historyFilter === "usage" && !(item.kind === "ledger" && item.entry.type === "DEBIT")) return false;
      if (historyFilter === "credits" && !(item.kind === "ledger" && item.entry.type === "CREDIT")) return false;

      let amount = 0;
      if (item.kind === "purchase") {
        amount = parseFloat(item.purchase.creditsAdded);
      } else {
        amount = parseFloat(item.entry.amount);
      }

      if (amount < minAmountNum || amount > maxAmountNum) return false;

      if (!query) return true;

      if (item.kind === "purchase") {
        const haystack = [
          "purchase",
          item.purchase.status,
          item.purchase.amountPaid,
          item.purchase.currency,
          item.purchase.creditsAdded,
          fmtDate(item.purchase.createdAt),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      }

      const haystack = [
        reasonLabel(item.entry.reason),
        item.entry.type,
        item.entry.amount,
        item.entry.sessionId ?? "",
        fmtDate(item.entry.createdAt),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [deferredHistoryQuery, historyFilter, historyItems, dateFrom, dateTo, minAmount, maxAmount]);

  const paginatedHistory = useMemo(() => {
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    return filteredHistory.slice(startIdx, endIdx);
  }, [filteredHistory, currentPage]);

  const totalPages = Math.ceil(filteredHistory.length / ITEMS_PER_PAGE);

  const hasActiveFilters = dateFrom || dateTo || minAmount || maxAmount;

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
    setCurrentPage(1);
  };

  const groupedHistory = useMemo(() => {
    return paginatedHistory.reduce<Array<{ label: string; items: HistoryItem[] }>>((groups, item) => {
      const label = isoDayLabel(item.createdAt);
      const lastGroup = groups[groups.length - 1];

      if (!lastGroup || lastGroup.label !== label) {
        groups.push({ label, items: [item] });
        return groups;
      }

      lastGroup.items.push(item);
      return groups;
    }, []);
  }, [paginatedHistory]);

  const recommendedBracketId = useMemo(() => {
    if (!brackets.length) return null;
    return [...brackets].sort((left, right) => right.bracketMinutes - left.bracketMinutes)[0]?.id ?? null;
  }, [brackets]);

  const handlePurchaseSuccess = () => {
    refreshBalance();
    refreshLedger();
    refreshPurchases();
  };

  return (
    <div className="min-h-full bg-white px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)] sm:px-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                <Layers3 className="h-3.5 w-3.5 text-brand" /> Billing & subscriptions
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Credits, usage, and billing activity</h1>
                <p className="max-w-xl text-sm leading-6 text-slate-600">
                  Monitor credit availability, understand session pricing, and manage top-ups from one structured enterprise billing workspace.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Available", value: compactNumber(availableCredits), tone: "text-slate-950" },
                { label: "Purchased", value: compactNumber(purchasedCredits), tone: "text-slate-800" },
                { label: "Bonus", value: compactNumber(bonusCredits), tone: "text-brand" },
                { label: "On hold", value: compactNumber(heldCredits), tone: "text-amber-700" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{stat.label}</p>
                  <p className={`mt-2 text-xl font-semibold tabular-nums ${stat.tone}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Feature Pricing Guide ─────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 flex items-center gap-2">
                <Coins className="h-4 w-4 text-brand" />
                Credit costs by feature
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Every AI feature that consumes credits — with its rate — at a glance.
              </p>
            </div>
            <Badge variant="outline" className="text-[11px] border-slate-200 bg-slate-50 text-slate-600">
              Per use
            </Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              {
                icon: Mic,
                iconBg: "bg-blue-100",
                iconColor: "text-blue-600",
                label: "Live Session",
                rate: brackets.length > 0
                  ? `${parseFloat(brackets[0]?.creditsPerMinute ?? "0.5").toFixed(1)} cr / min`
                  : "~0.5 cr / min",
                note: "Real-time AI interview assistance",
                highlight: true,
              },
              {
                icon: BotMessageSquare,
                iconBg: "bg-brand/10",
                iconColor: "text-brand",
                label: "AI Answer",
                rate: "~0.5 cr",
                note: "Per AI response inside a session",
                highlight: false,
              },
              {
                icon: ScanText,
                iconBg: "bg-emerald-100",
                iconColor: "text-emerald-600",
                label: "ATS Analysis",
                rate: "~3 cr",
                note: "Resume vs. job description scan",
                highlight: false,
              },
              {
                icon: FileText,
                iconBg: "bg-teal-100",
                iconColor: "text-teal-600",
                label: "Cover Letter",
                rate: "~5 cr",
                note: "AI-generated from your resume",
                highlight: false,
              },
              {
                icon: FolderKanban,
                iconBg: "bg-violet-100",
                iconColor: "text-violet-600",
                label: "AI Project",
                rate: "~5 cr",
                note: "Full structured project report",
                highlight: false,
              },
              {
                icon: Sparkles,
                iconBg: "bg-purple-100",
                iconColor: "text-purple-600",
                label: "AI Assistant",
                rate: "~1 cr / msg",
                note: "Conversational AI queries",
                highlight: false,
              },
            ].map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.label}
                  className={`relative flex flex-col gap-3 rounded-xl border p-4 transition-all ${
                    feat.highlight
                      ? "border-blue-200 bg-gradient-to-b from-blue-50 to-white"
                      : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  {feat.highlight && (
                    <span className="absolute -top-2 left-3 rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                      Most used
                    </span>
                  )}
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${feat.iconBg}`}>
                    <Icon className={`h-4 w-4 ${feat.iconColor}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{feat.label}</p>
                    <p className="text-xs text-slate-500 leading-snug mt-0.5">{feat.note}</p>
                  </div>
                  <div className="mt-auto">
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-xs font-bold text-amber-700">
                      <Coins className="h-3 w-3" />
                      {feat.rate}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] text-slate-400">
            * Rates shown are approximate. Session costs are metered per minute and vary by bracket. Other feature costs may vary based on content length.
          </p>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)]">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Credit overview</h2>
                  <p className="text-sm text-slate-600">A compact usage view for available, reserved, and bonus credit capacity.</p>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Balance health</p>
                <div className="mt-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-brand" />
                  <span className="text-sm font-medium text-slate-900">{availabilityRatio}% liquid credits available</span>
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex h-3 w-full overflow-hidden bg-slate-100">
                  <div className="bg-slate-900 transition-all duration-200" style={{ width: `${availabilityRatio}%` }} />
                  <div className="bg-amber-400/90 transition-all duration-200" style={{ width: `${heldRatio}%` }} />
                  <div className="bg-brand/70 transition-all duration-200" style={{ width: `${bonusRatio}%` }} />
                </div>
                <div className="grid gap-3 border-t border-slate-200 px-4 py-4 sm:grid-cols-3">
                  {[
                    { label: "Available now", value: compactNumber(availableCredits), dot: "bg-slate-900" },
                    { label: "Reserved in sessions", value: compactNumber(heldCredits), dot: "bg-amber-400" },
                    { label: "Bonus allocation", value: compactNumber(bonusCredits), dot: "bg-brand" },
                  ].map((item) => (
                    <div key={item.label} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                        {item.label}
                      </div>
                      <div className="text-lg font-semibold tabular-nums text-slate-950">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  {
                    title: "Credit pool",
                    value: compactNumber(visiblePool),
                    note: totalCreditPool > 0 ? `${Math.round((bonusCredits / Math.max(totalCreditPool, 1)) * 100)}% bonus mix` : "No bonus credits yet",
                  },
                  {
                    title: "Recent activity",
                    value: compactNumber(entries.length + purchases.length),
                    note: "Events tracked across usage and purchases",
                  },
                  {
                    title: "Active reservations",
                    value: compactNumber(heldCredits),
                    note: heldCredits > 0 ? "Currently reserved for running sessions" : "No credits on hold right now",
                  },
                ].map((card) => (
                  <div key={card.title} className="rounded-lg border border-slate-200 bg-white px-4 py-4 transition-colors duration-200 hover:border-slate-300">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{card.title}</p>
                    <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{card.value}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{card.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Session pricing</h2>
                <p className="mt-1 text-sm text-slate-600">Designed for fast scanning during plan comparison and internal credit reviews.</p>
              </div>
              <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                Duration based
              </Badge>
            </div>

            {bracketsLoading ? (
              <div className="mt-6 space-y-3">
                {[0, 1].map((item) => (
                  <div key={item} className="h-28 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {brackets.map((bracket) => {
                  const recommended = bracket.id === recommendedBracketId;
                  return (
                    <div
                      key={bracket.id}
                      className={`rounded-lg border px-4 py-4 transition-all duration-200 ${recommended ? "border-brand/40 bg-brand/[0.03]" : "border-slate-200 bg-slate-50/60 hover:border-slate-300"}`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-md ${recommended ? "bg-brand/10 text-brand" : "bg-white text-slate-500 border border-slate-200"}`}>
                              <Clock className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-slate-950">{bracket.bracketMinutes} minute session</p>
                                {recommended && (
                                  <Badge className="rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/10">
                                    Recommended
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">Full-charge bracket with reduced grace-window pricing.</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                              <ShieldCheck className="h-3.5 w-3.5 text-brand" /> Grace: {compactNumber(bracket.creditsHalf)} credit / last {bracket.graceZoneMinutes} min
                            </span>
                          </div>
                        </div>

                        <div className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-4 py-3 text-right">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Full session cost</p>
                          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{compactNumber(bracket.creditsFull)}</p>
                          <p className="text-xs text-slate-500">credit{Number(bracket.creditsFull) === 1 ? "" : "s"}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.03)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Transaction history</h2>
              <p className="mt-1 text-sm text-slate-600">Complete activity stream for purchases, usage deductions, and bonus credits with advanced filtering and full details.</p>
            </div>

            <div className="flex flex-col gap-2 lg:items-end">
              <div className="relative w-full min-w-[280px] lg:w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="Search amounts, reasons, status..."
                  className="h-10 rounded-lg border-slate-200 bg-white pl-9 text-sm shadow-none placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-brand"
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={`gap-2 ${showFilters || hasActiveFilters ? "border-brand bg-brand/[0.08] text-brand hover:bg-brand/[0.12]" : ""}`}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {hasActiveFilters && <Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full p-0 text-[10px]">{(dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (minAmount ? 1 : 0) + (maxAmount ? 1 : 0)}</Badge>}
              </Button>
            </div>
          </div>

          {showFilters && (
            <div className="mt-6 grid gap-4 rounded-lg border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">From Date</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border-slate-200 bg-white text-sm focus-visible:ring-1 focus-visible:ring-brand"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">To Date</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border-slate-200 bg-white text-sm focus-visible:ring-1 focus-visible:ring-brand"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Min Credits</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={minAmount}
                  onChange={(e) => {
                    setMinAmount(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border-slate-200 bg-white text-sm focus-visible:ring-1 focus-visible:ring-brand"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Max Credits</label>
                <Input
                  type="number"
                  placeholder="∞"
                  value={maxAmount}
                  onChange={(e) => {
                    setMaxAmount(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border-slate-200 bg-white text-sm focus-visible:ring-1 focus-visible:ring-brand"
                />
              </div>

              {hasActiveFilters && (
                <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="gap-1 text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear filters
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 inline-flex rounded-lg border border-slate-200 bg-white p-1">
            {[
              { id: "all", label: "All" },
              { id: "purchases", label: "Purchases" },
              { id: "usage", label: "Usage" },
              { id: "credits", label: "Credits" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setHistoryFilter(tab.id as typeof historyFilter);
                  setCurrentPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200 ${historyFilter === tab.id ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1.5fr_auto_auto_auto] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 sticky top-0 z-10">
              <span>Entry</span>
              <span className="text-right">Credits</span>
              <span className="text-right">Date & Time</span>
              <span className="text-center">Status</span>
            </div>

            <div className="h-[640px] overflow-y-auto bg-white">
              {ledgerLoading || purchasesLoading ? (
                <div className="divide-y divide-slate-200">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-4 px-5 py-4">
                      <div className="h-10 w-10 rounded-lg bg-slate-100 animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-40 rounded bg-slate-100 animate-pulse" />
                        <div className="h-3 w-28 rounded bg-slate-100 animate-pulse" />
                      </div>
                      <div className="h-3 w-16 rounded bg-slate-100 animate-pulse" />
                    </div>
                  ))}
                </div>
              ) : groupedHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                  <ReceiptText className="h-10 w-10 text-slate-300" />
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">No matching transactions</h3>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">Try adjusting your filters or search term to find transactions.</p>
                </div>
              ) : (
                groupedHistory.map((group) => (
                  <div key={group.label}>
                    <div className="sticky top-0 z-[1] border-y border-slate-200 bg-white/95 px-5 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 backdrop-blur-sm">
                      {group.label}
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.items.map((item) => {
                        if (item.kind === "purchase") {
                          const purchase = item.purchase;
                          const tone = statusTone(purchase.status);
                          return (
                            <div key={item.id} className="grid grid-cols-[1.5fr_auto_auto_auto] gap-4 px-5 py-4 transition-colors duration-200 hover:bg-slate-50/50">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-brand/[0.06] text-brand">
                                  <Coins className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium text-slate-950">Credit purchase</p>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {purchase.amountPaid} {purchase.currency} processed through checkout
                                  </p>
                                </div>
                              </div>
                              <div className={`text-right text-sm font-semibold tabular-nums ${tone === "positive" ? "text-emerald-700" : tone === "negative" ? "text-red-700" : "text-amber-700"}`}>
                                +{compactNumber(purchase.creditsAdded)}
                              </div>
                              <div className="text-right text-xs text-slate-500">{fmtDateTime(purchase.createdAt)}</div>
                              <div className="text-center">{purchaseStatusBadge(purchase.status)}</div>
                            </div>
                          );
                        }

                        const entry = item.entry;
                        const positive = entry.type === "CREDIT";

                        return (
                          <div key={item.id} className="grid grid-cols-[1.5fr_auto_auto_auto] gap-4 px-5 py-4 transition-colors duration-200 hover:bg-slate-50/50">
                            <div className="flex min-w-0 items-start gap-3">
                              <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg border ${positive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                                {positive ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-slate-950">{reasonLabel(entry.reason)}</p>
                                </div>
                                <p className="mt-1 text-xs text-slate-500">
                                  {entry.sessionId ? "Session-linked activity" : "Account-level credit movement"}
                                </p>
                              </div>
                            </div>
                            <div className={`text-right text-sm font-semibold tabular-nums ${positive ? "text-emerald-700" : "text-red-700"}`}>
                              {positive ? "+" : "−"}{compactNumber(entry.amount)}
                            </div>
                            <div className="text-right text-xs text-slate-500">{fmtDateTime(entry.createdAt)}</div>
                            <div className="text-center">
                              <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                {positive ? "Credit" : "Usage"}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {filteredHistory.length > 0 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-5 py-4">
                <div className="text-sm text-slate-600">
                  Showing <span className="font-semibold text-slate-900">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to <span className="font-semibold text-slate-900">{Math.min(currentPage * ITEMS_PER_PAGE, filteredHistory.length)}</span> of <span className="font-semibold text-slate-900">{filteredHistory.length}</span> transactions
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                      const pageNum = currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
                      if (pageNum > totalPages) return null;
                      return (
                        <Button
                          key={pageNum}
                          variant={currentPage === pageNum ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(pageNum)}
                          className="h-8 w-8 p-0"
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="gap-1"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Credit plans for purchase ──────────────────────── */}
        <CreditPlansSection onSuccess={handlePurchaseSuccess} />
      </div>
    </div>
  );
}
