import { useState, useEffect, useMemo, useCallback } from 'react';
import { useCallProcedure, Page } from '@kottster/react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Wallet, Activity, Globe, Cpu, DollarSign,
  TrendingDown, Brain, Key,
} from 'lucide-react';
import { useThemeListener } from '../../utils/theme';
import { AnalyticsHeader } from '../../components/analytics/AnalyticsHeader';
import { AnalyticsStatCard } from '../../components/analytics/AnalyticsStatCard';
import { AnalyticsChartContainer } from '../../components/analytics/AnalyticsChartContainer';
import { AnalyticsTooltip } from '../../components/analytics/AnalyticsTooltip';
import { AnalyticsError } from '../../components/analytics/AnalyticsError';
import type {
  DateFilterOptions,
  APIAnalyticsSummary, ModelUsageSummary,
} from '../../types';


const DATE_FILTERS: DateFilterOptions[] = [
  { label: 'All (30 days)', value: 'all',       days: 30 },
  { label: 'Yesterday',     value: 'yesterday', days: 1  },
];

const COLORS = [
  '#60a5fa','#34d399','#a78bfa','#fbbf24',
  '#f87171','#22d3ee','#fb7185','#86efac','#fcd34d','#818cf8',
  '#c084fc','#fdba74','#67e8f9','#86efac','#fca5a5','#a5f3fc',
];


const fmtCost   = (v: number) => `$${(v ?? 0).toFixed(4)}`;
const fmtTokens = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000   ? `${(v / 1_000).toFixed(1)}K`
  : String(v ?? 0);
const fmtNum = (v: number) => Number(v ?? 0).toLocaleString();


const card      = (d: boolean) => `rounded-2xl border backdrop-blur-sm transition-all duration-200 ${d ? 'bg-slate-900/80 border-blue-500/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]' : 'bg-white/90 border-blue-200/40 shadow-[0_4px_24px_rgba(59,130,246,0.08)]'}`;
const tx        = (d: boolean) => d ? 'text-slate-100' : 'text-slate-900';
const mu        = (d: boolean) => d ? 'text-slate-400' : 'text-slate-500';
const su        = (d: boolean) => d ? 'text-slate-500' : 'text-slate-400';
const rowHov    = (d: boolean) => d ? 'hover:bg-blue-500/5' : 'hover:bg-blue-50/60';
const divBorder = (d: boolean) => d ? 'border-blue-500/10' : 'border-blue-100';


