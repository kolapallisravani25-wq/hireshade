import { useEffect, useState } from 'react';
import { Page, useCallProcedure } from '@kottster/react';
import {
  ArrowRight,
  BadgeIndianRupee,
  Coins,
  CreditCard,
  FileText,
  Gauge,
  Receipt,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
} from 'lucide-react';
import type { Procedures } from './api.server';

const pricingRows = [
  { pack: 'Free Tier (signup)', credits: '3', price: 'FREE', popular: false },
  { pack: 'Quick 5', credits: '5', price: 'INR 99', popular: false },
  { pack: 'Starter', credits: '10', price: 'INR 149', popular: false },
  { pack: 'Basic', credits: '25', price: 'INR 349', popular: false },
  { pack: 'Standard', credits: '60', price: 'INR 699', popular: true },
  { pack: 'Professional', credits: '120', price: 'INR 1,299', popular: false },
  { pack: 'Power', credits: '300', price: 'INR 2,999', popular: false },
  { pack: 'Mega', credits: '600', price: 'INR 4,999', popular: true },
];

const featureCosts = [
  { group: 'Interview Copilot', items: ['0.5 credits/minute', '15 credits for 30 minutes', '22.5 credits for 45 minutes', '30 credits for 60 minutes'] },
  { group: 'Resume Builder', items: ['2 credits to parse a resume', '1 credit for section edits', '5 credits for a full rewrite', '4 credits for JD tailoring'] },
  { group: 'Project Generator', items: ['4 credits for a full project', '1 credit for a single component edit', '1 credit for resume bullets only'] },
  { group: 'Interview Intelligence', items: ['1 credit for best answer', '2 credits for all answers', '2 credits for JD search', '5 credits for a 20-question study deck'] },
  { group: 'AI Assistant', items: ['1 credit per chat query', '2 credits for deep analysis'] },
];

const shortcuts = [
  { title: 'Credit Packs', href: '/creditPack', description: 'Manage purchase packs and pricing tiers.', icon: Coins },
  { title: 'Credit Purchases', href: '/creditPurchase', description: 'Review confirmed, pending, and failed purchases.', icon: CreditCard },
  { title: 'Credit Usage', href: '/creditUsage', description: 'Inspect how credits are consumed across features.', icon: Gauge },
  { title: 'Credit Ledger', href: '/creditLedger', description: 'Audit credit debits and manual grants.', icon: Receipt },
  { title: 'Credit Balance', href: '/userCreditBalance', description: 'See per-user balances and totals.', icon: BadgeIndianRupee },
  { title: 'Feature Cost', href: '/featureCost', description: 'Edit the feature-to-credit matrix.', icon: Target },
  { title: 'Credit Config', href: '/creditConfig', description: 'Manage global credit policy flags.', icon: ShieldCheck },
  { title: 'Grant Credits', href: '/grantCredits', description: 'Manually assign credits to users.', icon: Sparkles },
];

function SectionCard({ title, description, icon: Icon, href }: { title: string; description: string; icon: any; href: string }) {
  return (
    <a
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
            <Icon size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">{title}</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
          </div>
        </div>
        <ArrowRight className="mt-1 size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
      </div>
    </a>
  );
}

