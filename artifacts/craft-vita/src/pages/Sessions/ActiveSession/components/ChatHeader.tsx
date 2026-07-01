import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionTimer } from "./SessionTimer";
import { ModelSelector } from "./ModelSelector";

interface ChatHeaderProps {
  onExit: () => void;
  title?: string;
  isFullscreen?: boolean;
  isFreeSession?: boolean;
  isWarning?: boolean;
  timerText?: string | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export const ChatHeader = ({
  onExit,
  title = "HireShade",
  isFullscreen = false,
  isFreeSession = false,
  isWarning = false,
  timerText = null,
  selectedModel,
  onModelChange,
}: ChatHeaderProps) => {
  return (
    <header
      className={cn(
        "h-16 border-b flex items-center justify-between px-6 shrink-0 transition-colors duration-300",
        isFullscreen
          ? "bg-transparent border-white/10 drop-shadow-lg"
          : "bg-transparent border-slate-200/50",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-xl font-bold tracking-tight",
              isFullscreen
                ? "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                : "text-slate-800",
            )}
          >
            {title}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <ModelSelector
          value={selectedModel}
          onChange={onModelChange}
          isFullscreen={isFullscreen}
        />

        <SessionTimer
          timerText={timerText}
          isFreeSession={isFreeSession}
          isWarning={isWarning}
          isFullscreen={isFullscreen}
        />

        <div className="flex items-center gap-2">
          <Button
            onClick={onExit}
            className="bg-red-500 hover:bg-red-600 text-white px-6 rounded-xl font-bold h-10 shadow-[0_4px_12px_rgba(239,68,68,0.2)] border-none transition-all active:scale-95"
          >
            Exit
          </Button>
        </div>
      </div>
    </header>
  );
};

// function BotIcon(props: any) {
//   return (
//     <svg
//       {...props}
//       xmlns="http://www.w3.org/2000/svg"
//       width="24"
//       height="24"
//       viewBox="0 0 24 24"
//       fill="none"
//       stroke="currentColor"
//       strokeWidth="2"
//       strokeLinecap="round"
//       strokeLinejoin="round"
//     >
//       <path d="M12 8V4H8" />
//       <rect width="16" height="12" x="4" y="8" rx="2" />
//       <path d="M2 14h2" />
//       <path d="M20 14h2" />
//       <path d="M15 13v2" />
//       <path d="M9 13v2" />
//     </svg>
//   );
// }
