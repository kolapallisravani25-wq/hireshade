import React from 'react';
import { RefreshCw } from 'lucide-react';
import { TimeFilterDropdown } from '../TimeFilterDropdown';
import { DateFilterOptions } from '../../types';

interface AnalyticsHeaderProps {
  title: string;
  subtitle: string;
  isDark: boolean;
  dateFirst?: string;
  dateLast?: string;
  dateFilter: string;
  onDateFilterChange: (value: string) => void;
  dateFilters: DateFilterOptions[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  
  showCustomDateRange?: boolean;
  customStartDate?: string;
  setCustomStartDate?: (value: string) => void;
  customEndDate?: string;
  setCustomEndDate?: (value: string) => void;
  onCustomDateApply?: () => void;
  formatDateString: (dateStr: string) => string;
}

export function AnalyticsHeader({
  title,
  subtitle,
  isDark,
  dateFirst,
  dateLast,
  dateFilter,
  onDateFilterChange,
  dateFilters,
  loading,
  refreshing,
  onRefresh,
  showCustomDateRange,
  customStartDate,
  setCustomStartDate,
  customEndDate,
  setCustomEndDate,
  onCustomDateApply,
  formatDateString,
}: AnalyticsHeaderProps): React.ReactElement {
  const inputClass = `rounded-xl px-3 py-2 text-[12px] font-medium border flex-1 sm:flex-none transition-all outline-none focus:ring-2 focus:ring-blue-500/30 ${
    isDark
      ? 'bg-white/5 border-white/10 text-slate-200 focus:border-blue-500'
      : 'bg-white border-black/10 text-slate-700 focus:border-blue-500'
  }`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-8">
      <div>
        <h1 className={`text-xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
        {dateFirst && dateLast && (
          <span className={`text-[12.5px] font-semibold px-3.5 py-2 rounded-xl border transition-all ${
            isDark
              ? 'bg-blue-500/10 border-blue-500/20 text-blue-300'
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}>
            {formatDateString(dateFirst)}
            {dateFirst !== dateLast && (
              <>
                <span className="opacity-40 mx-1">–</span>
                {formatDateString(dateLast)}
              </>
            )}
          </span>
        )}

        <TimeFilterDropdown
          filters={dateFilters}
          selectedValue={dateFilter}
          onChange={onDateFilterChange}
          isDark={isDark}
        />

        <button
          onClick={onRefresh}
          disabled={loading || refreshing}
          title="Refresh Data"
          className={`p-2.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center ${
            isDark
              ? 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white'
              : 'bg-white border-black/10 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          } ${loading || refreshing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing || (loading && !dateFirst) ? 'animate-spin' : ''}`} />
        </button>

        {showCustomDateRange && setCustomStartDate && setCustomEndDate && onCustomDateApply && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className={inputClass}
            />
            <span className={`text-[12px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>to</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className={inputClass}
            />
            <button
              onClick={onCustomDateApply}
              disabled={!customStartDate || !customEndDate}
              className={`rounded-xl px-4 py-2 text-[12.5px] font-bold transition-all border active:scale-[0.97] ${
                !customStartDate || !customEndDate
                  ? `opacity-50 cursor-not-allowed ${isDark ? 'bg-white/5 border-white/5 text-slate-500' : 'bg-slate-100 border-black/5 text-slate-400'}`
                  : 'cursor-pointer bg-blue-600 hover:bg-blue-700 text-white border-blue-700 shadow-md'
              }`}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
