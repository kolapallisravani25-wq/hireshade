/**
 * Keyless demo runner (G-001 / G-004 / G-005 / G-017 / G-034 evidence writer).
 *
 * Runs the full mock session N times per model at 1x wall clock:
 *   fixture WAV -> VAD (700 ms endpoint, mic + screen channels) -> mock ASR
 *   (partials/finals/EndOfUtterance over pcm_f32le) -> real question detector
 *   -> real prompt builder (T-11 contract) -> mock LLM stream (target TTFT)
 *   -> overlay frames; measures the latency budget and writes evidence.
 *
 * Also probes the live demo HTTP surface with zero keys: demo auth user,
 * mocked Deepgram token and the target SSE /api/chat transport.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createMockAsrProvider } from "../../../api-server/src/lib/mocks/mockAsr";
import { createMockLlmProvider } from "../../../api-server/src/lib/mocks/mockLlm";
import { startDemoServer } from "../../../api-server/src/lib/mocks/demoServer";
import {
  TARGET_ASR_TRANSPORT,
  TARGET_MODEL_TTFT_MS,
  TARGET_SSE_HEADERS,
  createDemoSessionCreate,
  firstTokenDelayForModel,
  validateTargetSessionCreate,
  type TargetSessionCreate,
} from "../../../api-server/src/lib/mocks/targetContracts";
import { assertDemoModeSafe, describeDemoMode } from "../../../api-server/src/lib/mocks/demoMode";
import {
  EVIDENCE_DIR,
  GENERATOR_SCRIPT,
  allFixturesExist,
  getFixture,
  loadFixtureWavBytes,
} from "./fixtures";
import { parseWav } from "./wav";
import { runDemoPipeline, type DemoPipelineResult, type PipelineStreamInput } from "./pipeline";
import { buildOverlayReplay } from "./overlayStream";
import {
  DEMO_LATENCY_BUDGETS,
  evaluateLatencyBudget,
  type LatencySample,
} from "./metrics";
import { isGazeDemoEnabled, runDemoGazeStage, type DemoGazeSummary } from "../gaze/demoGaze";

const PROVIDER_KEYS = [
  "OPENROUTER_API_KEY",
  "DEEPGRAM_API_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_ISSUER_DOMAIN",
  "CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "VITE_DEEPGRAM_API_KEY",
  "DATABASE_URL",
] as const;

/** Models exercised for the budget. All have target TTFT < 1200 ms. */
const DEFAULT_MODELS = ["gpt-5", "gemini-3-1-flash-lite", "gemini-3-6-flash"];
/** Target table entries with TTFT >= our 1200 ms budget are reference-only. */
const REFERENCE_ONLY_MODELS = Object.entries(TARGET_MODEL_TTFT_MS)
  .filter(([, ttft]) => ttft > DEMO_LATENCY_BUDGETS.questionToFirstTokenMaxMs)
  .map(([model]) => model);

interface RunEvidence {
  runId: string;
  model: string;
  durationMs: number;
  answerChars: number;
  promptChars: number;
  questions: Array<Record<string, unknown>>;
  streams: Array<{
    stream: string;
    wavFile: string;
    role: string;
    durationMs: number;
    encoding: string;
    bytesFed: number;
    partials: number;
    segments: Array<{ id: string; startMs: number; endMs: number }>;
    finals: Array<Record<string, unknown>>;
  }>;
}

function argValue(name: string, fallback: string): string {
  const prefix = "--" + name + "=";
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function ensureFixtures(): void {
  if (allFixturesExist()) return;
  const run = spawnSync(process.execPath, [GENERATOR_SCRIPT], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error("fixture generation failed: " + run.stdout + "\n" + run.stderr);
  }
}

function streamInput(stream: "mic" | "screen", fixtureId: string): PipelineStreamInput {
  const fixture = getFixture(fixtureId);
  const audio = parseWav(loadFixtureWavBytes(fixture));
  if (audio.sampleRate !== 16_000) {
    throw new Error(fixture.wav + ": expected 16 kHz fixtures, got " + audio.sampleRate);
  }
  return { stream, fixture, audio };
}

function readKeys(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const key of PROVIDER_KEYS) result[key] = Boolean((process.env[key] ?? "").trim());
  return result;
}

