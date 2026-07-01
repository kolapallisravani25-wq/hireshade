import React from 'react';

interface AnalyticsErrorProps {
  error: string | null;
  isDark: boolean;
}

export function AnalyticsError({ error, isDark }: AnalyticsErrorProps): React.ReactElement | null {
  if (!error) return null;
  
  return (
    <div className={`rounded-xl p-3 px-4 mb-6 text-[13px] border ${
      isDark
        ? 'border-red-500/40 text-red-400 bg-red-500/10'
        : 'border-red-300 text-red-500 bg-red-50'
    }`}>
      {error}
    </div>
  );
}