function SectionHeader({ title, badge, isDark }: { title: string; badge?: string | number; isDark: boolean }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className={`text-[13px] font-bold tracking-tight ${tx(isDark)}`}>{title}</h3>
      {badge !== undefined && (
        <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${isDark ? 'border-blue-500/20 text-slate-400 bg-blue-500/10' : 'border-blue-100 text-slate-500 bg-blue-50'}`}>
          {badge}
        </span>
      )}
    </div>
  );
}


function ModelTable({ models, isDark }: { models: ModelUsageSummary[]; isDark: boolean }) {
  const [page, setPage] = useState(0);
  const pageSize   = 10;
  const totalPages = Math.ceil(models.length / pageSize);
  const visible    = models.slice(page * pageSize, (page + 1) * pageSize);

  const thCls = `px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${mu(isDark)}`;
  const tdCls = `px-4 py-3 text-[12px] whitespace-nowrap`;

  return (
    <div className={card(isDark)}>
      <div className="px-5 pt-5 pb-2">
        <SectionHeader title="Model Usage Breakdown" badge={`${models.length} models`} isDark={isDark} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className={`border-b ${divBorder(isDark)}`}>
              {['Model','Provider','Context','Cost/1M (P/C)','Requests','Prompt','Completion','Reasoning','Total Tokens','Cost'].map(h => (
                <th key={h} className={thCls}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((m, i) => (
              <tr key={m.model} className={`border-b transition-colors ${divBorder(isDark)} ${rowHov(isDark)}`}>
                <td className={`${tdCls} font-semibold max-w-[200px] ${tx(isDark)}`}>
                  <span className="inline-flex items-center gap-2 truncate">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: COLORS[(page * pageSize + i) % COLORS.length] }}
                    />
                    {m.model.split('/').pop()}
                  </span>
                </td>
                <td className={`${tdCls} ${mu(isDark)}`}>{m.provider}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{m.contextLength ? fmtTokens(m.contextLength) : '—'}</td>
                <td className={`${tdCls} text-[11px] ${mu(isDark)}`}>
                  {m.promptCost != null && m.completionCost != null
                    ? `${fmtCost(m.promptCost * 1_000_000)} / ${fmtCost(m.completionCost * 1_000_000)}`
                    : '—'}
                </td>
                <td className={`${tdCls} ${tx(isDark)}`}>{fmtNum(m.totalRequests)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtTokens(m.promptTokens)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtTokens(m.completionTokens)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtTokens(m.reasoningTokens)}</td>
                <td className={`${tdCls} font-semibold ${tx(isDark)}`}>{fmtTokens(m.totalTokens)}</td>
                <td className={`${tdCls} font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{fmtCost(m.totalCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className={`flex items-center justify-between px-5 py-3 border-t ${divBorder(isDark)}`}>
          <span className={`text-[11px] ${mu(isDark)}`}>Page {page + 1} of {totalPages}</span>
          <div className="flex gap-2">
            {(['Prev', 'Next'] as const).map((label) => {
              const isDisabled = label === 'Prev' ? page === 0 : page >= totalPages - 1;
              return (
                <button key={label}
                  disabled={isDisabled}
                  onClick={() => setPage(p => label === 'Prev' ? p - 1 : p + 1)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                    isDisabled
                      ? `opacity-40 cursor-not-allowed ${isDark ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-400'}`
                      : `cursor-pointer ${isDark ? 'bg-blue-500/10 border-blue-500/20 text-blue-300 hover:bg-blue-500/20' : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'}`
                  }`}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


function KeysPanel({ keys, isDark }: { keys: any[]; isDark: boolean }) {
  if (!keys?.length) return null;
  const thCls = `px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${mu(isDark)}`;
  const tdCls = `px-4 py-3 text-[12px] whitespace-nowrap`;

  return (
    <div className={card(isDark)}>
      <div className="px-5 pt-5 pb-2">
        <SectionHeader title="API Keys Overview" badge={`${keys.length} keys`} isDark={isDark} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className={`border-b ${divBorder(isDark)}`}>
              {['Name','Status','Limit','Usage','Daily','Weekly','Monthly','Created'].map(h => (
                <th key={h} className={thCls}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(k => (
              <tr key={k.hash} className={`border-b transition-colors ${divBorder(isDark)} ${rowHov(isDark)}`}>
                <td className={`${tdCls} font-semibold ${tx(isDark)}`}>{k.name || k.label || '—'}</td>
                <td className={tdCls}>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    k.disabled
                      ? isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-600'
                      : isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-600'
                  }`}>
                    {k.disabled ? 'Disabled' : 'Active'}
                  </span>
                </td>
                <td className={`${tdCls} ${mu(isDark)}`}>{k.limit != null ? fmtCost(k.limit) : '∞'}</td>
                <td className={`${tdCls} font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{fmtCost(k.usage)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtCost(k.usage_daily)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtCost(k.usage_weekly)}</td>
                <td className={`${tdCls} ${mu(isDark)}`}>{fmtCost(k.usage_monthly)}</td>
                <td className={`${tdCls} ${su(isDark)}`}>{new Date(k.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



function ModelBarTooltip({ active, payload, label, isDark }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[11px] shadow-xl min-w-[160px] ${
      isDark
        ? 'bg-slate-900 border-blue-500/20 text-slate-200'
        : 'bg-white border-blue-100 text-slate-700'
    }`}>
      <div className={`font-bold mb-1.5 text-[12px] ${tx(isDark)}`}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span className={mu(isDark)}>{p.name}</span>
          <span className="font-semibold">{fmtCost(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

function ModelPieTooltip({ active, payload, isDark }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-[11px] shadow-xl min-w-[180px] ${
      isDark
        ? 'bg-slate-900 border-blue-500/20 text-slate-200'
        : 'bg-white border-blue-100 text-slate-700'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.payload.fill }} />
        <span className={`font-bold text-[12px] ${tx(isDark)}`}>{p.name}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className={mu(isDark)}>Cost</span>
        <span className="font-semibold">{fmtCost(Number(p.value))}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className={mu(isDark)}>Share</span>
        <span className="font-semibold">{(p.payload.percent * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}


const formatDateStr = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
};


export default function APIManagementPage() {
  const [data,       setData]       = useState<APIAnalyticsSummary | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [isDark,     setIsDark]     = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const callProcedure = useCallProcedure();

  useEffect(() => {
    const cleanup = useThemeListener((d: boolean) => setIsDark(d));
    return cleanup;
  }, []);

  const fetchData = useCallback(async () => {
    if (!callProcedure) return;
    setLoading(true); setError(null);
    try {
      let filterDate: string | undefined;
      if (dateFilter === 'yesterday') {
        const d = new Date(); d.setDate(d.getDate() - 1);
        filterDate = d.toISOString().split('T')[0];
      }
      const result = await (callProcedure as any)('getAPIAnalytics', filterDate) as APIAnalyticsSummary;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [dateFilter, callProcedure]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const computedDateRange = useMemo(() => {
    const now = new Date();

    if (dateFilter === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const yStr = d.toISOString().split('T')[0];
      return { first: yStr, last: yStr };
    }
    
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      first: start.toISOString().split('T')[0],
      last:  now.toISOString().split('T')[0],
    };
  }, [dateFilter]);

  const { first: dateFirst, last: dateLast } = computedDateRange;

  const activeFilterLabel = useMemo(() => {
    const found = DATE_FILTERS.find(f => f.value === dateFilter);
    return found?.label || 'All Time';
  }, [dateFilter]);

  
  const top10Models = useMemo(() =>
    (data?.modelUsage ?? []).slice(0, 10),
  [data]);

  
  const modelBarData = useMemo(() =>
    top10Models.map((m) => ({
      name:      m.model.split('/').pop() ?? m.model,
      fullModel: m.model,
      provider:  m.provider,
      totalCost: m.totalCost,
      requests:  m.totalRequests,
    })),
  [top10Models]);

  
  const modelPieData = useMemo(() => {
    const all = data?.modelUsage ?? [];
    const top = all.slice(0, 10);
    const othersCost = all.slice(10).reduce((s, m) => s + m.totalCost, 0);
    const slices = top.map((m, i) => ({
      name:    m.model.split('/').pop() ?? m.model,
      value:   m.totalCost,
      fill:    COLORS[i % COLORS.length],
      percent: 0, 
    }));
    if (othersCost > 0) {
      slices.push({ name: 'Others', value: othersCost, fill: '#64748b', percent: 0 });
    }
    return slices;
  }, [data]);

  const tokenPieData = useMemo(() => !data ? [] : [
    { name: 'Prompt',     value: data.totalPromptTokens,     fill: '#60a5fa' },
    { name: 'Completion', value: data.totalCompletionTokens, fill: '#34d399' },
    { name: 'Reasoning',  value: data.totalReasoningTokens,  fill: '#a78bfa' },
  ].filter(d => d.value > 0), [data]);

  const gridColor = isDark ? '#1e3a5f33' : '#dbeafe66';
  const tickColor = isDark ? '#334155'   : '#94a3b8';

  
  const ModelXTick = ({ x, y, payload }: any) => (
    <text
      x={x} y={y + 10}
      textAnchor="end"
      fill={tickColor}
      fontSize={10}
      transform={`rotate(-35, ${x}, ${y + 10})`}
    >
      {payload.value.length > 14 ? `${payload.value.slice(0, 14)}…` : payload.value}
    </text>
  );


  return (
    <Page title="API Management">
      <div className={`min-h-[calc(100vh-64px)] p-4 sm:p-7 sm:px-8 font-sans ${isDark ? 'text-slate-100' : 'bg-slate-50 text-slate-900'} rounded-2xl`}>

        <AnalyticsHeader
          title="API Management"
          subtitle="OpenRouter analytics & usage"
          isDark={isDark}
          dateFirst={dateFirst}
          dateLast={dateLast}
          dateFilter={dateFilter}
          onDateFilterChange={setDateFilter}
          dateFilters={DATE_FILTERS}
          loading={loading}
          refreshing={false}
          onRefresh={fetchData}
          formatDateString={formatDateStr}
        />

        <AnalyticsError error={error} isDark={isDark} />

        {loading && !data && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <Activity size={22} className={`animate-spin ${isDark ? 'text-blue-400' : 'text-blue-500'}`} />
            <span className={`text-[13px] ${mu(isDark)}`}>Loading OpenRouter analytics…</span>
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
              <AnalyticsStatCard label="Account Balance"  value={fmtCost(Math.max(0, data.accountTotalCredits - data.accountTotalUsage))} sub={`of ${fmtCost(data.accountTotalCredits)}`} isDark={isDark} icon={Wallet}      accent="blue"   period={activeFilterLabel} />
              <AnalyticsStatCard label="Account Usage"    value={fmtCost(data.accountTotalUsage)}                                         isDark={isDark} icon={Activity}    accent="green"  period={activeFilterLabel} />
              <AnalyticsStatCard label="Total Requests"   value={fmtNum(data.totalRequests)}                                              isDark={isDark} icon={Globe}       accent="violet" period={activeFilterLabel} />
              <AnalyticsStatCard label="Total Tokens"     value={fmtTokens(data.totalTokens)} sub={`${fmtTokens(data.totalPromptTokens)} P · ${fmtTokens(data.totalCompletionTokens)} C`} isDark={isDark} icon={Cpu} accent="cyan" period={activeFilterLabel} />
              <AnalyticsStatCard label="App Cost (30d)"   value={fmtCost(data.totalCost)}     sub={data.totalByokCost > 0 ? `BYOK: ${fmtCost(data.totalByokCost)}` : undefined} isDark={isDark} icon={DollarSign} accent="amber" period={activeFilterLabel} />
              <AnalyticsStatCard label="Avg Cost / Req"   value={fmtCost(data.avgCostPerRequest)}                                         isDark={isDark} icon={TrendingDown} accent="rose"   period={activeFilterLabel} />
              <AnalyticsStatCard label="Models Used"      value={String(data.uniqueModels)}   sub={`${data.uniqueProviders} providers`}   isDark={isDark} icon={Brain}       accent="violet" period={activeFilterLabel} />
              <AnalyticsStatCard label="Active Keys"      value={`${data.activeKeys}/${data.totalKeys}`}                                  isDark={isDark} icon={Key}         accent="green"  period={activeFilterLabel} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
              <AnalyticsChartContainer title="Daily Usage Trend" isDark={isDark} loading={loading} hasData={data.dailyUsage.length > 0} height="h-[220px] sm:h-[300px]" className="xl:col-span-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.dailyUsage} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gReq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}   />
                      </linearGradient>
                      <linearGradient id="gCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#34d399" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#34d399" stopOpacity={0}   />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="date" tick={{ fill: tickColor, fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis yAxisId="left" className="hidden sm:block" tick={{ fill: tickColor, fontSize: 11 }} />
                    <YAxis yAxisId="right" className="hidden sm:block" orientation="right" tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip content={<AnalyticsTooltip isDark={isDark} />} />
                    <Legend wrapperStyle={{ color: tickColor, fontSize: 12, paddingTop: 10 }} />
                    <Area yAxisId="left"  type="monotone" dataKey="requests"  name="Requests" stroke="#60a5fa" strokeWidth={2} fill="url(#gReq)"  dot={false} activeDot={{ r: 4 }} />
                    <Area yAxisId="right" type="monotone" dataKey="totalCost" name="Cost ($)" stroke="#34d399" strokeWidth={2} fill="url(#gCost)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </AnalyticsChartContainer>

              <AnalyticsChartContainer title="Token Distribution" isDark={isDark} loading={loading} hasData={tokenPieData.length > 0} height="h-[220px] sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                      <Pie
                        data={tokenPieData}
                        cx="50%" cy="50%"
                        innerRadius={55} outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                      {tokenPieData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtTokens(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </AnalyticsChartContainer>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">

              <AnalyticsChartContainer
                title="Cost by Model"
                isDark={isDark}
                loading={loading}
                hasData={modelBarData.length > 0}
                height="h-[260px] sm:h-[340px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelBarData}
                    margin={{ top: 4, right: 8, left: -16, bottom: 48 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis
                      dataKey="name"
                      tick={<ModelXTick />}
                      interval={0}
                    />
                    <YAxis className="hidden sm:block" tick={{ fill: tickColor, fontSize: 11 }} />
                    <Tooltip content={<ModelBarTooltip isDark={isDark} />} />
                    <Bar dataKey="totalCost" name="Cost ($)" radius={[6, 6, 0, 0]} maxBarSize={36}>
                      {modelBarData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </AnalyticsChartContainer>

              <AnalyticsChartContainer
                title="Model Distribution"
                isDark={isDark}
                loading={loading}
                hasData={modelPieData.length > 0}
                height="h-[260px] sm:h-[340px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={modelPieData}
                      cx="50%" cy="48%"
                      innerRadius={52} outerRadius={82}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }: any) =>
                        percent > 0.04 ? `${name} ${(percent * 100).toFixed(1)}%` : ''
                      }
                      labelLine={false}
                    >
                      {modelPieData.map((e, i) => (
                        <Cell key={i} fill={e.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ModelPieTooltip isDark={isDark} />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, color: tickColor }}
                      formatter={(value) =>
                        value.length > 18 ? `${value.slice(0, 18)}…` : value
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </AnalyticsChartContainer>

            </div>

            {data.modelUsage.length > 0 && (
              <div className="mb-5">
                <ModelTable models={data.modelUsage} isDark={isDark} />
              </div>
            )}

            {data.keys.length > 0 && (
              <div className="mb-5">
                <KeysPanel keys={data.keys} isDark={isDark} />
              </div>
            )}
          </>
        )}
      </div>
    </Page>
  );
}