interface SseProbe {
  url: string;
  model: string;
  status: number;
  headers: Record<string, string>;
  firstTokenMs: number;
  answerChars: number;
  answerPreview: string;
  eventTypes: string[];
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

async function probeDemoServer(): Promise<{
  server: {
    url: string;
    port: number;
    health: unknown;
    demoUser: unknown;
    deepgramToken: unknown;
    status: unknown;
  };
  sse: SseProbe;
}> {
  const env = { ...process.env, DEMO_MODE: "1", NODE_ENV: "development" };
  const server = await startDemoServer({ env });
  try {
    const health = await fetch(server.url + "/health").then((r) => r.json());
    const demoUser = await fetch(server.url + "/auth/me").then((r) => r.json());
    const deepgramToken = await fetch(server.url + "/auth/deepgram-token", {
      method: "POST",
    }).then((r) => r.json());
    const status = await fetch(server.url + "/demo/status").then((r) => r.json());

    const started = performance.now();
    const response = await fetch(server.url + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5", messages: [] }),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenMs = -1;
    let answer = "";
    const eventTypes: string[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const event = JSON.parse(payload) as { type: string; text?: string };
          eventTypes.push(event.type);
          if (event.type === "delta") {
            if (firstTokenMs < 0) firstTokenMs = performance.now() - started;
            answer += event.text ?? "";
          }
        }
      }
    }

    const checks = [
      {
        name: "content-type",
        pass: (headers["content-type"] ?? "").includes("text/event-stream"),
        detail: headers["content-type"] ?? "",
      },
      {
        name: "cache-control",
        pass: (headers["cache-control"] ?? "") === TARGET_SSE_HEADERS["Cache-Control"],
        detail: headers["cache-control"] ?? "",
      },
      {
        name: "x-accel-buffering",
        pass: (headers["x-accel-buffering"] ?? "") === TARGET_SSE_HEADERS["X-Accel-Buffering"],
        detail: headers["x-accel-buffering"] ?? "",
      },
      { name: "first-delta-received", pass: firstTokenMs >= 0, detail: firstTokenMs.toFixed(1) + " ms" },
      { name: "answer-streamed", pass: answer.includes("rate limiter"), detail: answer.length + " chars" },
      { name: "done-sentinel", pass: eventTypes.includes("done"), detail: eventTypes.join(",") },
    ];
    const sse: SseProbe = {
      url: server.url + "/api/chat",
      model: "gpt-5",
      status: response.status,
      headers,
      firstTokenMs,
      answerChars: answer.length,
      answerPreview: answer.slice(0, 160),
      eventTypes,
      pass: response.ok && checks.every((check) => check.pass),
      checks,
    };
    return {
      server: { url: server.url, port: server.port, health, demoUser, deepgramToken, status },
      sse,
    };
  } finally {
    await server.close();
  }
}

