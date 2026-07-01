import React from "react";
import { useAuth } from "@clerk/clerk-react";
import { Coins, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { formatCredits, hasCredits } from "@/shared/utils/formatters";
import { HoverTooltip } from "./HoverTooltip";

export function CreditsBadge() {
  const { isSignedIn } = useAuth();
  const { balance, isLoading } = useCreditsBalance();

  if (!isSignedIn) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-zinc-900 text-white text-xs font-semibold">
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }

  const creditsOk = hasCredits(balance);
  const total = balance ? formatCredits(balance.totalAvailable) : "0";

  const badge = (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-zinc-900 text-white text-xs font-semibold select-none cursor-default">
      <Coins
        className={cn("w-3 h-3", creditsOk ? "text-amber-400" : "opacity-50")}
      />
      <span>{creditsOk ? `${total} Credits` : "No Credits"}</span>
    </div>
  );

  if (!creditsOk) {
    return (
      <HoverTooltip
        text={`You don't have any interview credits.\nBuy some to start a paid session.`}
      >
        {badge}
      </HoverTooltip>
    );
  }
  return badge;
}
