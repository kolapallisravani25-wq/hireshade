import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_SETTINGS,
  OPACITY_DEFAULT,
  OPACITY_MAX,
  OPACITY_MIN,
  SELECTABLE_POSITION_PRESETS,
  applyOpacity,
  boundsForPreset,
  clampOpacity,
  clampToWorkArea,
  computePresetPosition,
  defaultPresetFor,
  isPositionPreset,
  isRect,
  isSelectablePositionPreset,
  nudgeBounds,
  parseSettings,
  parseSettingsJson,
  recordBounds,
  recordPresetBounds,
  rectEquals,
  sanitizeRect,
  serializeSettings,
  setClickThrough,
  setPositionPreset,
  setPrivateMode,
  stepOpacity,
} from "./overlayGeometry";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const floatingSize = { width: 700, height: 360 };

describe("opacity", () => {
  it("clamps and rounds user opacity", () => {
    expect(clampOpacity(0.05)).toBe(OPACITY_MIN);
    expect(clampOpacity(2)).toBe(OPACITY_MAX);
    expect(clampOpacity(Number.NaN)).toBe(OPACITY_DEFAULT);
    expect(clampOpacity(0.634)).toBe(0.63);
    expect(clampOpacity(1)).toBe(1);
  });

  it("steps opacity inside bounds", () => {
    const dimmed = stepOpacity({ ...DEFAULT_OVERLAY_SETTINGS, opacity: OPACITY_MIN }, -0.05);
    expect(dimmed.opacity).toBe(OPACITY_MIN);
    const brightened = stepOpacity({ ...DEFAULT_OVERLAY_SETTINGS, opacity: 0.5 }, 0.05);
    expect(brightened.opacity).toBe(0.55);
    expect(applyOpacity(DEFAULT_OVERLAY_SETTINGS, 0.42).opacity).toBe(0.42);
  });
});

describe("position presets", () => {
  it("computes every preset against the work area", () => {
    expect(computePresetPosition(workArea, floatingSize, "top-left")).toEqual({ x: 16, y: 16 });
    expect(computePresetPosition(workArea, floatingSize, "top-right")).toEqual({ x: 1204, y: 16 });
    expect(computePresetPosition(workArea, floatingSize, "top-center")).toEqual({ x: 610, y: 16 });
    expect(computePresetPosition(workArea, floatingSize, "center")).toEqual({ x: 610, y: 340 });
    expect(computePresetPosition(workArea, floatingSize, "bottom-left")).toEqual({ x: 16, y: 664 });
    expect(computePresetPosition(workArea, floatingSize, "bottom-center")).toEqual({ x: 610, y: 664 });
    expect(computePresetPosition(workArea, floatingSize, "bottom-right")).toEqual({ x: 1204, y: 664 });
  });

  it("handles multi-monitor negative origins", () => {
    const leftMonitor = { x: -1920, y: -200, width: 1920, height: 1080 };
    expect(computePresetPosition(leftMonitor, floatingSize, "top-left")).toEqual({ x: -1904, y: -184 });
    const center = computePresetPosition(leftMonitor, floatingSize, "center");
    expect(center.x).toBe(-1920 + (1920 - 700) / 2);
    expect(center.y).toBe(-200 + (1080 - 360) / 2);
  });

  it("clamps oversized / off-screen windows into the work area", () => {
    const huge = { width: 2400, height: 1400 };
    const position = computePresetPosition(workArea, huge, "center");
    expect(position).toEqual({ x: 0, y: 0 });
    expect(clampToWorkArea({ x: 5000, y: -5000 }, floatingSize, workArea)).toEqual({
      x: 1220,
      y: 0,
    });
  });

  it("returns full bounds and preserves size when it fits", () => {
    expect(boundsForPreset(workArea, floatingSize, "top-right")).toEqual({
      x: 1204,
      y: 16,
      width: 700,
      height: 360,
    });
    expect(boundsForPreset(workArea, { width: 5000, height: 5000 }, "center").width).toBe(1920);
  });

  it("nudges within the work area", () => {
    const base = { x: 100, y: 100, width: 700, height: 360 };
    expect(nudgeBounds(base, { x: 24, y: -24 }, workArea)).toEqual({
      x: 124,
      y: 76,
      width: 700,
      height: 360,
    });
    expect(nudgeBounds({ ...base, x: 0, y: 0 }, { x: -24, y: -24 }, workArea)).toEqual({
      x: 0,
      y: 0,
      width: 700,
      height: 360,
    });
    expect(nudgeBounds({ ...base, x: 1220, y: 680 }, { x: 500, y: 500 }, workArea)).toEqual({
      x: 1220,
      y: 680,
      width: 700,
      height: 360,
    });
  });

  it("validates preset names", () => {
    expect(SELECTABLE_POSITION_PRESETS).toHaveLength(7);
    expect(isPositionPreset("top-center")).toBe(true);
    expect(isPositionPreset("custom")).toBe(true);
    expect(isPositionPreset("diagonal")).toBe(false);
    expect(isSelectablePositionPreset("custom")).toBe(false);
    expect(isSelectablePositionPreset("bottom-right")).toBe(true);
    expect(setPositionPreset(DEFAULT_OVERLAY_SETTINGS, "custom").positionPreset).toBe("custom");
    expect(defaultPresetFor("launcher")).toBe("center");
    expect(defaultPresetFor("floating")).toBe("top-center");
  });
});