function writeMarkdown(
  report: ReturnType<typeof evaluateLatencyBudget>,
  runs: RunEvidence[],
  firstRun: DemoPipelineResult,
  probe: Awaited<ReturnType<typeof probeDemoServer>>,
): string {
  const lines: string[] = [];
  lines.push("# HireShade zero-key demo - transcript & latency evidence");
  lines.push("");
  lines.push("Generated: " + new Date().toISOString());
  lines.push("");
  lines.push("## Result");
  lines.push("");
  lines.push(report.pass ? "**PASS** - every latency budget was met with zero provider keys." : "**FAIL** - see failed checks below.");
  lines.push("");
  lines.push("| Budget | Statistic | Threshold | Measured | Pass |");
  lines.push("|---|---|---|---|---|");
  for (const check of report.checks) {
    lines.push("| " + check.metric + " | " + check.statistic + " | " + check.thresholdMs + " ms | " + check.actualMs.toFixed(1) + " ms | " + (check.pass ? "yes" : "NO") + " |");
  }
  lines.push("");
  lines.push("## Measured latency (all runs)");
  lines.push("");
  lines.push("| Metric | n | p50 | p95 | max |");
  lines.push("|---|---|---|---|---|");
  const metricRows: Array<[string, keyof typeof report.metrics]> = [
    ["partial transcript", "partialLatencyMs"],
    ["silence -> question", "silenceToQuestionMs"],
    ["question -> first token", "questionToFirstTokenMs"],
    ["question -> answer visible", "questionToAnswerVisibleMs"],
  ];
  for (const [label, key] of metricRows) {
    const m = report.metrics[key];
    lines.push("| " + label + " | " + m.count + " | " + m.p50Ms.toFixed(1) + " | " + m.p95Ms.toFixed(1) + " | " + m.maxMs.toFixed(1) + " |");
  }
  lines.push("");
  lines.push("## Target transport contracts (docs/TARGET_VERIFIED.md)");
  lines.push("");
  lines.push("- ASR (T-09): " + TARGET_ASR_TRANSPORT.transport + " " + TARGET_ASR_TRANSPORT.url + ", " + TARGET_ASR_TRANSPORT.encoding + " @ " + TARGET_ASR_TRANSPORT.sampleRate + " Hz mono, JWT query param; events " + TARGET_ASR_TRANSPORT.events.partial + "/" + TARGET_ASR_TRANSPORT.events.final + "/" + TARGET_ASR_TRANSPORT.events.endpoint + "; two sockets (" + TARGET_ASR_TRANSPORT.streams.map((s) => s.label).join(", ") + ").");
  lines.push("- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: " + probe.sse.firstTokenMs.toFixed(1) + " ms.");
  lines.push("- Session create (T-11): " + (validateTargetSessionCreate(firstRun.sessionCreate as unknown as Record<string, unknown>).ok ? "validated" : "INVALID") + " against the observed desktop-app contract.");
  lines.push("");
  lines.push("## Per-run detail");
  lines.push("");
  for (const run of runs) {
    lines.push("### " + run.runId + " - model " + run.model);
    lines.push("");
    lines.push("Session wall time " + run.durationMs.toFixed(0) + " ms; prompt " + run.promptChars + " chars; answer " + run.answerChars + " chars.");
    lines.push("");
    for (const stream of run.streams) {
      lines.push("- " + stream.stream + " (" + stream.role + ", " + stream.wavFile + "): " + stream.segments.length + " VAD segment(s), " + stream.partials + " partial(s), " + stream.bytesFed + " bytes as " + stream.encoding + " -> ASR. Finals: " + stream.finals.map((f) => JSON.stringify(f.text)).join(", "));
    }
    lines.push("");
    lines.push("| question | partial ms | silence->q ms | first token ms | answer visible ms |");
    lines.push("|---|---|---|---|---|");
    for (const q of run.questions) {
      lines.push("| " + String(q["question"]) + " | " + Number(q["partialLatencyMs"]).toFixed(1) + " | " + Number(q["silenceToQuestionMs"]).toFixed(1) + " | " + Number(q["questionToFirstTokenMs"]).toFixed(1) + " | " + Number(q["questionToAnswerVisibleMs"]).toFixed(1) + " |");
    }
    lines.push("");
  }
  lines.push("## Full transcript - first run (screen-share channel)");
  lines.push("");
  const screen = firstRun.streams.find((s) => s.stream === "screen")!;
  for (const final of screen.finals) {
    lines.push("**Interviewer:** " + String(final["text"]));
    lines.push("");
  }
  for (const event of firstRun.events.filter((e) => e.type === "question.detected")) {
    lines.push("**Detected question:** " + String(event.data["question"]) + " (source " + String(event.data["source"]) + ", confidence " + Number(event.data["confidenceScore"]).toFixed(2) + ")");
    lines.push("");
  }
  lines.push("**Streamed answer:**");
  lines.push("");
  lines.push("> " + firstRun.answer.replace(/\n/g, "\n> "));
  lines.push("");
  lines.push("## Mock HTTP surface (zero keys)");
  lines.push("");
  lines.push("- demo server: " + probe.server.url);
  lines.push("- GET /auth/me: " + JSON.stringify(probe.server.demoUser));
  lines.push("- POST /auth/deepgram-token: " + JSON.stringify(probe.server.deepgramToken));
  lines.push("- GET /demo/status: " + JSON.stringify(probe.server.status));
  lines.push("");
  lines.push("## Reference: target per-model first-token table (T-10/T-11)");
  lines.push("");
  lines.push("| model | target TTFT ms |");
  lines.push("|---|---|");
  for (const [model, ttft] of Object.entries(TARGET_MODEL_TTFT_MS)) {
    lines.push("| " + model + " | " + ttft + " |");
  }
  lines.push("");
  lines.push("Reference-only (target TTFT >= our " + DEMO_LATENCY_BUDGETS.questionToFirstTokenMaxMs + " ms budget, so excluded from the budget sample): " + (REFERENCE_ONLY_MODELS.join(", ") || "none"));
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const runsPerModel = Number(argValue("runs", "3")) || 3;
  const models = (argValue("models", DEFAULT_MODELS.join(",")) || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const started = Date.now();
  // The harness is demo-mode only: opt in, refuse production, then prove the
  // fail-closed gate accepts the configuration before any mock is constructed.
  if ((process.env["NODE_ENV"] ?? "").toLowerCase() === "production") {
    throw new Error("DEMO_MODE is forbidden when NODE_ENV=production; refusing to run the demo harness");
  }
  process.env["DEMO_MODE"] = "1";
  if (!process.env["NODE_ENV"]) process.env["NODE_ENV"] = "development";
  assertDemoModeSafe(process.env);
  ensureFixtures();

  const demoMode = describeDemoMode();
  const keys = readKeys();

  console.log("[demo] mode=" + demoMode.mode + " nodeEnv=" + (demoMode.nodeEnv ?? "(unset)") + " models=" + models.join(", ") + " runs/model=" + runsPerModel);
  console.log("[demo] provider keys present: " + (Object.entries(keys).filter(([, present]) => present).map(([key]) => key).join(", ") || "none"));

  const probe = await probeDemoServer();
  console.log("[demo] mock HTTP surface: health=" + JSON.stringify(probe.server.health) + " sseFirstDelta=" + probe.sse.firstTokenMs.toFixed(1) + "ms pass=" + probe.sse.pass);

  const samples: LatencySample[] = [];
  const runEvidence: RunEvidence[] = [];
  let firstRun: DemoPipelineResult | null = null;

  for (const model of models) {
    for (let runIndex = 1; runIndex <= runsPerModel; runIndex++) {
      const sessionCreate: TargetSessionCreate = createDemoSessionCreate({
        aiModel: model,
        language: "en",
      });
      const runId = "run-" + String(runEvidence.length + 1).padStart(2, "0") + "-" + model.replace(/[^a-z0-9]+/gi, "-");
      const asr = createMockAsrProvider();
      const llm = createMockLlmProvider({
        id: "mock-llm-" + model,
        firstTokenDelayMs: firstTokenDelayForModel(model),
        chunkDelayMs: Number(argValue("chunk-ms", "30")) || 30,
        wordsPerChunk: 4,
      });
      const result = await runDemoPipeline({
        sessionId: runId,
        sessionCreate,
        model,
        streams: [streamInput("mic", "demo-mic"), streamInput("screen", "demo-screen")],
        asr,
        llm,
        speed: 1,
        tickMs: 10,
      });
      if (!firstRun) firstRun = result;
      samples.push(...result.questions.map((question) => ({ ...question, runId })));

      const summary: RunEvidence = {
        runId,
        model,
        durationMs: Number(result.durationMs.toFixed(1)),
        answerChars: result.answer.length,
        promptChars: result.prompt.length,
        questions: result.questions.map((question) => ({
          questionId: question.questionId,
          question: question.question,
          model: question.model,
          partialLatencyMs: Number(question.partialLatencyMs.toFixed(1)),
          silenceToQuestionMs: Number(question.silenceToQuestionMs.toFixed(1)),
          questionToFirstTokenMs: Number(question.questionToFirstTokenMs.toFixed(1)),
          questionToAnswerVisibleMs: Number(question.questionToAnswerVisibleMs.toFixed(1)),
          confidenceScore: Number(question.confidenceScore.toFixed(2)),
          source: question.source,
        })),
        streams: result.streams.map((stream) => ({
          stream: stream.stream,
          wavFile: stream.wavFile,
          role: stream.role,
          durationMs: stream.durationMs,
          encoding: stream.encoding,
          bytesFed: stream.bytesFed,
          partials: stream.partials,
          segments: stream.segments.map((segment) => ({
            id: segment.id,
            startMs: segment.startMs,
            endMs: segment.endMs,
          })),
          finals: stream.finals.map((final) => ({
            segmentId: final.segmentId,
            text: final.text,
            answerSuppressed: final.answerSuppressed,
            suppressionReason: final.suppressionReason,
            detector: final.detector,
          })),
        })),
      };
      runEvidence.push(summary);
      console.log(
        "[demo] " + runId + ": " + result.questions.length + " answer(s), session " + result.durationMs.toFixed(0) + " ms, first-token " + result.questions.map((q) => q.questionToFirstTokenMs.toFixed(0)).join("/") + " ms, answer-visible " + result.questions.map((q) => q.questionToAnswerVisibleMs.toFixed(0)).join("/") + " ms",
      );
    }
  }

  const report = evaluateLatencyBudget(samples, DEMO_LATENCY_BUDGETS);
  const first = firstRun as DemoPipelineResult;
  const overlay = buildOverlayReplay(first.sessionId, first.events);
  // W4 extension: deterministic synthetic gaze burst when DEMO_GAZE=1 (make demo).
  const gaze: DemoGazeSummary | null = isGazeDemoEnabled(process.env) ? runDemoGazeStage({ env: process.env }) : null;

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = {
    generatedAt: new Date().toISOString(),
    kind: "zero-key-demo",
    demoMode,
    providerKeysPresent: keys,
    allProviderKeysUnset: Object.values(keys).every((present) => !present),
    fixtures: {
      manifest: "artifacts/craft-vita/src/demo/fixtures/fixtures.json",
      manifestDescription: "WAVs generated by scripts/demo/generate-fixtures.mjs (ffmpeg); *.wav gitignored",
      sampleRate: 16_000,
      used: ["demo-screen.wav", "demo-mic.wav"],
    },
    targetContracts: {
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
      llm: {
        transport: "sse",
        path: "/api/chat",
        headers: TARGET_SSE_HEADERS,
        liveProbe: probe.sse,
      },
      sessionCreate: {
        contract: first.sessionCreate,
        validation: validateTargetSessionCreate(first.sessionCreate as unknown as Record<string, unknown>),
        fields: [
          "resumeId",
          "documentIds",
          "language",
          "aiModel",
          "responseLength",
          "responseFormat",
          "responseTone",
          "useStarMethod",
          "useFillerWords",
          "autoAnswer",
          "saveTranscription",
          "transcriptionContext",
          "systemInstructions",
          "createdFrom",
        ],
      },
      modelTtftMs: TARGET_MODEL_TTFT_MS,
      referenceOnlyModels: REFERENCE_ONLY_MODELS,
    },
    mockHttpSurface: probe.server,
    runs: runEvidence,
    latency: report,
    extensions: { gaze },
    pass: report.pass && probe.sse.pass && (gaze === null || (gaze.enabled && gaze.appliedFrames === gaze.framesProcessed)),
    evidenceFiles: {
      latency: "docs/evidence/demo/demo-latency.json",
      transcript: "docs/evidence/demo/demo-transcript.md",
      events: "docs/evidence/demo/demo-events.jsonl",
      overlayData: "docs/evidence/demo/demo-overlay.json",
      overlayScreenshot: "docs/evidence/demo/overlay-answer.png",
      overlayDom: "docs/evidence/demo/overlay-dom.json",
    },
  };

  writeFileSync(path.join(EVIDENCE_DIR, "demo-latency.json"), JSON.stringify(evidence, null, 2) + "\n");
  writeFileSync(path.join(EVIDENCE_DIR, "demo-transcript.md"), writeMarkdown(report, runEvidence, first, probe) + "\n");
  writeFileSync(path.join(EVIDENCE_DIR, "demo-events.jsonl"), first.events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  writeFileSync(
    path.join(EVIDENCE_DIR, "demo-overlay.json"),
    JSON.stringify(
      {
        sessionId: first.sessionId,
        model: first.model,
        fixture: "demo-screen.wav",
        meta: overlay.meta,
        frames: overlay.frames,
      },
      null,
      2,
    ) + "\n",
  );

  if (gaze) {
    console.log(
      "[demo] extensions: gaze frames=" + gaze.framesProcessed + " applied=" + gaze.appliedFrames + " passthrough=" + gaze.passthroughFrames + " mean=" + gaze.meanDurationMs.toFixed(2) + " ms max=" + gaze.maxDurationMs.toFixed(2) + " ms output=" + gaze.output.width + "x" + gaze.output.height + "@" + gaze.output.fps,
    );
  }
  console.log("[demo] latency checks:");
  for (const check of report.checks) {
    console.log("[demo]   " + (check.pass ? "PASS" : "FAIL") + " " + check.metric + " " + check.statistic + " = " + check.actualMs.toFixed(1) + " ms (budget " + check.thresholdMs + " ms)");
  }
  console.log("[demo] answer-visible p50=" + report.metrics.questionToAnswerVisibleMs.p50Ms.toFixed(1) + " ms p95=" + report.metrics.questionToAnswerVisibleMs.p95Ms.toFixed(1) + " ms");
  console.log("[demo] evidence written to " + EVIDENCE_DIR);
  console.log("[demo] total " + ((Date.now() - started) / 1000).toFixed(1) + " s");
  if (!report.pass) throw new Error("latency budget failed");
  if (!probe.sse.pass) throw new Error("target SSE contract probe failed");
  if (gaze && (!gaze.enabled || gaze.appliedFrames !== gaze.framesProcessed)) {
    throw new Error("gaze extension stage failed (applied " + gaze.appliedFrames + "/" + gaze.framesProcessed + ")");
  }
}

main().catch((err: unknown) => {
  console.error("[demo] FAILED:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
