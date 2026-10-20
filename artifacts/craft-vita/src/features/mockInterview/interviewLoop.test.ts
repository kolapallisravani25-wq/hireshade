import { describe, expect, it, vi } from "vitest";
import { MockInterviewLoop } from "./interviewLoop";
import {
  createMockAsr,
  createMockInterviewer,
  createMockTts,
} from "./mockAdapters";
import { REALTIME_VOICE_IMPLEMENTED } from "./types";

const STRONG_ANSWER =
  "I built a rate limiter with a Redis token bucket, handled edge cases like clock skew, and kept latency low; I measured throughput and designed the rollback plan.";

function makeLoop(overrides: Partial<ConstructorParameters<typeof MockInterviewLoop>[0]> = {}) {
  const tts = createMockTts();
  const asr = createMockAsr([]);
  const interviewer = createMockInterviewer();
  const loop = new MockInterviewLoop({
    interviewer,
    tts,
    asr,
    ...overrides,
  });
  return { loop, tts, asr, interviewer };
}

describe("mock interview turn loop", () => {
  it("asks the first question via TTS and waits for an answer", async () => {
    const { loop, tts } = makeLoop();
    expect(loop.state).toBe("idle");
    const question = await loop.start();
    expect(question).toBe("Tell me about yourself and your most recent role.");
    expect(tts.spoken).toEqual([question]);
    expect(loop.state).toBe("listening");
    expect(loop.currentQuestion).toEqual({
      index: 1,
      text: question,
      isFollowUp: false,
    });
  });

  it("evaluates a strong answer and advances to the next question", async () => {
    const { loop, tts } = makeLoop({ config: { maxQuestions: 2 } });
    await loop.start();
    const turn = await loop.answer(STRONG_ANSWER);
    expect(turn?.evaluation.verdict).toBe("strong");
    expect(loop.turns).toHaveLength(1);
    expect(tts.spoken).toHaveLength(2);
    expect(loop.currentQuestion?.index).toBe(2);
    expect(loop.currentQuestion?.isFollowUp).toBe(false);
    expect(loop.state).toBe("listening");
  });

  it("asks a follow-up for a weak answer before advancing", async () => {
    const { loop, tts } = makeLoop({ config: { maxQuestions: 3 } });
    await loop.start();
    const turn = await loop.answer("Not sure.");
    expect(turn?.evaluation.verdict).toBe("weak");
    expect(turn?.evaluation.needsFollowUp).toBe(true);
    expect(loop.currentQuestion).toEqual({
      index: 1,
      text: "Can you go a bit deeper into the technical details?",
      isFollowUp: true,
    });
    expect(tts.spoken.at(-1)).toBe("Can you go a bit deeper into the technical details?");
    expect(loop.state).toBe("listening");

    // A strong follow-up answer finishes question 1 and moves on to question 2.
    const followUpTurn = await loop.answer(STRONG_ANSWER);
    expect(followUpTurn?.isFollowUp).toBe(true);
    expect(loop.currentQuestion?.index).toBe(2);
    expect(loop.currentQuestion?.isFollowUp).toBe(false);
  });

  it("caps follow-ups per question", async () => {
    const { loop } = makeLoop({
      config: { maxQuestions: 3, maxFollowUpsPerQuestion: 1 },
    });
    await loop.start();
    await loop.answer("Weak.");
    expect(loop.currentQuestion?.isFollowUp).toBe(true);
    // The second weak answer exhausts the follow-up budget and advances.
    await loop.answer("Still weak.");
    expect(loop.currentQuestion?.index).toBe(2);
    expect(loop.currentQuestion?.isFollowUp).toBe(false);
  });

  it("completes after maxQuestions with an end reason and full transcript", async () => {
    const reasons: string[] = [];
    const { loop } = makeLoop({
      config: { maxQuestions: 2 },
      onEnded: (reason) => reasons.push(reason),
    });
    await loop.start();
    await loop.answer(STRONG_ANSWER);
    const lastTurn = await loop.answer(STRONG_ANSWER);
    expect(lastTurn).not.toBeNull();
    expect(loop.state).toBe("completed");
    expect(loop.endReason).toBe("max_questions");
    expect(reasons).toEqual(["max_questions"]);
    expect(loop.turns.map((turn) => turn.questionIndex)).toEqual([1, 2]);
    expect(await loop.answer(STRONG_ANSWER)).toBeNull();
  });

  it("ends after repeated empty answers instead of evaluating them", async () => {
    const reasons: string[] = [];
    const { loop } = makeLoop({
      config: { maxConsecutiveEmptyAnswers: 2 },
      onEnded: (reason) => reasons.push(reason),
    });
    await loop.start();
    expect(await loop.answer("")).toBeNull();
    expect(loop.state).toBe("listening");
    expect(await loop.answer("   ")).toBeNull();
    expect(loop.state).toBe("ended");
    expect(loop.endReason).toBe("empty_answers");
    expect(loop.turns).toHaveLength(0);
    expect(reasons).toEqual(["empty_answers"]);
  });

  it("uses the ASR adapter when no typed answer is supplied", async () => {
    const asr = createMockAsr([STRONG_ANSWER]);
    const { loop } = makeLoop({ asr, config: { maxQuestions: 2 } });
    await loop.start();
    const turn = await loop.answer();
    expect(asr.calls).toBe(1);
    expect(turn?.answer).toBe(STRONG_ANSWER);
    expect(turn?.evaluation.verdict).toBe("strong");
  });

  it("fails closed when the ASR adapter throws", async () => {
    const asr = {
      listen: async () => {
        throw new Error("mic unplugged");
      },
    };
    const { loop } = makeLoop({ asr });
    await loop.start();
    expect(await loop.answer()).toBeNull();
    expect(loop.state).toBe("ended");
    expect(loop.endReason).toBe("error");
  });

  it("fails closed when TTS cannot speak", async () => {
    const tts = createMockTts({ failOnSpeak: new Error("voice unavailable") });
    const { loop } = makeLoop({ tts });
    expect(await loop.start()).toBeNull();
    expect(loop.state).toBe("ended");
    expect(loop.endReason).toBe("error");
  });

  it("can be ended by the user and ignores later answers", async () => {
    const reasons: string[] = [];
    const { loop, tts } = makeLoop({ onEnded: (reason) => reasons.push(reason) });
    await loop.start();
    await loop.end();
    expect(loop.state).toBe("ended");
    expect(loop.endReason).toBe("user_ended");
    expect(reasons).toEqual(["user_ended"]);
    expect(await loop.answer(STRONG_ANSWER)).toBeNull();
    expect(loop.turns).toHaveLength(0);
    expect(typeof tts.cancel).toBe("function");
  });

  it("emits state/question/evaluation callbacks in order", async () => {
    const states: string[] = [];
    const questions: number[] = [];
    const evaluations: number[] = [];
    const { loop } = makeLoop({
      config: { maxQuestions: 1 },
      onStateChange: (state) => states.push(state),
      onQuestion: (question) => questions.push(question.questionIndex),
      onEvaluation: (turn) => evaluations.push(turn.questionIndex),
    });
    await loop.start();
    await loop.answer(STRONG_ANSWER);
    expect(questions).toEqual([1]);
    expect(evaluations).toEqual([1]);
    expect(states).toEqual([
      "asking",
      "listening",
      "evaluating",
      "completed",
    ]);
  });

  it("does not swallow a throwing UI callback", async () => {
    const { loop } = makeLoop({
      config: { maxQuestions: 1 },
      onStateChange: () => {
        throw new Error("render failed");
      },
    });
    await expect(loop.start()).resolves.not.toBeNull();
    await expect(loop.answer(STRONG_ANSWER)).resolves.not.toBeNull();
    expect(loop.state).toBe("completed");
  });

  it("does not claim realtime voice support", () => {
    expect(REALTIME_VOICE_IMPLEMENTED).toBe(false);
  });

  it("is deterministic across runs", async () => {
    async function run() {
      const { loop } = makeLoop({ config: { maxQuestions: 2 } });
      await loop.start();
      await loop.answer(STRONG_ANSWER);
      await loop.answer("Weak answer.");
      return {
        state: loop.state,
        turns: loop.turns.map((turn) => ({
          q: turn.question,
          verdict: turn.evaluation.verdict,
        })),
        current: loop.currentQuestion,
      };
    }
    expect(await run()).toEqual(await run());
  });
});
