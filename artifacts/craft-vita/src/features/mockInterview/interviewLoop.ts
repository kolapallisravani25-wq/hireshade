/**
 * Mock-interview turn-loop state machine (G-022).
 *
 * Real loop, mock voice: the interviewer asks a generated question through the
 * TTS adapter, waits for the answer (ASR adapter, or a typed answer from the
 * UI), evaluates it, and either probes with a follow-up or advances. All
 * adapters are injected; the defaults used by the UI are deterministic mocks.
 *
 * States:
 *   idle ──start()──▶ asking ──▶ listening ──answer()──▶ evaluating
 *                                ▲                         │
 *                                └──── follow-up ◀────────┤ needsFollowUp
 *                                                          ▼
 *                                            asking (next q) / completed
 *   any state ──end()/empty-answer-limit/adapter error──▶ ended
 *
 * No network calls, no WebRTC: see types.ts for the documented-only OpenAI
 * Realtime adapter.
 */

import type {
  InterviewAsrAdapter,
  InterviewEvaluation,
  InterviewerAdapter,
  InterviewerContext,
  InterviewTtsAdapter,
  InterviewTurn,
  MockInterviewConfig,
  MockInterviewEndReason,
  MockInterviewState,
} from "./types";

export const DEFAULT_MOCK_INTERVIEW_CONFIG: Required<MockInterviewConfig> = {
  maxQuestions: 5,
  maxFollowUpsPerQuestion: 2,
  minAnswerChars: 3,
  maxConsecutiveEmptyAnswers: 2,
};

export interface MockInterviewLoopOptions {
  interviewer: InterviewerAdapter;
  tts: InterviewTtsAdapter;
  asr: InterviewAsrAdapter;
  config?: MockInterviewConfig;
  onStateChange?: (state: MockInterviewState) => void;
  onQuestion?: (question: {
    questionIndex: number;
    text: string;
    isFollowUp: boolean;
  }) => void;
  onEvaluation?: (turn: InterviewTurn) => void;
  onEnded?: (reason: MockInterviewEndReason, turns: readonly InterviewTurn[]) => void;
}

interface CurrentQuestion {
  questionIndex: number;
  text: string;
  isFollowUp: boolean;
  followUpCount: number;
}

function safeCall<T>(callback: ((value: T) => void) | undefined, value: T): void {
  try {
    callback?.(value);
  } catch {
    // UI callbacks must never break the interview loop.
  }
}

export class MockInterviewLoop {
  private readonly interviewer: InterviewerAdapter;
  private readonly tts: InterviewTtsAdapter;
  private readonly asr: InterviewAsrAdapter;
  private readonly config: Required<MockInterviewConfig>;
  private readonly onStateChange;
  private readonly onQuestion;
  private readonly onEvaluation;
  private readonly onEnded;
  private currentState: MockInterviewState = "idle";
  private current: CurrentQuestion | null = null;
  private transcript: InterviewTurn[] = [];
  private questionsCompleted = 0;
  private consecutiveEmptyAnswers = 0;
  private reason: MockInterviewEndReason | null = null;

  constructor(options: MockInterviewLoopOptions) {
    this.interviewer = options.interviewer;
    this.tts = options.tts;
    this.asr = options.asr;
    this.config = { ...DEFAULT_MOCK_INTERVIEW_CONFIG, ...(options.config ?? {}) };
    this.onStateChange = options.onStateChange;
    this.onQuestion = options.onQuestion;
    this.onEvaluation = options.onEvaluation;
    this.onEnded = options.onEnded;
  }

  get state(): MockInterviewState {
    return this.currentState;
  }

  get turns(): readonly InterviewTurn[] {
    return this.transcript;
  }

  get endReason(): MockInterviewEndReason | null {
    return this.reason;
  }

  get currentQuestion(): { index: number; text: string; isFollowUp: boolean } | null {
    if (!this.current) return null;
    return {
      index: this.current.questionIndex,
      text: this.current.text,
      isFollowUp: this.current.isFollowUp,
    };
  }

  private setState(state: MockInterviewState): void {
    this.currentState = state;
    safeCall(this.onStateChange, state);
  }

  private previousQuestions(): string[] {
    return this.transcript
      .filter((turn) => !turn.isFollowUp)
      .map((turn) => turn.question);
  }

  private context(): InterviewerContext {
    return {
      question: this.current?.text ?? "",
      previousQuestions: this.previousQuestions(),
      turnIndex: this.current?.questionIndex ?? this.questionsCompleted + 1,
    };
  }

