import React from 'react';
import { CustomTooltipProps } from '../../types';

export function AnalyticsTooltip({ active, payload, label, isDark }: CustomTooltipProps): React.ReactElement | null {
  if (!active || !payload?.length) return null;
  
  
  const models = payload[0]?.payload?.models as string[] | undefined;
  
  
  
  const fmtCost = (v: number) => `$${(v ?? 0).toFixed(4)}`;
  const fmtNum = (v: number) => Number(v ?? 0).toLocaleString();

  return (
    <div className={`rounded-xl px-3.5 py-2.5 border shadow-xl backdrop-blur-md ${
      isDark ? 'bg-slate-900/90 border-white/10 text-slate-100' : 'bg-white/90 border-black/10 text-slate-900'
    }`}>
      <p className={`mb-1.5 font-semibold text-[13px] ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{label}</p>
      {payload.map((p, index) => {
        const val = typeof p.value === 'string' ? parseFloat(p.value) : p.value;
        const isCost = p.name?.toLowerCase().includes('cost') || p.dataKey === 'totalCost';
        
        return (
          <p key={`${p.name}-${index}`} className="my-0.5 text-[13px] font-medium" style={{ color: p.color }}>
            {p.name}: <strong>{isCost ? fmtCost(val as number) : fmtNum(val as number)}</strong>
          </p>
        );
      })}
      
      {models && models.length > 0 && (
        <div className={`mt-2 pt-2 border-t ${isDark ? 'border-blue-500/10' : 'border-blue-100'}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Models</p>
          <div className="flex flex-wrap gap-1">
            {models.map((m, i) => (
              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-md ${isDark ? 'bg-blue-500/10 text-slate-400' : 'bg-blue-50 text-slate-500'}`}>
                {m.split('/').pop()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
