import React from "react";
import { cn } from "@/lib/utils";

export function RadioDot({ active }: { active: boolean }) {
  return (
    <div
      className={cn(
        "w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all",
        active ? "border-zinc-900 bg-zinc-900" : "border-zinc-300 bg-white",
      )}
    >
      {active && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
    </div>
  );
}