  /** Starts the interview and asks the first question. */
  async start(): Promise<string | null> {
    if (this.currentState !== "idle") return null;
    this.questionsCompleted = 0;
    this.consecutiveEmptyAnswers = 0;
    this.current = {
      questionIndex: 1,
      text: "",
      isFollowUp: false,
      followUpCount: 0,
    };
    return this.ask(false);
  }

  private async ask(isFollowUp: boolean): Promise<string | null> {
    if (!this.current) return null;
    this.setState("asking");
    try {
      const question =
        isFollowUp && this.interviewer.generateFollowUp
          ? await this.interviewer.generateFollowUp({
              question: this.current.text,
              answer: this.transcript.at(-1)?.answer ?? "",
              evaluation:
                this.transcript.at(-1)?.evaluation ??
                ({
                  score: 0,
                  verdict: "weak",
                  strengths: [],
                  improvements: [],
                  needsFollowUp: true,
                } satisfies InterviewEvaluation),
              context: this.context(),
            })
          : await this.interviewer.generateQuestion(this.context());
      this.current.text = question;
      this.current.isFollowUp = isFollowUp;
      safeCall(this.onQuestion, {
        questionIndex: this.current.questionIndex,
        text: question,
        isFollowUp,
      });
      await this.tts.speak(question);
      this.setState("listening");
      return question;
    } catch {
      await this.end("error");
      return null;
    }
  }

  /**
   * Submits an answer (typed in the UI) or waits for the ASR adapter.
   * Returns the evaluated turn, or null when the loop is not listening / ended.
   */
  async answer(text?: string): Promise<InterviewTurn | null> {
    if (this.currentState !== "listening" || !this.current) return null;

    let answer = text;
    if (answer === undefined) {
      try {
        answer = await this.asr.listen();
      } catch {
        await this.end("error");
        return null;
      }
    }

    const trimmed = (answer ?? "").trim();
    if (trimmed.length < this.config.minAnswerChars) {
      this.consecutiveEmptyAnswers += 1;
      if (this.consecutiveEmptyAnswers >= this.config.maxConsecutiveEmptyAnswers) {
        await this.end("empty_answers");
      }
      return null;
    }
    this.consecutiveEmptyAnswers = 0;

    this.setState("evaluating");
    const questionSnapshot = { ...this.current };
    const context: InterviewerContext = {
      question: questionSnapshot.text,
      previousQuestions: this.previousQuestions(),
      turnIndex: questionSnapshot.questionIndex,
    };
    let evaluation: InterviewEvaluation;
    try {
      evaluation = await this.interviewer.evaluateAnswer({
        question: questionSnapshot.text,
        answer: trimmed,
        context,
      });
    } catch {
      await this.end("error");
      return null;
    }

    const turn: InterviewTurn = {
      questionIndex: questionSnapshot.questionIndex,
      question: questionSnapshot.text,
      isFollowUp: questionSnapshot.isFollowUp,
      answer: trimmed,
      evaluation,
    };
    this.transcript.push(turn);
    safeCall(this.onEvaluation, turn);

    const canFollowUp =
      evaluation.needsFollowUp &&
      !!this.interviewer.generateFollowUp &&
      questionSnapshot.followUpCount < this.config.maxFollowUpsPerQuestion;

    if (canFollowUp) {
      this.current = {
        ...questionSnapshot,
        followUpCount: questionSnapshot.followUpCount + 1,
      };
      await this.ask(true);
      return turn;
    }

    // Done with this question (either strong enough or follow-up budget spent).
    if (!questionSnapshot.isFollowUp) this.questionsCompleted += 1;
    // A follow-up answer also completes its parent question.
    if (questionSnapshot.isFollowUp) this.questionsCompleted += 1;

    if (this.questionsCompleted >= this.config.maxQuestions) {
      this.setState("completed");
      this.reason = "max_questions";
      try {
        this.onEnded?.("max_questions", this.transcript);
      } catch {
        // UI callbacks must never break the loop.
      }
      return turn;
    }

    this.current = {
      questionIndex: this.questionsCompleted + 1,
      text: "",
      isFollowUp: false,
      followUpCount: 0,
    };
    await this.ask(false);
    return turn;
  }

  /** Ends the interview (user pressed End, or an adapter failed). */
  async end(reason: MockInterviewEndReason = "user_ended"): Promise<void> {
    if (this.currentState === "completed" || this.currentState === "ended") return;
    try {
      await this.tts.cancel();
    } catch {
      // ignore teardown failures
    }
    this.setState("ended");
    this.reason = reason;
    try {
      this.onEnded?.(reason, this.transcript);
    } catch {
      // ignore
    }
  }
}
