import { useState } from "react";
import { cn } from "@/lib/utils";
import { TranscriptHeader } from "./components/TranscriptHeader";
import { TranscriptMessageList } from "./components/TranscriptMessageList";
import type { QuestionMeta } from "@/types/ai-answer";

export interface Message {
  id: string;
  sender: "User" | "Interviewer" | "AI";
  text: string;
  time: string;
  /**
   * When an AI answer fails, the specific, safe user-facing reason (Issue 3).
   * Non-null marks the card as an error state so the UI can show an Error badge
   * + Retry. Null/undefined = normal answer.
   */
  error?: string | null;
  timestamp?: number;
  question?: string;
  questionMeta?: QuestionMeta;
  snapshotId?: string;
  originalText?: string;
  patchedText?: string;
  patchedAt?: number;
  patchedByUser?: boolean;
  originalGenerationContext?: {
    originalQuestion?: string;
    originalTranscript?: string;
    currentQuestion?: string;
    recentTranscriptWindow?: string[];
    speakerSeparatedTranscript?: {
      speakerType: "interviewer" | "candidate" | "assistant" | "system";
      content: string;
      timestamp?: number;
    }[];
    previousAiAnswers?: {
      question?: string;
      answer: string;
      codeBlocks?: string[];
    }[];
    latestAnswerId?: string;
    latestAnswerQuestion?: string;
    latestAnswerText?: string;
    latestAnswerTopic?: string;
    selectedAnswerId?: string;
    selectedAnswerQuestion?: string;
    selectedAnswerText?: string;
    selectedAnswerCodeBlocks?: string[];
    selectedAnswerTopic?: string;
    requestId?: string;
    answerClickMode?:
      | "answer_latest_unanswered"
      | "answer_selected_intent"
      | "reanswer_previous"
      | "regenerate_answer"
      | "answer_followup";
    answerMode?:
      | "auto"
      | "theory_only"
      | "minimal_code"
      | "code_required"
      | "explain_existing_code"
      | "system_design";
    sourcePlatform?: "web" | "tauri";
    activeInterviewMode?: string;
    manualQueryType?: "full_question" | "short_followup" | "command" | "unknown";
    generatedAnswerText?: string;
    generatedCodeBlocks?: string[];
  };
}

interface TranscriptProps {
  messages: Message[];
  micInterimTranscript: string;
  isMicTranscribing: boolean;
  tabInterimTranscript: string;
  isTabTranscribing: boolean;
  isConnecting?: boolean;
  error?: string | null;
  onToggleMic: () => void;
  onClear: () => void;
  isFullscreen?: boolean;
  onMinimize?: () => void;
  onChangeTab?: () => void;
  onOpenOverlay?: () => void;
  currentMicDevice?: string;
  onPatchMessage?: (messageId: string, patchedText: string) => void;
  highlightKeywords?: string[];
}

export const Transcript = ({
  messages,
  micInterimTranscript,
  isMicTranscribing,
  tabInterimTranscript,
  isTabTranscribing,
  isConnecting,
  error,
  onToggleMic,
  onClear,
  isFullscreen = false,
  onMinimize,
  onChangeTab,
  onOpenOverlay,
  currentMicDevice,
  onPatchMessage,
  highlightKeywords = [],
}: TranscriptProps) => {
  const [autoScroll, setAutoScroll] = useState(true);

  return (
    <div
      className={cn(
        "flex-1 flex flex-col overflow-hidden transition-all duration-300",
        isFullscreen ? "bg-transparent" : "bg-white",
      )}
    >
      <TranscriptHeader
        isConnecting={isConnecting}
        isTabTranscribing={isTabTranscribing}
        isMicTranscribing={isMicTranscribing}
        currentMicDevice={currentMicDevice}
        error={error}
        onToggleMic={onToggleMic}
        onClear={onClear}
        onOpenOverlay={onOpenOverlay}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        isFullscreen={isFullscreen}
        onMinimize={onMinimize}
        onChangeTab={onChangeTab}
      />

      <TranscriptMessageList
        messages={messages}
        micInterim={micInterimTranscript}
        tabInterim={tabInterimTranscript}
        isFullscreen={isFullscreen}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
        highlightKeywords={highlightKeywords}
        onPatchMessage={onPatchMessage}
      />
    </div>
  );
};
