import { describe, expect, it } from "vitest";
import {
  TARGET_ASR_TRANSPORT,
  TARGET_MODEL_TTFT_MS,
  TARGET_SESSION_CREATE_FIELDS,
  TARGET_SSE_HEADERS,
  buildTargetAsrUrl,
  createDemoSessionCreate,
  firstTokenDelayForModel,
  normalizeModelAlias,
  splitLanguageDomain,
  targetEndOfUtterance,
  toF32leBytes,
  toTargetAsrMessage,
  validateTargetSessionCreate,
} from "./targetContracts.js";
import type { AsrEvent } from "./types.js";

describe("T-09 ASR transport contract", () => {
  it("matches the target: WS, 16 kHz mono pcm_f32le, JWT query param, two streams", () => {
    expect(TARGET_ASR_TRANSPORT.transport).toBe("websocket");
    expect(TARGET_ASR_TRANSPORT.encoding).toBe("pcm_f32le");
    expect(TARGET_ASR_TRANSPORT.sampleRate).toBe(16_000);
    expect(TARGET_ASR_TRANSPORT.channels).toBe(1);
    expect(TARGET_ASR_TRANSPORT.auth).toEqual({ kind: "jwt-query-param", param: "jwt" });
    expect(TARGET_ASR_TRANSPORT.events).toEqual({
      partial: "AddPartialTranscript",
      final: "AddTranscript",
      endpoint: "EndOfUtterance",
    });
    expect(TARGET_ASR_TRANSPORT.streams.map((s) => s.id)).toEqual(["mic", "screen"]);
    expect(TARGET_ASR_TRANSPORT.streams.map((s) => s.label)).toEqual([
      "Microphone",
      "Screen Sharing",
    ]);
  });

  it("builds a JWT-in-query-string URL", () => {
    const url = new URL(buildTargetAsrUrl({ jwt: "header.payload.sig", app: "hireshade" }));
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("global.rt.speechmatics.com");
    expect(url.pathname).toBe("/v2");
    expect(url.searchParams.get("jwt")).toBe("header.payload.sig");
    expect(url.searchParams.get("sm-app")).toBe("hireshade");
  });

  it("keeps the language[:domain] form (T-09/T-14)", () => {
    expect(splitLanguageDomain("en:medical")).toEqual({ language: "en", domain: "medical" });
    expect(splitLanguageDomain("hi")).toEqual({ language: "hi" });
    const url = new URL(buildTargetAsrUrl({ jwt: "t", language: "en:medical" }));
    expect(url.searchParams.get("language")).toBe("en:medical");
  });

  it("encodes 16-bit PCM to f32le bytes in [-1, 1]", () => {
    const bytes = toF32leBytes(new Int16Array([0, 16_384, -32_768, 32_767]));
    expect(bytes.byteLength).toBe(16);
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    expect(Array.from(floats)).toEqual([0, 0.5, -1, 32_767 / 32_768]);
  });

  it("maps internal events onto AddPartialTranscript/AddTranscript/EndOfUtterance", () => {
    const partial: AsrEvent = {
      type: "partial",
      segmentId: "screen:q1",
      text: "Can you",
      mediaMs: 900,
      atMs: 910,
      isFinal: false,
    };
    const final: AsrEvent = { ...partial, type: "final", text: "Can you explain Redis?", isFinal: true };
    expect(toTargetAsrMessage(partial, "screen").message).toBe("AddPartialTranscript");
    expect(toTargetAsrMessage(final, "screen").message).toBe("AddTranscript");
    expect(toTargetAsrMessage(final, "screen").metadata.stream).toBe("screen");
    expect(toTargetAsrMessage(final, "screen").metadata.time).toBe(900);
    expect(targetEndOfUtterance("screen", "screen:q1", 2_300)).toEqual({
      message: "EndOfUtterance",
      metadata: { stream: "screen", utteranceId: "screen:q1", time: 2_300 },
    });
  });
});

describe("T-10 LLM SSE contract", () => {
  it("uses the observed SSE headers verbatim", () => {
    expect(TARGET_SSE_HEADERS).toEqual({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });
  });

  it("exposes the target per-model first-token table", () => {
    expect(TARGET_MODEL_TTFT_MS["gpt-5"]).toBe(506);
    expect(TARGET_MODEL_TTFT_MS["claude-haiku-4-5"]).toBe(1_208);
    expect(TARGET_MODEL_TTFT_MS["gemini-3-1-flash-lite"]).toBe(387);
    expect(firstTokenDelayForModel("gpt-5")).toBe(506);
    expect(firstTokenDelayForModel("anthropic/claude-haiku-4.5")).toBe(1_208);
    expect(firstTokenDelayForModel("gemini-3-1-flash-lite")).toBe(387);
    expect(firstTokenDelayForModel("unknown-model")).toBe(620);
    expect(firstTokenDelayForModel(null)).toBe(620);
  });

  it("normalises provider-prefixed and dotted aliases", () => {
    expect(normalizeModelAlias("anthropic/claude-haiku-4.5")).toBe("claude-haiku-4.5".replace(".", "-"));
    expect(normalizeModelAlias("gpt-5")).toBe("gpt-5");
  });
});

describe("T-11 session-create contract", () => {
  it("sends the observed reference-style fields with createdFrom=desktop-app", () => {
    const create = createDemoSessionCreate();
    expect(validateTargetSessionCreate(create)).toEqual({
      ok: true,
      missing: [],
      unknown: [],
      createdFromValid: true,
    });
    for (const field of TARGET_SESSION_CREATE_FIELDS) {
      expect(field in create).toBe(true);
    }
    expect(create.createdFrom).toBe("desktop-app");
    expect(create.aiModel).toBe("gpt-5");
    expect(Array.isArray(create.documentIds)).toBe(true);
  });

  it("flags missing and unknown fields", () => {
    const result = validateTargetSessionCreate({ createdFrom: "web-app", resumeId: null });
    expect(result.ok).toBe(false);
    expect(result.createdFromValid).toBe(false);
    expect(result.missing).toContain("documentIds");
    expect(result.unknown).toEqual([]);
  });
});
