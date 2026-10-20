import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import captureLogic from "./captureLogic.cjs";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("capture layouts", () => {
  it("computes card, banner and reading layouts", () => {
    const card = captureLogic.computeCaptureLayout("card", workArea);
    expect(card).toEqual({ x: 610, y: 16, width: 700, height: 360 });

    const banner = captureLogic.computeCaptureLayout("banner", workArea);
    expect(banner.width).toBe(1920);
    expect(banner.x).toBe(0);
    expect(banner.y).toBe(16);
    expect(banner.height).toBeGreaterThanOrEqual(240);
    expect(banner.height).toBeLessThanOrEqual(420);

    const reading = captureLogic.computeCaptureLayout("reading", workArea);
    expect(reading.width).toBe(Math.round(1920 * 0.92));
    expect(reading.height).toBe(Math.round(1040 * 0.88));
    expect(reading.x).toBe(Math.round((1920 - reading.width) / 2));
    expect(reading.y).toBe(Math.round((1040 - reading.height) / 2));
  });

  it("handles small work areas and unknown profiles", () => {
    const small = { x: -1280, y: 0, width: 320, height: 200 };
    const banner = captureLogic.computeCaptureLayout("banner", small);
    expect(banner.width).toBe(320);
    expect(banner.height).toBeLessThanOrEqual(200);
    expect(captureLogic.computeCaptureLayout("bogus", workArea)).toEqual(
      captureLogic.computeCaptureLayout("card", workArea),
    );
    expect(captureLogic.isCaptureProfile("reading")).toBe(true);
    expect(captureLogic.isCaptureProfile("bogus")).toBe(false);
  });

  it("rejects invalid work areas", () => {
    expect(() => captureLogic.computeCaptureLayout("banner", { x: 0, y: 0, width: 0, height: 0 })).toThrow();
    expect(() => captureLogic.computeCaptureLayout("banner", null)).toThrow();
  });
});

describe("compatibility mode plan", () => {
  it("describes the default transparent surface", () => {
    const plan = captureLogic.computeCompatPlan(false);
    expect(plan.transparent).toBe(true);
    expect(plan.cssClass).toBeNull();
    expect(plan.requiresSurfaceRecreate).toBe(false);
  });

  it("describes the opaque + solid scrim surface", () => {
    const plan = captureLogic.computeCompatPlan(true);
    expect(plan.transparent).toBe(false);
    expect(plan.backgroundColor).toBe("#0b0d12");
    expect(plan.cssClass).toBe("hireshade-capture-compat");
    expect(plan.requiresSurfaceRecreate).toBe(true);
    expect(plan.disableBackdropFilter).toBe(true);
    expect(plan.disableRoundedCorners).toBe(true);
    expect(plan.disableShadows).toBe(true);
    expect(captureLogic.COMPAT_CSS).toContain("#0b0d12");
    expect(captureLogic.COMPAT_CSS).toContain("backdrop-filter:none");
    expect(captureLogic.COMPAT_CSS).toContain("border-radius:0");
  });
});

describe("compatibility suggestions (honest)", () => {
  it("suggests compatibility mode when the user reports visibility", () => {
    const suggestion = captureLogic.suggestCompatibilityMode({ reportedVisible: true });
    expect(suggestion.suggest).toBe(true);
    expect(suggestion.confidence).toBe("reported");
    expect(suggestion.canAutoDetect).toBe(false);
    expect(suggestion.reasons.join(" ")).toMatch(/user reports/);
  });

  it("uses the large transparent overlay heuristic below the user report", () => {
    const suggestion = captureLogic.suggestCompatibilityMode({
      overlayAreaRatio: 0.87,
      transparent: true,
    });
    expect(suggestion.suggest).toBe(true);
    expect(suggestion.confidence).toBe("heuristic");
    expect(suggestion.reasons.join(" ")).toMatch(/large transparent overlay/);

    const small = captureLogic.suggestCompatibilityMode({ overlayAreaRatio: 0.2, transparent: true });
    expect(small.suggest).toBe(false);
  });

  it("surfaces a known-bad capture hint but never pretends to auto-detect", () => {
    const hint = captureLogic.suggestCompatibilityMode({ knownBadCapturePath: "DXGI Desktop Duplication" });
    expect(hint.suggest).toBe(true);
    expect(hint.confidence).toBe("hint");
    expect(hint.honestNote).toMatch(/cannot be reliably detected/);
    expect(captureLogic.SELF_CHECK_COPY.limitation).toMatch(/cannot reliably detect/);
  });
});

