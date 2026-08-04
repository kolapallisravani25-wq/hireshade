import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stopAllNativeTranscription } from "./audioSessionController";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("stopAllNativeTranscription", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("stops both native transcription channels", async () => {
    await stopAllNativeTranscription();

    expect(invoke).toHaveBeenCalledWith("stop_mic_transcription");
    expect(invoke).toHaveBeenCalledWith("stop_system_audio_transcription");
  });

  it("attempts both stops when one rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockImplementation((command) =>
      command === "stop_mic_transcription"
        ? Promise.reject(new Error("mic stop failed"))
        : Promise.resolve(undefined),
    );

    await expect(stopAllNativeTranscription()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[audio-lifecycle] native transcription stop failed",
      { failureCount: 1 },
    );
    warn.mockRestore();
  });
});
