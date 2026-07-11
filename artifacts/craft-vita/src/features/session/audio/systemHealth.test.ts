import { describe, it, expect } from "vitest";
import {
  classifySystemHealth,
  type SystemHealthInput,
  type SystemHealthThresholds,
} from "./systemHealth";

const thresholds: SystemHealthThresholds = { heartbeatStaleMs: 6000 };

// Baseline: heartbeat is fresh (2 s old), capture + Deepgram up, no audio.
const base: SystemHealthInput = {
  hadHeartbeat: true,
  msSinceHeartbeat: 2000,
  captureRunning: true,
  deepgramRunning: true,
  healthState: "capturing",
  pcmRecent: false,
  pcmIncreasing: false,
  meaningfulRecent: false,
  deepgramStallWithActivePcm: false,
};

describe("classifySystemHealth", () => {
  // ── The core regression: silence must NOT reconnect ──────────────────────
  it("connected + silent (fresh heartbeat, no PCM) stays idle/silent, never reconnects", () => {
    const d = classifySystemHealth(base, thresholds);
    expect(d.class).toBe("silent");
    expect(d.reason).toBe("transport_alive_silent");
  });

  it("stays silent even after a long silence as long as the heartbeat is fresh", () => {
    // Heartbeat still within window, but no PCM / no transcript for a long time.
    const d = classifySystemHealth(
      { ...base, msSinceHeartbeat: 5999 },
      thresholds,
    );
    expect(d.class).toBe("silent");
  });

  // ── Confirmed failures DO reconnect ──────────────────────────────────────
  it("missing (lost) heartbeat triggers reconnect", () => {
    const d = classifySystemHealth(
      { ...base, msSinceHeartbeat: 6001 },
      thresholds,
    );
    expect(d.class).toBe("reconnect");
    expect(d.reason).toBe("heartbeat_lost");
  });

  it("capture stopped (fresh heartbeat reports captureRunning=false) triggers reconnect", () => {
    const d = classifySystemHealth(
      { ...base, captureRunning: false },
      thresholds,
    );
    expect(d.class).toBe("reconnect");
    expect(d.reason).toBe("capture_stopped");
  });

  it("Deepgram down (fresh heartbeat reports deepgramRunning=false) triggers reconnect", () => {
    const d = classifySystemHealth(
      { ...base, deepgramRunning: false },
      thresholds,
    );
    expect(d.class).toBe("reconnect");
    expect(d.reason).toBe("deepgram_down");
  });

  it("explicit error/starved/stopped health state triggers reconnect", () => {
    for (const s of ["error", "starved", "stopped"]) {
      const d = classifySystemHealth({ ...base, healthState: s }, thresholds);
      expect(d.class).toBe("reconnect");
      expect(d.reason).toBe(`health_state_${s}`);
    }
  });

  it("Deepgram stall (active PCM but empty-final storm) triggers reconnect", () => {
    const d = classifySystemHealth(
      { ...base, pcmIncreasing: true, deepgramStallWithActivePcm: true },
      thresholds,
    );
    expect(d.class).toBe("reconnect");
    expect(d.reason).toBe("deepgram_stall");
  });

  // ── Live + recovery ──────────────────────────────────────────────────────
  it("PCM resuming after silence classifies live (no reconnect, no duplicate restart)", () => {
    const d = classifySystemHealth(
      { ...base, pcmRecent: true, pcmIncreasing: true },
      thresholds,
    );
    expect(d.class).toBe("live");
    expect(d.reason).toBe("audio_active");
  });

  it("recent meaningful transcript classifies live", () => {
    const d = classifySystemHealth({ ...base, meaningfulRecent: true }, thresholds);
    expect(d.class).toBe("live");
  });

  // ── Initial pre-heartbeat window ─────────────────────────────────────────
  it("before the first heartbeat, stays silent (awaiting) rather than reconnecting", () => {
    const d = classifySystemHealth(
      { ...base, hadHeartbeat: false, msSinceHeartbeat: 0, captureRunning: false, deepgramRunning: false, healthState: "idle" },
      thresholds,
    );
    expect(d.class).toBe("silent");
    expect(d.reason).toBe("awaiting_first_heartbeat");
  });

  it("an explicit error state reconnects even before any heartbeat", () => {
    const d = classifySystemHealth(
      { ...base, hadHeartbeat: false, healthState: "error" },
      thresholds,
    );
    expect(d.class).toBe("reconnect");
    expect(d.reason).toBe("health_state_error");
  });
});
