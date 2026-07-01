import React from "react";
import { Info } from "lucide-react";
import { HoverTooltip } from "@/shared/components/HoverTooltip";
import type { SessionKind } from "@/features/launcher/types";

interface SessionSelectorProps {
  selected: SessionKind;
  onSelect: (k: SessionKind) => void;
  creditsOk: boolean;
  isLoadingBalance: boolean;
}

export function SessionSelector({
  selected: _selected,
  onSelect: _onSelect,
  creditsOk: _creditsOk,
  isLoadingBalance: _isLoadingBalance,
}: SessionSelectorProps) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-sm font-bold text-zinc-800">
          Select Session Type
        </span>
        <HoverTooltip text="Free sessions are limited to 5 minutes.\nPremium sessions use 0.5 credits per minute and unlock AI responses.">
          <Info className="w-3.5 h-3.5 text-zinc-400 cursor-help" />
        </HoverTooltip>
      </div>
    </div>
  );
}
