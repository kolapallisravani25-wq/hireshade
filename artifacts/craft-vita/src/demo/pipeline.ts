/**
 * Keyless demo pipeline driver (G-004 / G-005 / G-014) — target-aligned.
 *
 * Fixture WAV (16 kHz mono)
 *   -> VAD + 700 ms endpointing, per audio source (mic + screen share, T-09)
 *   -> mock ASR (partials + finals + EndOfUtterance) fed as pcm_f32le
 *   -> real question detector (activeQuestionDetector.ts)
 *   -> real prompt builder (interviewPrompt.ts) from the T-11 session contract
 *   -> mock LLM stream (target per-model first-token table, T-10)
 *   -> timestamped overlay event stream (overlayStream.ts)
 *
 * It runs on the wall clock at 1x in the demo (speed is injectable for tests), so
 * the measured latencies are the same quantities the product promises.
 */
import { detectActiveQuestion } from "@/features/session/detection/activeQuestionDetector";
import type {
  AsrProvider,
  AsrStream,
  LlmProvider,
  TranscriptUtterance,
} from "../../../api-server/src/lib/mocks/types";
import {
  TARGET_SSE_HEADERS,
  TARGET_ASR_TRANSPORT,
  targetEndOfUtterance,
  toF32leBytes,
  type TargetSessionCreate,
} from "../../../api-server/src/lib/mocks/targetContracts";
import { DEFAULT_VAD_CONFIG, detectSpeechSegments, type VadConfig, type VadResult } from "./vad";
import type { PcmAudio } from "./wav";
import type { FixtureDef } from "./fixtures";
import type { DemoEmit, DemoEvent, DemoStreamId } from "./events";
import { buildDemoPromptInputs } from "./demoSession";
import type { LatencySample } from "./metrics";

