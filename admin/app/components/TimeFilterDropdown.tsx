import React, { useState, useRef, useEffect } from 'react';
import { DateFilterOptions } from '../types';

interface TimeFilterDropdownProps {
  filters: DateFilterOptions[];
  selectedValue: string;
  onChange: (value: string) => void;
  isDark: boolean;
}

export function TimeFilterDropdown({
  filters,
  selectedValue,
  onChange,
  isDark,
}: TimeFilterDropdownProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentVal = String(selectedValue);
  const activeFilter = filters.find((f) => String(f.value) === currentVal);

  return (
    <div
      className={`relative inline-block z-[${isOpen ? 9999 : 50}]`}
      ref={dropdownRef}
    >

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between gap-6 px-5 py-2.5 rounded-xl transition-all duration-300 min-w-[200px] shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 active:scale-[0.98] cursor-pointer ${
          isDark
            ? 'glass-card-dark !text-slate-200'
            : 'glass-card-light !text-slate-800'
        }`}
      >
        <span className="font-semibold text-[13.5px] truncate select-none">
          {activeFilter?.label || 'Select Time'}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-500 flex-shrink-0 ${isOpen ? 'rotate-180 text-blue-500' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {isOpen && (
        <div
          className={`absolute top-[calc(100%+10px)] left-0 w-full min-w-[220px] rounded-xl p-1.5 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-200 origin-top ${
            isDark ? 'glass-card-dark bg-[#080c16]' : 'glass-card-light bg-[#ffffff]'
          } z-[10000]`}
        >
          {filters.map((filter) => {
            const isActive = String(filter.value) === currentVal;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  onChange(filter.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all flex items-center justify-between group cursor-pointer border-none outline-none ${
                  isActive
                    ? isDark
                      ? '!bg-blue-600/90 !text-white !shadow-md'
                      : '!bg-blue-600 !text-white !shadow-md'
                    : isDark
                      ? '!text-slate-300 hover:!bg-white/5 hover:!text-white'
                      : '!text-slate-600 hover:!bg-slate-100/50 hover:!text-slate-900'
                }`}
              >
                <span className="select-none">{filter.label}</span>
                {isActive && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