type BillingSummary = {
  packs: {
    totalPacks: number;
    activePacks: number;
    totalCredits: string;
    activeCredits: string;
  };
  purchases: {
    totalPurchases: number;
    confirmedPurchases: number;
    pendingPurchases: number;
    latestPurchaseAt: string | null;
    latestConfirmedAt: string | null;
  };
  usage: {
    totalUsage: number;
    latestUsageAt: string | null;
  };
  recentPacks: Array<{
    id: string;
    code: string;
    name: string;
    credits: string;
    currency: string;
    amountMajor: string;
    active: boolean;
    isPopular: boolean;
  }>;
  recentPurchases: Array<{
    id: string;
    createdAt: string;
    confirmedAt: string | null;
    userId: string | null;
  }>;
  recentUsage: Array<{
    id: string;
    createdAt: string;
    userId: string | null;
  }>;
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: any;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{detail}</div>
        </div>
        <div className="rounded-xl bg-blue-50 p-3 text-blue-600 ring-1 ring-blue-100">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  const callProcedure = useCallProcedure<Procedures>();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    let active = true;

    const loadSummary = async () => {
      try {
        const data = await callProcedure('getBillingSummary');
        if (active) setSummary(data as BillingSummary);
      } finally {
        if (active) setLoadingSummary(false);
      }
    };

    loadSummary();

    return () => {
      active = false;
    };
  }, [callProcedure]);

  const packSummary = summary?.packs ?? null;
  const purchaseSummary = summary?.purchases ?? null;
  const usageSummary = summary?.usage ?? null;

  return (
    <Page>
      <div className="space-y-8 p-6 lg:p-8">
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-7 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                <Coins className="size-3.5 text-amber-300" /> Billing
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Credits, packs, and usage live in one place.</h1>
                <p className="max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                  This admin landing page mirrors the published pricing sheet and points you to the controls that matter: packs, purchases, usage, balances, feature costs, and manual grants.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[420px]">
              {[
                { label: 'Packs', value: loadingSummary ? '—' : String(packSummary?.totalPacks ?? 0), icon: CreditCard },
                { label: 'Purchases', value: loadingSummary ? '—' : String(purchaseSummary?.totalPurchases ?? 0), icon: FileText },
                { label: 'Never expire', value: 'Yes', icon: Timer },
                { label: 'Usage', value: loadingSummary ? '—' : String(usageSummary?.totalUsage ?? 0), icon: Gauge },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                  <item.icon className="size-4 text-amber-300" />
                  <div className="mt-3 text-2xl font-semibold tracking-tight">{item.value}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-white/45">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Credit Packs"
            value={loadingSummary ? '…' : String(packSummary?.totalPacks ?? 0)}
            detail={loadingSummary ? 'Loading pack summary' : `${packSummary?.activePacks ?? 0} active packs · ${packSummary?.activeCredits ?? '0'} active credits`}
            icon={Coins}
          />
          <MetricCard
            label="Purchases"
            value={loadingSummary ? '…' : String(purchaseSummary?.totalPurchases ?? 0)}
            detail={loadingSummary ? 'Loading purchase summary' : `${purchaseSummary?.confirmedPurchases ?? 0} confirmed · ${purchaseSummary?.pendingPurchases ?? 0} pending`}
            icon={CreditCard}
          />
          <MetricCard
            label="Usage"
            value={loadingSummary ? '…' : String(usageSummary?.totalUsage ?? 0)}
            detail={loadingSummary ? 'Loading usage summary' : `Latest usage ${formatDateTime(usageSummary?.latestUsageAt ?? null)}`}
            icon={Gauge}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Live Summary</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Recent purchases and usage</h2>
                <p className="mt-1 text-sm text-slate-500">The latest admin activity pulled directly from the billing tables.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-sm font-semibold text-slate-900">Recent purchases</div>
                <div className="mt-3 space-y-3">
                  {loadingSummary ? (
                    <div className="text-sm text-slate-500">Loading purchases…</div>
                  ) : purchaseSummary && summary?.recentPurchases.length ? (
                    summary.recentPurchases.map((purchase) => (
                      <div key={purchase.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{purchase.userId ?? 'Unknown user'}</div>
                            <div className="mt-0.5 text-xs text-slate-500">Created {formatDateTime(purchase.createdAt)}</div>
                          </div>
                          <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${purchase.confirmedAt ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'}`}>
                            {purchase.confirmedAt ? 'Confirmed' : 'Pending'}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">No purchases found.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-sm font-semibold text-slate-900">Recent usage</div>
                <div className="mt-3 space-y-3">
                  {loadingSummary ? (
                    <div className="text-sm text-slate-500">Loading usage…</div>
                  ) : summary && summary.recentUsage.length ? (
                    summary.recentUsage.map((usage) => (
                      <div key={usage.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-slate-900">{usage.userId ?? 'Unknown user'}</div>
                            <div className="mt-0.5 text-xs text-slate-500">Used {formatDateTime(usage.createdAt)}</div>
                          </div>
                          <Gauge className="size-4 text-slate-400" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">No usage rows found.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pack Snapshot</div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Recent credit packs</h2>
            <p className="mt-1 text-sm text-slate-500">Quickly inspect what is active, popular, and available for purchase.</p>

            <div className="mt-5 space-y-3">
              {loadingSummary ? (
                <div className="text-sm text-slate-500">Loading packs…</div>
              ) : summary && summary.recentPacks.length ? (
                summary.recentPacks.map((pack) => (
                  <div key={pack.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{pack.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{pack.code} · {pack.currency}</div>
                      </div>
                      <div className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pack.active ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'}`}>
                        {pack.active ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
                      <span>{pack.credits} credits</span>
                      <span>{pack.amountMajor}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">No packs found.</div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map((shortcut) => (
            <SectionCard key={shortcut.title} {...shortcut} />
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Pricing Plans</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">Published credit packs</h2>
                <p className="mt-1 text-sm text-slate-500">The admin catalog matches the pricing PDF across INR, USD, and GBP.</p>
              </div>
              <div className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">One-time purchase</div>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
              <div className="grid grid-cols-[1.5fr_0.6fr_0.8fr_0.5fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                <div>Pack</div>
                <div>Credits</div>
                <div>Price</div>
                <div>Tier</div>
              </div>
              {pricingRows.map((row) => (
                <div key={row.pack} className="grid grid-cols-[1.5fr_0.6fr_0.8fr_0.5fr] gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {row.pack}
                    {row.popular && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-100">Popular</span>}
                  </div>
                  <div className="text-sm text-slate-600">{row.credits}</div>
                  <div className="text-sm text-slate-600">{row.price}</div>
                  <div className="text-sm text-slate-600">{row.popular ? 'Top' : 'Standard'}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Credits never expire. The free signup tier starts with 3 credits.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Feature Cost Matrix</div>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">Where credits are spent</h2>
              <p className="mt-1 text-sm text-slate-500">These are the billing rules the rest of the product should follow.</p>
            </div>

            <div className="mt-6 space-y-4">
              {featureCosts.map((group) => (
                <div key={group.group} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="text-sm font-semibold text-slate-900">{group.group}</div>
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-2 size-1.5 rounded-full bg-blue-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Page>
  );
}
