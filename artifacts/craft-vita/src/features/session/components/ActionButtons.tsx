import React from "react";
import { Play, Zap, Coins } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { hasCredits } from "@/shared/utils/formatters";
import { FRONTEND_URL } from "@/features/launcher/constants";
import type { CreditsBalance } from "@/hooks/useCreditsBalance";

interface ActionButtonsProps {
  balance: CreditsBalance | null;
  isLoadingBalance: boolean;
  onStart: (isFree: boolean) => void;
}

export function ActionButtons({
  balance,
  isLoadingBalance,
  onStart,
}: ActionButtonsProps) {
  const noCreditState = !hasCredits(balance) && !isLoadingBalance;

  return (
    <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-2">
      <button
        onClick={() => onStart(true)}
        className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl border border-zinc-200 bg-white text-zinc-800 text-sm font-semibold hover:bg-zinc-50 hover:border-zinc-300 transition-all active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Play className="w-3.5 h-3.5" />
        Free Session
      </button>

      <button
        onClick={async () => {
          if (noCreditState) {
            openUrl(`${FRONTEND_URL}/billing`).catch(console.error);
          } else {
            onStart(false);
          }
        }}
        disabled={isLoadingBalance}
        className={cn(
          "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed",
          noCreditState
            ? "bg-amber-500 hover:bg-amber-600 text-white"
            : "bg-zinc-900 hover:bg-zinc-800 text-white",
        )}
      >
        {noCreditState ? (
          <Coins className="w-3.5 h-3.5" />
        ) : (
          <Zap className="w-3.5 h-3.5" />
        )}
        {noCreditState ? "Buy Credits" : "Full Session"}
      </button>
    </div>
  );
}
