import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface HoverTooltipProps {
  text: string;
  children: React.ReactNode;
  side?: "bottom" | "top";
  className?: string;
}

export function HoverTooltip({
  text,
  children,
  side = "bottom",
}: HoverTooltipProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent
          side={side}
          className="z-[10000] bg-zinc-900 text-white border-zinc-800 text-[11px] px-3 py-1.5 rounded-xl max-w-[260px] text-center"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