describe("rect helpers", () => {
  it("validates and sanitizes rects", () => {
    expect(isRect({ x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(isRect({ x: 0, y: 0, width: 0, height: 10 })).toBe(false);
    expect(isRect({ x: "0", y: 0, width: 10, height: 10 })).toBe(false);
    expect(sanitizeRect({ x: 1.4, y: 2.6, width: 10.2, height: 0.2 })).toEqual({
      x: 1,
      y: 3,
      width: 10,
      height: 1,
    });
    expect(sanitizeRect("nope")).toBeNull();
    expect(rectEquals({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(rectEquals(null, { x: 1, y: 2, width: 3, height: 4 })).toBe(false);
  });
});

describe("settings persistence", () => {
  it("returns defaults for missing or malformed input", () => {
    expect(parseSettings(null)).toEqual({ ...DEFAULT_OVERLAY_SETTINGS });
    expect(parseSettings("garbage")).toEqual({ ...DEFAULT_OVERLAY_SETTINGS });
    expect(parseSettingsJson("")).toEqual({ ...DEFAULT_OVERLAY_SETTINGS });
    expect(parseSettingsJson("{not json")).toEqual({ ...DEFAULT_OVERLAY_SETTINGS });
  });

  it("sanitizes untrusted persisted values", () => {
    const parsed = parseSettings({
      version: 99,
      opacity: 5,
      clickThrough: "yes",
      isPrivate: false,
      positionPreset: "diagonal",
      bounds: {
        floating: { x: 10, y: 20, width: 700, height: 360 },
        launcher: { x: 0, y: 0, width: -1, height: 10 },
        rogue: { x: 0, y: 0, width: 10, height: 10 },
      },
      hotkeys: { "toggle-overlay": "  CommandOrControl+Alt+T  ", bogus: 42 },
    });
    expect(parsed.version).toBe(1);
    expect(parsed.opacity).toBe(OPACITY_MAX);
    expect(parsed.clickThrough).toBe(true);
    expect(parsed.isPrivate).toBe(false);
    expect(parsed.positionPreset).toBe("top-center");
    expect(parsed.bounds).toEqual({
      floating: { x: 10, y: 20, width: 700, height: 360 },
    });
    expect(parsed.hotkeys).toEqual({ "toggle-overlay": "CommandOrControl+Alt+T" });
  });

  it("round-trips through serialize/parse", () => {
    const settings = recordBounds(
      { ...DEFAULT_OVERLAY_SETTINGS, opacity: 0.55, isPrivate: false },
      "floating",
      { x: 12, y: 34, width: 700, height: 360 },
    );
    const json = serializeSettings(settings);
    expect(json.endsWith("\n")).toBe(true);
    expect(parseSettingsJson(json)).toEqual(JSON.parse(json));
  });

  it("records bounds and demotes the preset label only on manual moves", () => {
    const manual = recordBounds(DEFAULT_OVERLAY_SETTINGS, "floating", {
      x: 1,
      y: 2,
      width: 700,
      height: 360,
    });
    expect(manual.positionPreset).toBe("custom");
    expect(manual.bounds.floating).toEqual({ x: 1, y: 2, width: 700, height: 360 });

    const preset = recordPresetBounds(DEFAULT_OVERLAY_SETTINGS, "floating", {
      x: 610,
      y: 16,
      width: 700,
      height: 360,
    });
    expect(preset.positionPreset).toBe("top-center");

    const launcherMove = recordBounds(DEFAULT_OVERLAY_SETTINGS, "launcher", {
      x: 5,
      y: 6,
      width: 480,
      height: 680,
    });
    expect(launcherMove.positionPreset).toBe("top-center");
    expect(launcherMove.bounds.launcher).toEqual({ x: 5, y: 6, width: 480, height: 680 });
  });

  it("toggles click-through and private mode immutably", () => {
    const disabled = setClickThrough(DEFAULT_OVERLAY_SETTINGS, false);
    expect(disabled.clickThrough).toBe(false);
    expect(DEFAULT_OVERLAY_SETTINGS.clickThrough).toBe(true);
    const unprivate = setPrivateMode(DEFAULT_OVERLAY_SETTINGS, false);
    expect(unprivate.isPrivate).toBe(false);
    expect(DEFAULT_OVERLAY_SETTINGS.isPrivate).toBe(true);
  });
});
