import { describe, expect, it } from "vitest";
import {
  buildDeepgramListenUrl,
  createDeepgramAsrProvider,
  mapDeepgramMessage,
} from "./asrDeepgram.js";

describe("buildDeepgramListenUrl", () => {
  it("encodes the streaming contract (16 kHz mono, interim results, 700 ms endpointing)", () => {
    const url = new URL(buildDeepgramListenUrl());
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("api.deepgram.com");
    expect(url.pathname).toBe("/v1/listen");
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("channels")).toBe("1");
    expect(url.searchParams.get("interim_results")).toBe("true");
    expect(url.searchParams.get("endpointing")).toBe("700");
    expect(url.searchParams.get("model")).toBe("nova-3");
  });

  it("honours overrides", () => {
    const url = new URL(
      buildDeepgramListenUrl({ language: "hi", sampleRate: 48_000, endpointingMs: 500 }),
    );
    expect(url.searchParams.get("language")).toBe("hi");
    expect(url.searchParams.get("sample_rate")).toBe("48000");
    expect(url.searchParams.get("endpointing")).toBe("500");
  });
});

describe("mapDeepgramMessage", () => {
  it("maps interim Results to partial events", () => {
    const event = mapDeepgramMessage(
      { type: "Results", is_final: false, channel: { alternatives: [{ transcript: "can you explain" }] } },
      "seg-1",
      900,
      1_000,
    );
    expect(event).toEqual({
      type: "partial",
      segmentId: "seg-1",
      text: "can you explain",
      mediaMs: 900,
      atMs: 1_000,
      isFinal: false,
    });
  });

  it("maps final/speech_final Results to final events", () => {
    const final = mapDeepgramMessage(
      { type: "Results", is_final: true, channel: { alternatives: [{ transcript: "  done  " }] } },
      "seg-1",
      2_000,
      2_050,
    );
    expect(final?.type).toBe("final");
    expect(final?.isFinal).toBe(true);
    expect(final?.text).toBe("done");

    const speechFinal = mapDeepgramMessage(
      { type: "Results", speech_final: true, channel: { alternatives: [{ transcript: "end" }] } },
      "seg-1",
      2_000,
      2_050,
    );
    expect(speechFinal?.isFinal).toBe(true);
  });

  it("ignores metadata, empty and malformed messages", () => {
    expect(mapDeepgramMessage({ type: "Metadata" }, "s", 0, 0)).toBeNull();
    expect(
      mapDeepgramMessage({ type: "Results", channel: { alternatives: [{ transcript: "   " }] } }, "s", 0, 0),
    ).toBeNull();
    expect(mapDeepgramMessage({ type: "Results" }, "s", 0, 0)).toBeNull();
  });
});

describe("createDeepgramAsrProvider", () => {
  it("is unconfigured without DEEPGRAM_API_KEY and throws on open", () => {
    const previous = process.env["DEEPGRAM_API_KEY"];
    delete process.env["DEEPGRAM_API_KEY"];
    const provider = createDeepgramAsrProvider();
    expect(provider.isConfigured()).toBe(false);
    expect(() => provider.openStream({ sampleRate: 16_000 })).toThrow(/DEEPGRAM_API_KEY/);
    if (previous !== undefined) process.env["DEEPGRAM_API_KEY"] = previous;
  });
});
