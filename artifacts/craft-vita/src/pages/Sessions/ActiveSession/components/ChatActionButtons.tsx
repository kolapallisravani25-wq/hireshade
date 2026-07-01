import { AIAnswerButton } from "./AIAnswerButton";
import { AnalyzeScreenButton } from "./AnalyzeScreenButton";

interface ChatActionButtonsProps {
  onAiAnswer: () => void;
  onAnalyzeScreen: () => void;
  isAnswering: boolean;
  isAnalyzing: boolean;
  canAnswer?: boolean;
  canAnalyze?: boolean;
  isFullscreen?: boolean;
}

export const ChatActionButtons = ({
  onAiAnswer,
  onAnalyzeScreen,
  isAnswering,
  isAnalyzing,
  canAnswer,
  canAnalyze,
  isFullscreen = false,
}: ChatActionButtonsProps) => {
  return (
    <div className="flex gap-3">
      <AIAnswerButton
        onClick={onAiAnswer}
        disabled={!canAnswer || isAnswering}
        isLoading={isAnswering}
        isFullscreen={isFullscreen}
      />

      <AnalyzeScreenButton
        onClick={onAnalyzeScreen}
        disabled={!canAnalyze || isAnalyzing}
        isLoading={isAnalyzing}
        isFullscreen={isFullscreen}
      />
    </div>
  );
};
