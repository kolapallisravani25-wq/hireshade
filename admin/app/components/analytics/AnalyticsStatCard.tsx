import React from 'react';
import { LucideIcon } from 'lucide-react';

interface AnalyticsStatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  isDark: boolean;
  accent?: string; 
  period?: string;
  sub?: string;
  progress?: number; 
}

const accentClasses: Record<string, { icon: string; iconBg: string; bar: string; iconLight: string; iconBgLight: string; barLight: string }> = {
  yellow:  { icon: 'text-yellow-500',  iconBg: 'bg-yellow-500/10 border-yellow-500/20',  bar: 'bg-yellow-500', iconLight: 'text-yellow-600', iconBgLight: 'bg-yellow-50 border-yellow-200', barLight: 'bg-yellow-500' },
  emerald: { icon: 'text-emerald-400', iconBg: 'bg-emerald-500/10 border-emerald-500/20', bar: 'bg-emerald-400', iconLight: 'text-emerald-600', iconBgLight: 'bg-emerald-50 border-emerald-200', barLight: 'bg-emerald-400' },
  green:   { icon: 'text-emerald-400', iconBg: 'bg-emerald-500/10 border-emerald-500/20', bar: 'bg-emerald-400', iconLight: 'text-emerald-600', iconBgLight: 'bg-emerald-50 border-emerald-200', barLight: 'bg-emerald-400' },
  violet:  { icon: 'text-violet-400',  iconBg: 'bg-violet-500/10 border-violet-500/20',  bar: 'bg-violet-400', iconLight: 'text-violet-600', iconBgLight: 'bg-violet-50 border-violet-200', barLight: 'bg-violet-400' },
  purple:  { icon: 'text-violet-400',  iconBg: 'bg-violet-500/10 border-violet-500/20',  bar: 'bg-violet-400', iconLight: 'text-violet-600', iconBgLight: 'bg-violet-50 border-violet-200', barLight: 'bg-violet-400' },
  cyan:    { icon: 'text-cyan-400',    iconBg: 'bg-cyan-500/10 border-cyan-500/20',      bar: 'bg-cyan-400', iconLight: 'text-cyan-600', iconBgLight: 'bg-cyan-50 border-cyan-200', barLight: 'bg-cyan-400' },
  amber:   { icon: 'text-amber-400',   iconBg: 'bg-amber-500/10 border-amber-500/20',    bar: 'bg-amber-400', iconLight: 'text-amber-600', iconBgLight: 'bg-amber-50 border-amber-200', barLight: 'bg-amber-400' },
  pink:    { icon: 'text-pink-400',    iconBg: 'bg-pink-500/10 border-pink-500/20',      bar: 'bg-pink-400', iconLight: 'text-pink-600', iconBgLight: 'bg-pink-50 border-pink-200', barLight: 'bg-pink-400' },
  indigo:  { icon: 'text-indigo-400',  iconBg: 'bg-indigo-500/10 border-indigo-500/20',  bar: 'bg-indigo-400', iconLight: 'text-indigo-600', iconBgLight: 'bg-indigo-50 border-indigo-200', barLight: 'bg-indigo-400' },
  rose:    { icon: 'text-rose-400',    iconBg: 'bg-rose-500/10 border-rose-500/20',      bar: 'bg-rose-400', iconLight: 'text-rose-600', iconBgLight: 'bg-rose-50 border-rose-200', barLight: 'bg-rose-400' },
  blue:    { icon: 'text-blue-400',    iconBg: 'bg-blue-500/10 border-blue-500/20',      bar: 'bg-blue-400', iconLight: 'text-blue-600', iconBgLight: 'bg-blue-50 border-blue-200', barLight: 'bg-blue-400' },
};

export function AnalyticsStatCard({
  label,
  value,
  icon: Icon,
  isDark,
  accent = 'blue',
  period,
  sub,
  progress,
}: AnalyticsStatCardProps): React.ReactElement {
  const a = accentClasses[accent] || accentClasses.blue;
  const displayValue = typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <div className={`rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 border transition-all ${
      isDark
        ? 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]'
        : 'bg-white border-black/[0.07] shadow-sm hover:shadow-md'
    }`}>
      <div className={`rounded-xl p-2 sm:p-2.5 flex-shrink-0 border ${isDark ? a.iconBg : a.iconBgLight}`}>
        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isDark ? a.icon : a.iconLight}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] sm:text-xs font-semibold uppercase tracking-widest mb-1 truncate ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          {label}
        </p>
        <p className={`text-xl sm:text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {displayValue}
        </p>
        {sub && <p className={`text-[11px] mt-0.5 truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{sub}</p>}
        
        {progress !== undefined && (
          <div className={`mt-2 sm:mt-3 h-1 sm:h-1.5 w-full rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-slate-100'}`}>
            <div className={`h-full rounded-full ${isDark ? a.bar : a.barLight}`} style={{ width: `${progress}%` }} />
          </div>
        )}
        
        {period && (
          <p className={`text-[9px] sm:text-[9.5px] font-semibold mt-1.5 truncate ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
            {period}
          </p>
        )}
      </div>
    </div>
  );
}