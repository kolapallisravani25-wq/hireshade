import React from 'react';

interface AnalyticsChartContainerProps {
  title: string;
  isDark: boolean;
  loading: boolean;
  hasData: boolean;
  error?: string | null;
  children: React.ReactNode;
  height?: string | number;
  dateFirst?: string;
  dateLast?: string;
  formatDateString?: (dateStr: string) => string;
  className?: string;
}

export function AnalyticsChartContainer({
  title,
  isDark,
  loading,
  hasData,
  error,
  children,
  height,
  dateFirst,
  dateLast,
  formatDateString,
  className = '',
}: AnalyticsChartContainerProps): React.ReactElement {
  const heightStyle = typeof height === 'number' ? { height: `${height}px` } : undefined;
  const heightClass = typeof height === 'string' ? height : (height === undefined ? 'h-[220px] sm:h-[400px]' : '');

  return (
    <div className={`rounded-2xl p-5 pt-6 border transition-all ${
      isDark
        ? 'bg-white/[0.04] border-white/[0.08]'
        : 'bg-white border-black/[0.07] shadow-sm'
    } ${className}`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className={`text-sm font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
          {dateFirst && dateLast && formatDateString && (
            <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              {formatDateString(dateFirst)} – {formatDateString(dateLast)}
            </p>
          )}
        </div>
      </div>

      {loading && !hasData && (
        <div className="flex flex-col items-center justify-center py-16">
           <p className={`text-sm ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>Loading data…</p>
        </div>
      )}
      
      {!loading && !hasData && !error && (
        <div className="flex flex-col items-center justify-center py-16">
          <p className={`text-sm ${isDark ? 'text-slate-600' : 'text-gray-400'}`}>No data found</p>
        </div>
      )}

      {(hasData || (loading && hasData)) && (
        <div className={`w-full ${heightClass}`} style={heightStyle}>
          {children}
        </div>
      )}
    </div>
  );
}
