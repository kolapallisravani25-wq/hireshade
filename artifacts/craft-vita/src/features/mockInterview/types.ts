/**
 * Mock-interview turn-loop contracts (G-022).
 *
 * The target uses OpenAI Realtime (WebRTC) for the interviewer voice; that is
 * NOT implemented here and this module must not claim it. Instead the loop is
 * adapter-driven: TTS, ASR and the interviewer LLM are narrow injectable
 * interfaces, so the shipped UI runs a fully local mock loop and a real
 * OpenAI-Realtime adapter can be dropped in later.
 *
 * `OPENAI_REALTIME_ADAPTER` below documents the FUTURE real adapter shape.
 * `REALTIME_VOICE_IMPLEMENTED` is deliberately false.
 */

export type MockInterviewState =
  | "idle"
  | "asking"
  | "listening"
  | "evaluating"
  | "completed"
  | "ended";

export type MockInterviewEndReason =
  | "max_questions"
  | "user_ended"
  | "empty_answers"
  | "max_follow_ups"
  | "error";

export type EvaluationVerdict = "strong" | "partial" | "weak";

export interface InterviewEvaluation {
  /** 0..1 heuristic/rubric score. */
  score: number;
  verdict: EvaluationVerdict;
  strengths: string[];
  improvements: string[];
  /** True when the interviewer should probe deeper before moving on. */
  needsFollowUp: boolean;
}

export interface InterviewerContext {
  question: string;
  previousQuestions: readonly string[];
  turnIndex: number;
}

export interface InterviewerAdapter {
  /** Generates the next interview question (or follow-up when asked). */
  generateQuestion(context: InterviewerContext): Promise<string>;
  /** Evaluates the candidate's answer. */
  evaluateAnswer(input: {
    question: string;
    answer: string;
    context: InterviewerContext;
  }): Promise<InterviewEvaluation>;
  /** Optional: generate a follow-up probe for a weak answer. */
  generateFollowUp?(input: {
    question: string;
    answer: string;
    evaluation: InterviewEvaluation;
    context: InterviewerContext;
  }): Promise<string>;
}

/** Text-to-speech adapter. `speak` resolves when playback finishes. */
export interface InterviewTtsAdapter {
  speak(text: string): Promise<void>;
  cancel(): Promise<void>;
}

/** Speech-to-text adapter. Resolves with the candidate's transcribed answer. */
export interface InterviewAsrAdapter {
  listen(): Promise<string>;
}

export interface MockInterviewConfig {
  /** Total questions before the interview completes. Default 5. */
  maxQuestions?: number;
  /** Max follow-up probes per question. Default 2. */
  maxFollowUpsPerQuestion?: number;
  /** Answers shorter than this count as empty. Default 3 chars. */
  minAnswerChars?: number;
  /** Consecutive empty answers before ending. Default 2. */
  maxConsecutiveEmptyAnswers?: number;
}

export interface InterviewTurn {
  questionIndex: number;
  question: string;
  isFollowUp: boolean;
  answer: string;
  evaluation: InterviewEvaluation;
}

/**
 * FUTURE real adapter (documented only): OpenAI Realtime over WebRTC.
 * A real implementation needs: ephemeral session token from the API, an
 * RTCPeerConnection with a recvonly audio track, a data channel for transcript
 * events, mic capture via getUserMedia, and audio playback of the remote track.
 * None of that is implemented — the shipped mock interview uses the TTS/ASR
 * adapters in this module.
 */
export interface OpenAiRealtimeVoiceAdapter {
  connect(): Promise<void>;
  sendAudio(chunk: ArrayBuffer): void;
  onAudio(callback: (chunk: ArrayBuffer) => void): void;
  onTranscript(callback: (text: string, final: boolean) => void): void;
  close(): void;
}

/** Honest status flag consumed by docs/UI so nobody claims realtime voice. */
export const REALTIME_VOICE_IMPLEMENTED = false;
