import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useCallProcedure, Page } from '@kottster/react';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useThemeListener } from '../../utils/theme';
import { AnalyticsHeader } from '../../components/analytics/AnalyticsHeader';
import { AnalyticsStatCard } from '../../components/analytics/AnalyticsStatCard';
import { AnalyticsChartContainer } from '../../components/analytics/AnalyticsChartContainer';
import { AnalyticsTooltip } from '../../components/analytics/AnalyticsTooltip';
import { AnalyticsError } from '../../components/analytics/AnalyticsError';
import {
  DateFilterOptions,
  SeriesConfig,
  ATSDataRow,
} from '../../types';

const DATE_FILTERS: DateFilterOptions[] = [
  { label: 'Today', value: 'today', days: 0 },
  { label: 'Last 7 Days', value: '7', days: 7 },
  { label: 'Last 30 Days', value: '30', days: 30 },
  { label: 'Last 90 Days', value: '90', days: 90 },
  { label: 'Last 6 Months', value: '180', days: 180 },
  { label: 'Last Year', value: '365', days: 365 },
  { label: 'Custom Range', value: 'custom', days: 0 },
];

const SERIES: SeriesConfig[] = [
  { key: 'total_analyses', label: 'Total Analyses', color: '#ca8a04' },
  { key: 'successful_matches', label: 'Successful Matches', color: '#10b981' },
  { key: 'pending_reviews', label: 'Pending Reviews', color: '#8b5cf6' },
  { key: 'completed_processes', label: 'Needs Review', color: '#f43f5e' },
];

const STAT_CARDS = [
  { key: 'total',      label: 'Total Analyses',    icon: Activity,      accent: 'yellow' },
  { key: 'successful', label: 'Successful Matches', icon: CheckCircle,   accent: 'emerald' },
  { key: 'pending',    label: 'Pending Reviews',    icon: Clock,         accent: 'violet' },
  { key: 'completed',  label: 'Needs Review',       icon: AlertTriangle, accent: 'rose' },
] as const;

const formatDateString = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
};

