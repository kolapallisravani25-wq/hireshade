/**
 * Demo pipeline event vocabulary (G-004/G-005).
 *
 * One stream of timestamped events feeds both the latency metrics and the
 * overlay renderer, so what is measured is exactly what the user sees.
 */
export type DemoStreamId = "mic" | "screen";

export type DemoEventType =
  | "session.start"
  | "stream.start"
  | "vad.segment"
  | "asr.partial"
  | "asr.final"
  | "asr.end_of_utterance"
  | "question.detected"
  | "question.ignored"
  | "prompt.built"
  | "answer.first_token"
  | "answer.delta"
  | "answer.final"
  | "answer.error"
  | "session.end";

export interface DemoEvent {
  type: DemoEventType;
  /** Wall clock (ms) since session start. */
  atMs: number;
  /** Media position (ms) in the audio timeline. */
  mediaMs: number;
  stream: DemoStreamId | null;
  data: Record<string, unknown>;
}

export type DemoEmit = (event: DemoEvent) => void;
