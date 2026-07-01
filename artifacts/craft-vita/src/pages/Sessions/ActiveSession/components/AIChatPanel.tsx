import { Message } from "../Transcript";
import { ChatHeader } from "./ChatHeader";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import { ChatActionButtons } from "./ChatActionButtons";
import { cn } from "@/lib/utils";

interface AIChatPanelProps {
  messages: Message[];
  inputMessage: string;
  onInputChange: (value: string) => void;
  isAnalyzing: boolean;
  isAnswering: boolean;
  canAnswer: boolean;
  canAnalyze: boolean;
  onAiAnswer: () => void;
  onAnalyzeScreen: () => void;
  onExit: () => void;
  onSend?: () => void;
  onRegenerate?: (messageId: string) => void;
  onMessageInteract?: (messageId: string) => void;
  isFullscreen?: boolean;
  isFreeSession?: boolean;
  isWarning?: boolean;
  timerText?: string | null;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export const AIChatPanel = ({
  messages,
  inputMessage,
  onInputChange,
  isAnalyzing,
  isAnswering,
  canAnswer,
  canAnalyze,
  onAiAnswer,
  onAnalyzeScreen,
  onExit,
  onSend,
  onRegenerate,
  onMessageInteract,
  isFullscreen = false,
  isFreeSession = false,
  isWarning = false,
  timerText = null,
  selectedModel,
  onModelChange,
}: AIChatPanelProps) => {
  const isGenerationBusy = isAnalyzing || isAnswering;

  return (
    <div className={cn(
        "h-full flex flex-col overflow-hidden relative transition-all duration-300", 
        isFullscreen ? "bg-transparent" : "bg-white"
    )}>
      <ChatHeader 
        onExit={onExit} 
        isFullscreen={isFullscreen} 
        isFreeSession={isFreeSession}
        isWarning={isWarning}
        timerText={timerText} 
        selectedModel={selectedModel}
        onModelChange={onModelChange}
      />

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <ChatMessageList
          messages={messages}
          isStreaming={isGenerationBusy}
          isFullscreen={isFullscreen}
          onRegenerate={onRegenerate}
          onMessageInteract={onMessageInteract}
          disableRegenerate={isGenerationBusy}
        />
      </div>

      <div className={cn(
        "p-6 pt-2 border-t border-white/10 shrink-0", 
        isFullscreen ? "bg-transparent drop-shadow-xl" : "bg-white border-slate-200/50"
      )}>
        <ChatInput 
          value={inputMessage} 
          onChange={onInputChange} 
          onSend={onSend}
          isFullscreen={isFullscreen} 
          disabled={isGenerationBusy}
        />
        <ChatActionButtons
          onAiAnswer={onAiAnswer}
          onAnalyzeScreen={onAnalyzeScreen}
          isAnswering={isAnswering}
          isAnalyzing={isAnalyzing}
          canAnswer={canAnswer}
          canAnalyze={canAnalyze}
          isFullscreen={isFullscreen}
        />
      </div>
    </div>
  );
};
