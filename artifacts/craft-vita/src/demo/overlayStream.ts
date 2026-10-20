/**
 * Overlay event-stream reducer (G-005).
 *
 * Converts the pipeline's timestamped events into cumulative overlay frames.
 * The overlay HTML replays these frames at their recorded offsets, so the DOM
 * proof renders exactly the measured stream (no second implementation).
 */
import type { DemoEvent } from "./events.js";

export type OverlayStatus = "listening" | "question" | "streaming" | "complete";

export interface OverlayFrame {
  atMs: number;
  /** Latest screen-share partial transcript (grey preview). */
  partial: string;
  /** Latest microphone partial transcript (candidate channel). */
  micPartial: string;
  /** Detected interviewer question. */
  question: string;
  /** Cumulative streamed answer text. */
  answer: string;
  status: OverlayStatus;
  answerComplete: boolean;
  questionAtMs: number | null;
  firstTokenAtMs: number | null;
  completeAtMs: number | null;
  model: string;
}

export interface OverlayReplay {
  frames: OverlayFrame[];
  meta: {
    sessionId: string;
    questionCount: number;
    answerChars: number;
    answerVisibleMs: number | null;
  };
}

function frameKey(state: OverlayFrame): string {
  return [state.partial, state.micPartial, state.question, state.answer, state.status, state.model].join("\u0000");
}

export function buildOverlayFrames(events: DemoEvent[]): OverlayFrame[] {
  let state: OverlayFrame = {
    atMs: 0,
    partial: "",
    micPartial: "",
    question: "",
    answer: "",
    status: "listening",
    answerComplete: false,
    questionAtMs: null,
    firstTokenAtMs: null,
    completeAtMs: null,
    model: "",
  };
  const frames: OverlayFrame[] = [{ ...state }];
  let previousKey = frameKey(state);

  // Defensive stable sort: answer deltas are emitted from async callbacks, so a
  // recorder that appends to a shared log may not be perfectly ordered.
  const ordered = [...events].sort((a, b) => a.atMs - b.atMs);
  for (const event of ordered) {
    let changed = false;
    switch (event.type) {
      case "asr.partial": {
        const text = String(event.data["text"] ?? "");
        if (event.stream === "mic") state.micPartial = text;
        else state.partial = text;
        changed = true;
        break;
      }
      case "question.detected": {
        state.question = String(event.data["question"] ?? "");
        state.partial = "";
        state.status = "question";
        state.questionAtMs = event.atMs;
        state.model = String(event.data["model"] ?? state.model);
        changed = true;
        break;
      }
      case "answer.first_token": {
        state.status = "streaming";
        state.firstTokenAtMs = event.atMs;
        state.model = String(event.data["model"] ?? state.model);
        changed = true;
        break;
      }
      case "answer.delta": {
        state.answer += String(event.data["text"] ?? "");
        changed = true;
        break;
      }
      case "answer.final": {
        if (typeof event.data["answer"] === "string") state.answer = event.data["answer"];
        state.status = "complete";
        state.answerComplete = true;
        state.completeAtMs = event.atMs;
        changed = true;
        break;
      }
      case "asr.final": {
        if (event.stream === "screen") state.partial = "";
        if (event.stream === "mic") state.micPartial = "";
        changed = true;
        break;
      }
      default:
        break;
    }
    if (!changed) continue;
    const key = frameKey(state);
    if (key === previousKey) continue;
    previousKey = key;
    state = { ...state, atMs: event.atMs };
    frames.push({ ...state });
  }

  return frames;
}

export function buildOverlayReplay(sessionId: string, events: DemoEvent[]): OverlayReplay {
  const frames = buildOverlayFrames(events);
  const last = frames[frames.length - 1]!;
  return {
    frames,
    meta: {
      sessionId,
      questionCount: events.filter((e) => e.type === "question.detected").length,
      answerChars: last.answer.length,
      answerVisibleMs:
        last.questionAtMs !== null && last.completeAtMs !== null
          ? last.completeAtMs - last.questionAtMs
          : null,
    },
  };
}
