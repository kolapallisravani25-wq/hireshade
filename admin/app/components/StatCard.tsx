import React from 'react';

export interface StatCardProps {
  label: string;
  value: string | number;
  badge?: string;
  sub?: string;
  isDark: boolean;
  icon?: any;
}

const glassCardDark = 'glass-card-dark';
const glassCardLight = 'glass-card-light';

export function StatCard({ label, value, badge, sub, isDark, icon: Icon }: StatCardProps): React.ReactElement {
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div className={`p-4 px-5 rounded-xl transition-all duration-200 w-full flex items-start justify-between ${isDark ? glassCardDark : glassCardLight}`}>
      <div className="flex-1 overflow-hidden">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-[13px] whitespace-nowrap ${isDark ? 'text-[#a6adc8]' : 'text-gray-500'}`}>{label}</span>
          {badge && (
            <span className={`text-[11px] rounded px-1.5 py-0.5 font-semibold ${
              isDark ? 'text-[#a6e3a1]' : 'text-emerald-500'
            }`}>▲ {badge}</span>
          )}
        </div>
        <div className={`text-2xl sm:text-3xl font-bold leading-none truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
          {displayValue}
        </div>
        {sub && (
          <div className={`text-[11px] mt-1.5 truncate ${isDark ? 'text-[#6c7086]' : 'text-gray-400'}`}>
            {sub}
          </div>
        )}
      </div>
      {Icon && (
        <div className={`p-2 rounded-lg ml-3 flex-shrink-0 ${isDark ? 'bg-white/5 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
          <Icon size={20} strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}
