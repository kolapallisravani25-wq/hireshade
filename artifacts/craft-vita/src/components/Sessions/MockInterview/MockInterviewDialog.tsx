import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Square, Play, MessageSquareText } from "lucide-react";
import { MockInterviewLoop } from "@/features/mockInterview/interviewLoop";
import {
  createMockAsr,
  createMockInterviewer,
  createMockTts,
} from "@/features/mockInterview/mockAdapters";
import type {
  InterviewTurn,
  MockInterviewEndReason,
  MockInterviewState,
} from "@/features/mockInterview/types";

interface MockInterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AskedQuestion {
  text: string;
  isFollowUp: boolean;
}

/**
 * Minimal mock-interview UI entry point (G-022).
 *
 * Runs the real turn loop (question → TTS → wait → evaluate → follow-up) with
 * deterministic MOCK TTS/ASR adapters: answers are typed in this dialog because
 * no realtime voice adapter is implemented yet. This is explicitly labelled in
 * the UI so it is not mistaken for the target's OpenAI Realtime voice mode.
 */
export function MockInterviewDialog({ open, onOpenChange }: MockInterviewDialogProps) {
  const loopRef = React.useRef<MockInterviewLoop | null>(null);
  const [state, setState] = React.useState<MockInterviewState>("idle");
  const [endReason, setEndReason] = React.useState<MockInterviewEndReason | null>(null);
  const [questions, setQuestions] = React.useState<AskedQuestion[]>([]);
  const [turns, setTurns] = React.useState<InterviewTurn[]>([]);
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const buildLoop = React.useCallback(() => {
    setState("idle");
    setEndReason(null);
    setQuestions([]);
    setTurns([]);
    setAnswer("");
    setError(null);
    const loop = new MockInterviewLoop({
      interviewer: createMockInterviewer(),
      tts: createMockTts(),
      asr: createMockAsr([]),
      config: { maxQuestions: 4, maxFollowUpsPerQuestion: 1 },
      onStateChange: (next) => setState(next),
      onQuestion: (question) =>
        setQuestions((previous) => [
          ...previous,
          { text: question.text, isFollowUp: question.isFollowUp },
        ]),
      onEvaluation: (turn) => setTurns((previous) => [...previous, turn]),
      onEnded: (reason) => setEndReason(reason),
    });
    loopRef.current = loop;
    return loop;
  }, []);

  React.useEffect(() => {
    if (open) buildLoop();
    // Tear down any in-flight loop when the dialog closes.
    return () => {
      void loopRef.current?.end("user_ended");
      loopRef.current = null;
    };
  }, [open, buildLoop]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleStart = () =>
    run(async () => {
      const loop = loopRef.current ?? buildLoop();
      if (loop.state === "idle") await loop.start();
    });

  const handleSubmit = () =>
    run(async () => {
      const loop = loopRef.current;
      if (!loop || loop.state !== "listening") return;
      await loop.answer(answer);
      setAnswer("");
    });

  const handleEnd = () =>
    run(async () => {
      await loopRef.current?.end("user_ended");
    });

  const isListening = state === "listening";
  const isFinished = state === "completed" || state === "ended";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            Mock Interview (practice)
          </DialogTitle>
          <DialogDescription>
            Local mock interviewer — questions are generated and evaluated by a
            deterministic adapter; answers are typed. Real OpenAI Realtime voice
            is not implemented yet.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleStart}
            disabled={busy || state !== "idle"}
            className="gap-2"
          >
            <Play className="h-4 w-4" />
            Start
          </Button>
          <Button
            variant="outline"
            onClick={handleEnd}
            disabled={busy || isFinished || state === "idle"}
            className="gap-2"
          >
            <Square className="h-4 w-4" />
            End
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            state: <span className="font-mono">{state}</span>
            {endReason ? ` (${endReason})` : ""}
          </span>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          {questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Press Start to begin. The interviewer asks a generated question, waits
              for your answer, then evaluates it and follows up when needed.
            </p>
          ) : null}
          {questions.map((question, index) => {
            const turn = turns.find(
              (candidate) =>
                candidate.question === question.text &&
                candidate.isFollowUp === question.isFollowUp,
            );
            return (
              <div
                key={`${question.text}-${index}`}
                className="rounded-xl border border-border/60 p-3 space-y-1.5"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {question.isFollowUp ? "Follow-up" : `Question ${index + 1}`}
                </p>
                <p className="text-sm font-medium">{question.text}</p>
                {turn ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Your answer: {turn.answer}
                    </p>
                    <p className="text-xs">
                      Score {turn.evaluation.score.toFixed(2)} ·{" "}
                      <span className="font-semibold">{turn.evaluation.verdict}</span>
                      {turn.evaluation.improvements.length > 0
                        ? ` · ${turn.evaluation.improvements.join("; ")}`
                        : ""}
                    </p>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <label htmlFor="mock-interview-answer" className="text-sm font-semibold">
            Your answer
          </label>
          <Textarea
            id="mock-interview-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={!isListening}
            placeholder={
              isListening
                ? "Type your answer as if you were speaking it in the interview…"
                : isFinished
                  ? "Interview finished."
                  : "Start the interview first."
            }
            className="min-h-24 rounded-xl"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Mic className="h-3.5 w-3.5" />
              Mock ASR: typed answers only (no microphone)
            </span>
            <Button onClick={handleSubmit} disabled={busy || !isListening}>
              Submit answer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
