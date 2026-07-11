import { describe, it, expect } from "vitest";
import { deriveCaptureStatus, type CaptureStatusInput } from "./captureStatus";

// State-machine guard for the overlay's interviewer/system-audio badge. The
// v0.1.21 bug was an endless Released<->Reconnecting flap; these cases pin the
// priority order (Error > Reconnecting > Live > Released > Disconnected) so a
// future edit can't silently reintroduce the flap or mis-rank the states.
const base: CaptureStatusInput = {
  tabStatus: "idle",
  isSystemStale: false,
  isMicConnecting: false,
  isMicActive: false,
  hasSession: true,
};

describe("deriveCaptureStatus", () => {
  it("returns Error whenever Deepgram reports a hard error, outranking all else", () => {
    expect(
      deriveCaptureStatus({
        ...base,
        tabStatus: "error",
        isSystemStale: true,
        isMicActive: true,
      }),
    ).toBe("Error");
  });

  it("returns Reconnecting when the system channel is stale", () => {
    expect(deriveCaptureStatus({ ...base, isSystemStale: true })).toBe(
      "Reconnecting",
    );
  });

  it("returns Reconnecting when the mic is connecting", () => {
    expect(deriveCaptureStatus({ ...base, isMicConnecting: true })).toBe(
      "Reconnecting",
    );
  });

  it("returns Reconnecting when the system tab is connecting", () => {
    expect(deriveCaptureStatus({ ...base, tabStatus: "connecting" })).toBe(
      "Reconnecting",
    );
  });

  it("returns Live when the system tab is transcribing", () => {
    expect(deriveCaptureStatus({ ...base, tabStatus: "transcribing" })).toBe(
      "Live",
    );
  });

  it("returns Live when the mic is active", () => {
    expect(deriveCaptureStatus({ ...base, isMicActive: true })).toBe("Live");
  });

  it("prefers Reconnecting over Live when both a stale flag and a live channel are set", () => {
    expect(
      deriveCaptureStatus({
        ...base,
        isSystemStale: true,
        tabStatus: "transcribing",
      }),
    ).toBe("Reconnecting");
  });

  it("returns Released when a session exists but nothing is connecting or live", () => {
    expect(deriveCaptureStatus({ ...base })).toBe("Released");
  });

  it("returns Disconnected when there is no session at all", () => {
    expect(deriveCaptureStatus({ ...base, hasSession: false })).toBe(
      "Disconnected",
    );
  });
});
