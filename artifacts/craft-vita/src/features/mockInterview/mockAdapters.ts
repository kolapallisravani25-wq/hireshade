/**
 * Deterministic mock adapters for the mock-interview loop (G-022).
 * No network, no audio devices: tests and the demo UI drive them directly.
 */
import type {
  InterviewAsrAdapter,
  InterviewEvaluation,
  InterviewerAdapter,
  InterviewerContext,
  InterviewTtsAdapter,
} from "./types";

export interface MockTtsOptions {
  /** When set, speak() rejects (used to test the guarded error path). */
  failOnSpeak?: Error;
}

export interface MockTtsAdapter extends InterviewTtsAdapter {
  readonly spoken: string[];
}

export function createMockTts(options: MockTtsOptions = {}): MockTtsAdapter {
  const spoken: string[] = [];
  let cancelled = false;
  return {
    spoken,
    async speak(text: string) {
      if (cancelled) throw new Error("MockTts: cancelled");
      if (options.failOnSpeak) throw options.failOnSpeak;
      spoken.push(text);
    },
    async cancel() {
      cancelled = true;
    },
  };
}

export interface MockAsrAdapter extends InterviewAsrAdapter {
  readonly calls: number;
}

/** Scripted ASR: each listen() returns the next queued answer. */
export function createMockAsr(answers: readonly string[] = []): MockAsrAdapter {
  const queue = [...answers];
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async listen() {
      calls += 1;
      return queue.shift() ?? "";
    },
  };
}

export const DEFAULT_MOCK_QUESTIONS: readonly string[] = [
  "Tell me about yourself and your most recent role.",
  "What is the most complex system you have built, and what made it hard?",
  "Describe a time you handled a production incident.",
  "How would you design a rate limiter for a public API?",
  "Why are you interested in this role?",
];

export interface MockInterviewerOptions {
  questions?: readonly string[];
  followUps?: readonly string[];
  /** Minimum answer length for a "strong" verdict. Default 40 chars. */
  strongAnswerChars?: number;
}

/**
 * Heuristic interviewer: cycles a question bank, scores answers by length and
 * technical keywords, and asks a follow-up on weak answers. Deterministic so
 * loop tests can assert exact turns.
 */
export function createMockInterviewer(
  options: MockInterviewerOptions = {},
): InterviewerAdapter {
  const questions = options.questions ?? DEFAULT_MOCK_QUESTIONS;
  const followUps = options.followUps ?? [
    "Can you go a bit deeper into the technical details?",
    "What trade-offs did you make there?",
  ];
  const strongAnswerChars = options.strongAnswerChars ?? 40;
  let followUpIndex = 0;

  const buildContext = (context: InterviewerContext) => context;

  return {
    async generateQuestion(context) {
      buildContext(context);
      const index = Math.max(0, context.turnIndex - 1);
      return questions[index % questions.length] ?? "Tell me about your background.";
    },
    async evaluateAnswer({ answer }) {
      const normalized = answer.trim();
      const technical = /\b(complexity|o\(|trade-?off|edge case|index|queue|cache|latency|throughput|scal|migrat|debug|incident|rollback|test|design|api|database|system)\b/i.test(
        normalized,
      );
      const longEnough = normalized.length >= strongAnswerChars;
      const hasNumbers = /\d/.test(normalized);
      const score = Math.min(
        1,
        (longEnough ? 0.5 : 0.2) + (technical ? 0.35 : 0) + (hasNumbers ? 0.1 : 0),
      );
      const verdict: InterviewEvaluation["verdict"] =
        score >= 0.75 ? "strong" : score >= 0.45 ? "partial" : "weak";
      return {
        score: Math.round(score * 100) / 100,
        verdict,
        strengths: longEnough ? ["Gave a complete answer"] : [],
        improvements: technical ? [] : ["Add more technical specifics"],
        needsFollowUp: verdict !== "strong",
      };
    },
    async generateFollowUp() {
      const question = followUps[followUpIndex % followUps.length]!;
      followUpIndex += 1;
      return question;
    },
  };
}