export interface DemoClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: DemoClock = {
  now: () => performance.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

export interface PipelineStreamInput {
  stream: DemoStreamId;
  fixture: FixtureDef;
  audio: PcmAudio;
}

export interface DemoQuestionOutcome extends LatencySample {
  segmentId: string;
  confidenceScore: number;
  source: string;
  promptChars: number;
  answer: string;
}

export interface StreamFinalOutcome {
  segmentId: string;
  text: string;
  answerSuppressed: boolean;
  suppressionReason: string | null;
  detector: { question: string; ignoredNoise: boolean; confidenceScore: number } | null;
}

export interface PipelineStreamOutcome {
  stream: DemoStreamId;
  wavFile: string;
  role: string;
  durationMs: number;
  segments: {
    id: string;
    startMs: number;
    endMs: number;
    startSample: number;
    endSample: number;
  }[];
  partials: number;
  finals: StreamFinalOutcome[];
  bytesFed: number;
  /** Target wire encoding used for every audio frame pushed to ASR (T-09). */
  encoding: "pcm_f32le";
}

export interface DemoPipelineOptions {
  sessionId: string;
  sessionCreate: TargetSessionCreate;
  model: string;
  streams: PipelineStreamInput[];
  asr: AsrProvider;
  llm: LlmProvider;
  resumeContext?: string;
  clock?: DemoClock;
  /** 1 = real time; >1 accelerates tests. */
  speed?: number;
  tickMs?: number;
  vadConfig?: Partial<VadConfig>;
  /** Fail when the VAD segment count does not match the fixture script. */
  requireSegmentMatch?: boolean;
  onEvent?: (event: DemoEvent) => void;
  /** Wall-clock safety valve for tests. */
  maxWallMs?: number;
}

export interface DemoPipelineResult {
  sessionId: string;
  model: string;
  events: DemoEvent[];
  questions: DemoQuestionOutcome[];
  streams: PipelineStreamOutcome[];
  durationMs: number;
  prompt: string;
  answer: string;
  sessionCreate: TargetSessionCreate;
}

interface SegmentMeta {
  segmentId: string;
  startWall: number | null;
  endWall: number | null;
  firstPartialWall: number | null;
  partials: number;
  finalText: string | null;
}

interface StreamRuntime {
  input: PipelineStreamInput;
  vad: VadResult;
  asrStream: AsrStream;
  segments: TranscriptUtterance[];
  segmentMeta: Map<string, SegmentMeta>;
  outcome: PipelineStreamOutcome;
}

interface TranscriptEntry {
  sender: "User" | "Interviewer";
  text: string;
  timestamp: number;
}

export async function runDemoPipeline(opts: DemoPipelineOptions): Promise<DemoPipelineResult> {
  const clock = opts.clock ?? realClock;
  const speed = opts.speed ?? 1;
  const tickMs = opts.tickMs ?? 10;
  const maxWallMs = opts.maxWallMs ?? 60_000;
  if (speed <= 0) throw new Error("runDemoPipeline: speed must be > 0");
  if (!opts.streams.length) throw new Error("runDemoPipeline: at least one audio stream is required");

  const start = clock.now();
  const rel = (t: number) => t - start;
  const events: DemoEvent[] = [];
  /**
   * Records events in timestamp order. Emission order can invert by a few ms
   * when a synchronous detector call runs between two audio callbacks, so the
   * log is inserted by `atMs` (append-fast-path for the normal case).
   */
  const emit: DemoEmit = (event) => {
    const last = events[events.length - 1];
    if (!last || event.atMs >= last.atMs) {
      events.push(event);
    } else {
      let index = events.length - 1;
      while (index >= 0 && events[index]!.atMs > event.atMs) index -= 1;
      events.splice(index + 1, 0, event);
    }
    opts.onEvent?.(event);
  };
  const promptInputs = buildDemoPromptInputs(opts.sessionCreate, {
    resumeContext: opts.resumeContext,
  });
  const prompt = promptInputs.prompt;
  const messages: TranscriptEntry[] = [];
  const questions: DemoQuestionOutcome[] = [];
  let pendingAnswers = 0;
  let lastAnswer = "";

  emit({
    type: "session.start",
    atMs: 0,
    mediaMs: 0,
    stream: null,
    data: {
      model: opts.model,
      sessionId: opts.sessionId,
      sessionCreate: opts.sessionCreate,
      promptChars: prompt.length,
      target: {
        asr: {
          transport: TARGET_ASR_TRANSPORT.transport,
          url: TARGET_ASR_TRANSPORT.url,
          encoding: TARGET_ASR_TRANSPORT.encoding,
          sampleRate: TARGET_ASR_TRANSPORT.sampleRate,
          channels: TARGET_ASR_TRANSPORT.channels,
          auth: TARGET_ASR_TRANSPORT.auth,
          events: TARGET_ASR_TRANSPORT.events,
          streams: TARGET_ASR_TRANSPORT.streams,
        },
        llm: { transport: "sse", path: "/api/chat", headers: TARGET_SSE_HEADERS },
      },
    },
  });

  // ── Prepare per-stream VAD + mock ASR ─────────────────────────────────────
  const runtimes: StreamRuntime[] = [];
  for (const input of opts.streams) {
    const vad = detectSpeechSegments(input.audio.samples, {
      ...(opts.vadConfig ?? {}),
      sampleRate: input.audio.sampleRate,
    });
    if (opts.requireSegmentMatch !== false && vad.segments.length !== input.fixture.segments.length) {
      throw new Error(
        `runDemoPipeline: VAD found ${vad.segments.length} segment(s) in ${input.fixture.wav} but the fixture script has ${input.fixture.segments.length}. Regenerate fixtures (node scripts/demo/generate-fixtures.mjs --force).`,
      );
    }
    const segmentMeta = new Map<string, SegmentMeta>();
    const segments: TranscriptUtterance[] = vad.segments.map((segment, index) => {
      const segmentId = `${input.stream}:${index}`;
      const script = input.fixture.segments[index];
      segmentMeta.set(segmentId, {
        segmentId,
        startWall: null,
        endWall: null,
        firstPartialWall: null,
        partials: 0,
        finalText: null,
      });
      return {
        id: segmentId,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: script?.text ?? "unscripted utterance",
        partials: script?.partials,
      };
    });
    const asrStream = opts.asr.openStream({
      sampleRate: input.audio.sampleRate,
      script: segments,
      endpointSilenceMs: (opts.vadConfig?.endSilenceMs ?? DEFAULT_VAD_CONFIG.endSilenceMs),
      now: () => clock.now(),
    });
    runtimes.push({
      input,
      vad,
      asrStream,
      segments,
      segmentMeta,
      outcome: {
        stream: input.stream,
        wavFile: input.fixture.wav,
        role: input.fixture.role,
        durationMs: input.fixture.durationMs,
        segments: vad.segments.map((segment, index) => ({
          id: `${input.stream}:${index}`,
          startMs: segment.startMs,
          endMs: segment.endMs,
          startSample: segment.startSample,
          endSample: segment.endSample,
        })),
        partials: 0,
        finals: [],
        bytesFed: 0,
        encoding: "pcm_f32le",
      },
    });
    emit({
      type: "stream.start",
      atMs: rel(clock.now()),
      mediaMs: 0,
      stream: input.stream,
      data: {
        wavFile: input.fixture.wav,
        role: input.fixture.role,
        durationMs: input.fixture.durationMs,
        segmentCount: vad.segments.length,
        encoding: "pcm_f32le",
        sampleRate: input.audio.sampleRate,
      },
    });
  }

  const sessionDurationMs = Math.max(...runtimes.map((rt) => rt.input.fixture.durationMs));

  const emitAnswerError = (stream: DemoStreamId, mediaMs: number, message: string) => {
    emit({
      type: "answer.error",
      atMs: rel(clock.now()),
      mediaMs,
      stream,
      data: { message },
    });
  };

  const handleAsrEvents = (rt: StreamRuntime, asrEvents: ReturnType<AsrStream["pushAudio"]>) => {
    for (const event of asrEvents) {
      const meta = rt.segmentMeta.get(event.segmentId);
      if (!meta) continue;
      const mediaMs = event.mediaMs;
      if (!event.isFinal) {
        meta.partials += 1;
        rt.outcome.partials += 1;
        if (meta.firstPartialWall === null) meta.firstPartialWall = event.atMs;
        emit({
          type: "asr.partial",
          atMs: rel(event.atMs),
          mediaMs,
          stream: rt.input.stream,
          data: {
            text: event.text,
            segmentId: event.segmentId,
            targetMessage: "AddPartialTranscript",
            encoding: "pcm_f32le",
          },
        });
        continue;
      }

      meta.finalText = event.text;
      emit({
        type: "asr.final",
        atMs: rel(event.atMs),
        mediaMs,
        stream: rt.input.stream,
        data: { text: event.text, segmentId: event.segmentId, targetMessage: "AddTranscript" },
      });
      emit({
        type: "asr.end_of_utterance",
        atMs: rel(event.atMs),
        mediaMs,
        stream: rt.input.stream,
        data: {
          segmentId: event.segmentId,
          target: targetEndOfUtterance(rt.input.stream, event.segmentId, mediaMs),
        },
      });

      messages.push({
        sender: rt.input.stream === "screen" ? "Interviewer" : "User",
        text: event.text,
        timestamp: mediaMs,
      });

      const detection = detectActiveQuestion({
        liveInterimText: event.text,
        allMessages: messages,
        cutoffTimestamp: 0,
      });
      const detectorSummary = {
        question: detection.cleanedQuestion || detection.activeQuestion,
        ignoredNoise: detection.ignoredNoise,
        confidenceScore: detection.confidenceScore,
      };

      if (rt.input.stream === "mic") {
        // T-09: the microphone socket captures the candidate. It must never
        // trigger answers; the transcript is still surfaced for the overlay.
        rt.outcome.finals.push({
          segmentId: event.segmentId,
          text: event.text,
          answerSuppressed: true,
          suppressionReason: "candidate_channel",
          detector: detectorSummary,
        });
        emit({
          type: "question.ignored",
          atMs: rel(clock.now()),
          mediaMs,
          stream: rt.input.stream,
          data: { reason: "candidate_channel", detector: detectorSummary },
        });
        continue;
      }

      if (!detection.activeQuestion || detection.ignoredNoise) {
        rt.outcome.finals.push({
          segmentId: event.segmentId,
          text: event.text,
          answerSuppressed: true,
          suppressionReason: detection.ignoredNoise ? "classifier_noise" : "empty_question",
          detector: detectorSummary,
        });
        emit({
          type: "question.ignored",
          atMs: rel(clock.now()),
          mediaMs,
          stream: rt.input.stream,
          data: {
            reason: detection.ignoredNoise ? "classifier_noise" : "empty_question",
            detector: detectorSummary,
          },
        });
        continue;
      }

      // ── Real detector accepted an interviewer question ────────────────────
      const questionWall = clock.now();
      const question = detection.cleanedQuestion || detection.activeQuestion;
      rt.outcome.finals.push({
        segmentId: event.segmentId,
        text: event.text,
        answerSuppressed: false,
        suppressionReason: null,
        detector: detectorSummary,
      });
      emit({
        type: "question.detected",
        atMs: rel(questionWall),
        mediaMs,
        stream: rt.input.stream,
        data: {
          question,
          segmentId: event.segmentId,
          source: detection.source,
          confidenceScore: detection.confidenceScore,
          model: opts.model,
          detector: detectorSummary,
        },
      });
      emit({
        type: "prompt.built",
        atMs: rel(clock.now()),
        mediaMs,
        stream: rt.input.stream,
        data: {
          promptChars: prompt.length,
          answerMode: promptInputs.answerMode ?? "default",
          language: opts.sessionCreate.language,
          model: opts.model,
        },
      });

      let firstTokenWall: number | null = null;
      let answerBuffer = "";
      let firstLatency: number | null = null;
      pendingAnswers += 1;
      void opts.llm
        .stream(
          {
            model: opts.model,
            messages: [
              { role: "system", content: prompt },
              { role: "user", content: `Interviewer question: ${question}` },
            ],
          },
          (delta) => {
            const wall = clock.now();
            if (firstTokenWall === null) {
              firstTokenWall = wall;
              firstLatency = wall - questionWall;
              emit({
                type: "answer.first_token",
                atMs: rel(wall),
                mediaMs,
                stream: rt.input.stream,
                data: { latencyMs: firstLatency, model: opts.model },
              });
            }
            answerBuffer += delta;
            emit({
              type: "answer.delta",
              atMs: rel(wall),
              mediaMs,
              stream: rt.input.stream,
              data: { text: delta, model: opts.model },
            });
          },
        )
        .then((full) => {
          const finalWall = clock.now();
          lastAnswer = full;
          questions.push({
            runId: opts.sessionId,
            model: opts.model,
            questionId: meta.segmentId,
            question,
            partialLatencyMs:
              (meta.firstPartialWall ?? questionWall) - (meta.startWall ?? questionWall),
            silenceToQuestionMs: questionWall - (meta.endWall ?? questionWall),
            questionToFirstTokenMs: firstTokenWall !== null ? firstTokenWall - questionWall : 0,
            questionToAnswerVisibleMs: finalWall - questionWall,
            segmentId: meta.segmentId,
            confidenceScore: detection.confidenceScore,
            source: detection.source,
            promptChars: prompt.length,
            answer: full,
          });
          emit({
            type: "answer.final",
            atMs: rel(finalWall),
            mediaMs,
            stream: rt.input.stream,
            data: {
              answer: full,
              questionToAnswerVisibleMs: finalWall - questionWall,
              firstTokenLatencyMs: firstLatency,
              model: opts.model,
            },
          });
        })
        .catch((err: unknown) => {
          emitAnswerError(rt.input.stream, mediaMs, err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          pendingAnswers -= 1;
        });
    }
  };

  // Warm up the real detector so its first-call module/JIT cost is not billed
  // to the silence->question latency (it is a fixed process start-up cost, not
  // a per-question budget item). The prompt builder was already invoked above.
  detectActiveQuestion({ liveInterimText: "warm up", allMessages: [], cutoffTimestamp: 0 });

  // ── Real-time playback loop ──────────────────────────────────────────────
  let mediaCursor = 0;
  let audioEnded = false;

  while (true) {
    const elapsed = clock.now() - start;
    if (elapsed > maxWallMs) {
      throw new Error(`runDemoPipeline: exceeded wall-clock safety limit (${maxWallMs} ms)`);
    }
    const targetMedia = Math.min(sessionDurationMs, elapsed * speed);
    if (targetMedia > mediaCursor) {
      for (const rt of runtimes) {
        const audio = rt.input.audio;
        const from = Math.min(mediaCursor, rt.input.fixture.durationMs);
        const to = Math.min(targetMedia, rt.input.fixture.durationMs);
        for (const segment of rt.vad.segments) {
          const meta = rt.segmentMeta.get(`${rt.input.stream}:${segment.index}`);
          if (!meta) continue;
          if (meta.startWall === null && to >= segment.startMs) {
            meta.startWall = clock.now();
            emit({
              type: "vad.segment",
              atMs: rel(meta.startWall),
              mediaMs: segment.startMs,
              stream: rt.input.stream,
              data: {
                segmentId: meta.segmentId,
                startMs: segment.startMs,
                endMs: segment.endMs,
                startSample: segment.startSample,
                endSample: segment.endSample,
                endpointMs: rt.vad.endpoints[segment.index]?.endpointMs ?? null,
              },
            });
          }
          if (meta.endWall === null && to >= segment.endMs) {
            meta.endWall = clock.now();
          }
        }
        if (to > from) {
          const startSample = Math.floor((from / 1000) * audio.sampleRate);
          const endSample = Math.min(
            audio.samples.length,
            Math.floor((to / 1000) * audio.sampleRate),
          );
          if (endSample > startSample) {
            const pcm16 = audio.samples.subarray(startSample, endSample);
            // T-09 wire encoding: pcm_f32le at the ASR boundary.
            const f32Bytes = toF32leBytes(pcm16);
            const f32 = new Float32Array(
              f32Bytes.buffer,
              f32Bytes.byteOffset,
              f32Bytes.byteLength / 4,
            );
            rt.outcome.bytesFed += f32Bytes.byteLength;
            handleAsrEvents(rt, rt.asrStream.pushAudio(f32));
          }
        }
      }
      mediaCursor = targetMedia;
    }

    if (!audioEnded && mediaCursor >= sessionDurationMs - 1e-6) {
      audioEnded = true;
      for (const rt of runtimes) {
        handleAsrEvents(rt, rt.asrStream.endAudio());
      }
    }

    if (audioEnded && pendingAnswers === 0) break;
    await clock.sleep(tickMs);
  }

  for (const rt of runtimes) {
    rt.asrStream.close();
  }

  const durationMs = rel(clock.now());
  emit({
    type: "session.end",
    atMs: durationMs,
    mediaMs: sessionDurationMs,
    stream: null,
    data: {
      durationMs,
      questionCount: questions.length,
      answerChars: lastAnswer.length,
      targetKey: TARGET_ASR_TRANSPORT.events.final,
    },
  });

  return {
    sessionId: opts.sessionId,
    model: opts.model,
    events,
    questions,
    streams: runtimes.map((rt) => rt.outcome),
    durationMs,
    prompt,
    answer: lastAnswer,
    sessionCreate: opts.sessionCreate,
  };
}
