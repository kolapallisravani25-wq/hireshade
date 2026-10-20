import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInvokeMeetingBridge,
  startMeetingAutoDetect,
  type MeetingSignalsBridge,
} from "./meetingAutoDetector";

function bridgeOf(...snapshots: unknown[]): MeetingSignalsBridge {
  return { listSignals: async () => snapshots as never };
}

describe("meeting auto-detect poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no-ops without a bridge (guarded, no throw)", async () => {
    const onDetected = vi.fn();
    const handle = startMeetingAutoDetect({ bridge: null, onDetected });
    await expect(handle.pollOnce()).resolves.toBeNull();
    expect(onDetected).not.toHaveBeenCalled();
    handle.stop();
  });

  it("detects a meeting and fires the prompt once", async () => {
    const onDetected = vi.fn();
    let now = 1_000;
    const handle = startMeetingAutoDetect({
      bridge: bridgeOf({ windowsProcessName: "Zoom.exe", windowTitle: "Zoom Meeting" }),
      onDetected,
      intervalMs: 0,
      now: () => now,
    });

    const detection = await handle.pollOnce();
    expect(detection?.slug).toBe("zoom");
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "zoom" }),
      "Zoom meeting detected — start HireShade for this call?",
    );

    // Same platform inside the cooldown window does not re-prompt.
    now += 1_000;
    await handle.pollOnce();
    expect(onDetected).toHaveBeenCalledTimes(1);

    // After the cooldown it prompts again.
    now += 31 * 60 * 1000;
    await handle.pollOnce();
    expect(onDetected).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("does not prompt for browser-only snapshots", async () => {
    const onDetected = vi.fn();
    const handle = startMeetingAutoDetect({
      bridge: bridgeOf({ windowsProcessName: "chrome.exe", windowTitle: "New Tab - Google Chrome" }),
      onDetected,
      intervalMs: 0,
    });
    await expect(handle.pollOnce()).resolves.toBeNull();
    expect(onDetected).not.toHaveBeenCalled();
    handle.stop();
  });

  it("swallows bridge failures and recovers on the next poll", async () => {
    const onDetected = vi.fn();
    let fail = true;
    const bridge: MeetingSignalsBridge = {
      listSignals: async () => {
        if (fail) throw new Error("IPC handler missing");
        return [{ macBundleId: "us.zoom.xos" }];
      },
    };
    const handle = startMeetingAutoDetect({ bridge, onDetected, intervalMs: 0 });

    await expect(handle.pollOnce()).resolves.toBeNull();
    expect(onDetected).not.toHaveBeenCalled();

    fail = false;
    await expect(handle.pollOnce()).resolves.toMatchObject({ slug: "zoom" });
    expect(onDetected).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("treats malformed/empty IPC payloads as no detection", async () => {
    const onDetected = vi.fn();
    const bridge: MeetingSignalsBridge = { listSignals: async () => null };
    const handle = startMeetingAutoDetect({ bridge, onDetected, intervalMs: 0 });
    await expect(handle.pollOnce()).resolves.toBeNull();
    expect(onDetected).not.toHaveBeenCalled();
    handle.stop();
  });

  it("picks the most confident snapshot when several windows match", async () => {
    const onDetected = vi.fn();
    const handle = startMeetingAutoDetect({
      bridge: bridgeOf(
        { windowTitle: "Zoom Meeting" },
        { macBundleId: "com.microsoft.teams2", windowTitle: "Microsoft Teams" },
      ),
      onDetected,
      intervalMs: 0,
    });
    const detection = await handle.pollOnce();
    expect(detection?.slug).toBe("microsoft_teams");
    handle.stop();
  });

  it("does not let a throwing prompt callback break polling", async () => {
    const onDetected = vi.fn(() => {
      throw new Error("toast host unmounted");
    });
    const handle = startMeetingAutoDetect({
      bridge: bridgeOf({ macBundleId: "us.zoom.xos" }),
      onDetected,
      intervalMs: 0,
    });
    await expect(handle.pollOnce()).resolves.toMatchObject({ slug: "zoom" });
    handle.stop();
  });

  it("polls on the configured interval and stops cleanly", async () => {
    const onDetected = vi.fn();
    const handle = startMeetingAutoDetect({
      bridge: bridgeOf({ windowsProcessName: "slack.exe" }),
      onDetected,
      intervalMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onDetected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onDetected).toHaveBeenCalledTimes(1); // cooldown
    handle.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onDetected).toHaveBeenCalledTimes(1);
  });
});

describe("createInvokeMeetingBridge", () => {
  it("rejects when IPC is unavailable", async () => {
    const bridge = createInvokeMeetingBridge(undefined);
    await expect(bridge.listSignals()).rejects.toThrow(/IPC is unavailable/);
  });

  it("returns the invoke payload and filters malformed entries", async () => {
    const invoke = vi.fn(async () => [
      { macBundleId: "us.zoom.xos" },
      null,
      "junk",
      { windowTitle: "Microsoft Teams", windowsProcessName: "ms-teams.exe" },
    ]);
    const bridge = createInvokeMeetingBridge(invoke as never);
    const signals = await bridge.listSignals();
    expect(invoke).toHaveBeenCalledWith("list_meeting_signals");
    expect(signals).toHaveLength(2);
  });

  it("propagates invoke rejection to the guarded poller (which no-ops)", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("no such handler");
    });
    const bridge = createInvokeMeetingBridge(invoke as never);
    const onDetected = vi.fn();
    const handle = startMeetingAutoDetect({ bridge, onDetected, intervalMs: 0 });
    await expect(handle.pollOnce()).resolves.toBeNull();
    expect(onDetected).not.toHaveBeenCalled();
    handle.stop();
  });
});