export default function ATSAnalyticsPage(): React.ReactElement {
  const [rows, setRows] = useState<ATSDataRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState<boolean>(false);

  const [dateFilter, setDateFilter] = useState<string>('90');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCustomDateRange, setShowCustomDateRange] = useState<boolean>(false);

  const callProcedure = useCallProcedure();
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const cleanup = useThemeListener((dark: boolean) => setIsDark(dark));
    return cleanup;
  }, []);

  const fetchData = useCallback(async (isManualRefresh = false): Promise<void> => {
    if (!callProcedure) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      let startDate: string | undefined;
      let endDate: string | undefined;

      const now = new Date();
      if (dateFilter === 'today') {
        const todayStr = now.toISOString().split('T')[0];
        startDate = todayStr;
        endDate = todayStr;
      } else if (dateFilter === 'custom') {
        if (customStartDate && customEndDate) {
          startDate = customStartDate;
          endDate = customEndDate;
        }
      } else if (dateFilter !== 'all') {
        const days = parseInt(dateFilter, 10) || 90;
        const start = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
        startDate = start.toISOString().split('T')[0];
        endDate = now.toISOString().split('T')[0];
      }

      const data = await (callProcedure as any)('getATSAnalytics', { startDate, endDate }) as ATSDataRow[];

      if (!abortController.signal.aborted) {
        setRows(Array.isArray(data) ? data : []);
        setError(null);
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
        abortControllerRef.current = null;
      }
    }
  }, [dateFilter, customStartDate, customEndDate, callProcedure]);

  useEffect(() => {
    fetchData();
    return () => { abortControllerRef.current?.abort(); };
  }, [fetchData]);

  const handleRefresh = () => fetchData(true);

  const handleDateFilterChange = (value: string): void => {
    setDateFilter(value);
    setShowCustomDateRange(value === 'custom');
    if (value !== 'custom') {
      setCustomStartDate('');
      setCustomEndDate('');
    }
  };

  const handleCustomDateApply = (): void => {
    if (customStartDate && customEndDate) fetchData();
  };

  const stats = useMemo(() => {
    if (!rows || rows.length === 0) return { total: 0, successful: 0, pending: 0, completed: 0 };
    const latestRow = rows[rows.length - 1];
    return {
      total: Number(latestRow.total_analyses) || 0,
      successful: Number(latestRow.successful_matches) || 0,
      pending: Number(latestRow.pending_reviews) || 0,
      completed: Number(latestRow.completed_processes) || 0,
    };
  }, [rows]);

  const computedDateRange = useMemo(() => {
    const now = new Date();
    if (dateFilter === 'today') {
      const todayStr = now.toISOString().split('T')[0];
      return { first: todayStr, last: todayStr };
    }
    if (dateFilter === 'custom') {
      if (customStartDate && customEndDate) {
        return { first: customStartDate, last: customEndDate };
      }
      return { first: '', last: '' };
    }
    const days = parseInt(dateFilter, 10);
    if (!isNaN(days) && days > 0) {
      const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return {
        first: start.toISOString().split('T')[0],
        last: now.toISOString().split('T')[0],
      };
    }
    return { first: '', last: '' };
  }, [dateFilter, customStartDate, customEndDate]);

  const { first, last } = computedDateRange;

  const activeFilterLabel = useMemo(() => {
    if (dateFilter === 'custom' && customStartDate && customEndDate) {
      return `${formatDateString(customStartDate)} – ${formatDateString(customEndDate)}`;
    }
    const found = DATE_FILTERS.find(f => f.value === dateFilter);
    return found?.label || 'All Time';
  }, [dateFilter, customStartDate, customEndDate]);

  return (
    <Page title="ATS Analytics">
      <div className={`p-4 sm:p-7 sm:px-8 min-h-[calc(100vh-64px)] font-sans relative transition-colors duration-300 ${isDark ? 'text-slate-100' : 'bg-slate-50 text-slate-900'} rounded-2xl`}>

        <AnalyticsHeader
          title="ATS Analytics"
          subtitle="Applicant tracking & match overview"
          isDark={isDark}
          dateFirst={first}
          dateLast={last}
          dateFilter={dateFilter}
          onDateFilterChange={handleDateFilterChange}
          dateFilters={DATE_FILTERS}
          loading={loading}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showCustomDateRange={showCustomDateRange}
          customStartDate={customStartDate}
          setCustomStartDate={setCustomStartDate}
          customEndDate={customEndDate}
          setCustomEndDate={setCustomEndDate}
          onCustomDateApply={handleCustomDateApply}
          formatDateString={formatDateString}
        />

        <AnalyticsError error={error} isDark={isDark} />

        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-4 mb-6 lg:grid-cols-3">
          {STAT_CARDS.map(({ key, label, icon: Icon, accent }) => (
            <AnalyticsStatCard
              key={key}
              label={label}
              value={stats[key as keyof typeof stats]}
              icon={Icon}
              isDark={isDark}
              accent={accent}
              period={activeFilterLabel}
              progress={60}
            />
          ))}
        </div>

        <AnalyticsChartContainer
          title="ATS Trends Over Time"
          isDark={isDark}
          loading={loading}
          hasData={rows.length > 0}
          error={error}
          height="h-[220px] sm:h-[400px]"
          dateFirst={first}
          dateLast={last}
          formatDateString={formatDateString}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 10, right: 8, left: -15, bottom: 0 }}>
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#1e293b' : '#e2e8f0'} />
              <XAxis dataKey="date" tick={{ fill: isDark ? '#475569' : '#9ca3af', fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis className="hidden sm:block" tick={{ fill: isDark ? '#475569' : '#9ca3af', fontSize: 11 }} />
              <Tooltip content={<AnalyticsTooltip isDark={isDark} />} />
              <Legend wrapperStyle={{ color: isDark ? '#94a3b8' : '#6b7280', fontSize: 13, paddingTop: 12 }} />
              {SERIES.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#grad-${s.key})`}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsChartContainer>

      </div>
    </Page>
  );
}
