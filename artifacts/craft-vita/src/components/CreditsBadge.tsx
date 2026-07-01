/**
 * CreditsBadge — amber credit pill matching the reference design.
 * Shows "● 222.5 credits" in amber — low balance switches to coral/red.
 */

import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCreditsBalance } from "@/hooks/useCreditsBalance";
import { cn } from "@/lib/utils";

export function CreditsBadge() {
  const { balance, isLoading, refresh } = useCreditsBalance();

  if (!balance && !isLoading) return null;

  const total = balance?.totalAvailable ?? "…";
  const held  = parseFloat(balance?.heldCredits ?? "0");
  const low   = parseFloat(balance?.totalAvailable ?? "0") < 5;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/billing"
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition-all select-none hover:-translate-y-px",
              low
                ? "bg-red-50 border-red-200 hover:bg-red-100"
                : "bg-[#FEF7E0] border-[rgba(232,161,23,0.25)] hover:bg-[rgba(232,161,23,0.15)]",
            )}
          >
            {isLoading ? (
              <RefreshCw className="h-3.5 w-3.5 text-[#92640F] animate-spin" />
            ) : (
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  low ? "bg-red-500" : "bg-[#E8A117]",
                )}
              />
            )}
            <span
              className={cn(
                "text-sm font-semibold tabular-nums leading-none",
                low ? "text-red-600" : "text-[#92640F]",
              )}
            >
              {total} credits
            </span>
            {held > 0 && (
              <span className="text-[10px] text-amber-600 font-medium">({balance?.heldCredits} held)</span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-0.5">
          <p className="font-semibold">{total} credits available</p>
          {held > 0 && (
            <p className="text-amber-500">{balance?.heldCredits} held by active session</p>
          )}
          {low && (
            <p className="text-red-500">Running low — top up to continue</p>
          )}
          <button
            onClick={(e) => { e.preventDefault(); refresh(); }}
            className="text-muted-foreground hover:text-foreground underline underline-offset-2 text-[11px] block pt-0.5"
          >
            Refresh
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
