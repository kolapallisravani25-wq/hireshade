import React from "react";
import { cn } from "@/lib/utils";
import type { Tab } from "@/features/launcher/types";

interface TabPillsProps {
  tab: Tab;
  onChange: (t: Tab) => void;
}

const TABS: { value: Tab; label: string }[] = [
  { value: "create", label: "Create" },
  { value: "past",   label: "Past" },
];

export function TabPills({ tab, onChange }: TabPillsProps) {
  return (
    <div className="px-3 pt-2">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-zinc-100">
        {TABS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={cn(
              "py-2 rounded-xl text-sm font-semibold transition-colors",
              tab === value
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