describe("fallback ladder", () => {
  it("is ordered and advances past attempted steps", () => {
    expect(captureLogic.FALLBACK_LADDER.map((step: { id: string }) => step.id)).toEqual([
      "second-monitor",
      "share-window-or-tab",
      "compatibility-mode",
      "browser-only",
    ]);
    expect(captureLogic.nextFallbackStep([])!.id).toBe("second-monitor");
    expect(captureLogic.nextFallbackStep(["second-monitor"])!.id).toBe("share-window-or-tab");
    expect(captureLogic.nextFallbackStep(["second-monitor", "share-window-or-tab", "compatibility-mode"])!.id).toBe(
      "browser-only",
    );
    expect(captureLogic.nextFallbackStep(captureLogic.FALLBACK_LADDER.map((step: { id: string }) => step.id))).toBeNull();
  });
});

describe("re-assert transitions", () => {
  it("covers every transition named by the O2 mission", () => {
    for (const event of [
      "resize",
      "move",
      "preset-change",
      "profile-change",
      "display-metrics-changed",
      "display-added",
      "display-removed",
      "show",
      "restore",
      "window-recreated",
      "private-mode-changed",
      "compat-mode-changed",
      "manual-assert",
    ]) {
      expect(captureLogic.shouldReassert(event)).toBe(true);
    }
    expect(captureLogic.shouldReassert("unrelated")).toBe(false);
    expect(captureLogic.shouldReassert(null)).toBe(false);
    expect(captureLogic.describeReassert("display-metrics-changed")).toMatch(/DPI/);
  });
});

describe("capture state persistence", () => {
  it("defaults safely", () => {
    expect(captureLogic.parseCaptureState(null)).toEqual(captureLogic.DEFAULT_CAPTURE_STATE);
    expect(captureLogic.parseCaptureState("garbage")).toEqual(captureLogic.DEFAULT_CAPTURE_STATE);
  });

  it("sanitizes persisted values", () => {
    const state = captureLogic.parseCaptureState({
      compatMode: true,
      lastProfile: "reading",
      lastProfileBounds: { x: 10, y: 20, width: 100, height: 50 },
      reportedVisible: true,
      lastSelfCheckAt: 123,
      knownBadCapturePath: "obs",
    });
    expect(state.compatMode).toBe(true);
    expect(state.lastProfile).toBe("reading");
    expect(state.lastProfileBounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(state.knownBadCapturePath).toBe("obs");
    expect(captureLogic.parseCaptureState({ lastProfile: "bogus" }).lastProfile).toBe("card");
  });

  it("round-trips through serialize/parse", () => {
    const state = captureLogic.setCompatMode(captureLogic.DEFAULT_CAPTURE_STATE, true);
    const json = captureLogic.serializeCaptureState(state);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).compatMode).toBe(true);
  });

  it("records a self-check and derives the suggestion", () => {
    const state = captureLogic.recordSelfCheck(captureLogic.DEFAULT_CAPTURE_STATE, {
      reportedVisible: true,
      at: 777,
      overlayAreaRatio: 0.6,
      transparent: true,
    });
    expect(state.reportedVisible).toBe(true);
    expect(state.lastSelfCheckAt).toBe(777);
    expect(state.lastSuggestion.suggest).toBe(true);
    expect(state.lastSuggestion.confidence).toBe("reported");
  });

  it("tracks profiles and known-bad hints immutably", () => {
    const original = captureLogic.DEFAULT_CAPTURE_STATE;
    const profile = captureLogic.setCaptureProfile(original, "banner", { x: 0, y: 16, width: 1920, height: 291 });
    expect(profile.lastProfile).toBe("banner");
    expect(original.lastProfile).toBe("card");
    const hinted = captureLogic.setKnownBadCapturePath(profile, "gdigrab-old");
    expect(hinted.knownBadCapturePath).toBe("gdigrab-old");
    expect(hinted.lastSuggestion.suggest).toBe(true);
  });
});

describe("IPC contract with the Electron shell", () => {
  const electronRoot = path.resolve(import.meta.dirname, "../../../../desktop-electron");

  it("mirrors every capture channel in preload.js", () => {
    const preload = fs.readFileSync(path.join(electronRoot, "preload.js"), "utf8");
    for (const channel of Object.values(captureLogic.CAPTURE_CHANNELS)) {
      expect(preload).toContain('"' + String(channel) + '"');
    }
    expect(preload).toContain("hireshadeCapture");
    expect(preload).toContain("Can they see it?");
    expect(preload).toContain("compatibility");
  });

  it("main.js wires the capture channels and every re-assert transition", () => {
    const main = fs.readFileSync(path.join(electronRoot, "main.js"), "utf8");
    // main.js references the channel map by key (single source of truth); the
    // literal channel strings are mirrored in preload.js above.
    for (const key of Object.keys(captureLogic.CAPTURE_CHANNELS)) {
      expect(main).toContain("CAPTURE_CHANNELS." + key);
    }
    for (const event of ["resize", "move", "preset-change", "profile-change", "display-metrics-changed", "window-recreated"]) {
      expect(main).toContain('"' + event + '"');
    }
    expect(main).toContain("captureLogic.cjs");
  });
});
