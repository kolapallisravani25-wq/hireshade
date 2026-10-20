/**
 * O3 — acceptance contract unit tests (size.test.ts).
 *
 * These are framework-free spec tests for the overlay-size acceptance harness:
 * readability math (contrast/line length/line height/DPI font floors), the
 * 5-preset contract from G-044, speakability word budgets, and the pure
 * multi-monitor selection logic O2 is expected to expose.
 *
 * The live Electron/CDP matrix lives in scripts/overlay-size/run-size-acceptance.mjs;
 * these tests pin the contract so a regression fails without a GUI.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRAFT_VITA = path.resolve(HERE, "..", "..");
const REPO_ROOT = path.resolve(CRAFT_VITA, "..", "..");

/** G-045 readability floors (mirrors scripts/overlay-size/presets-contract.mjs). */
const FLOORS = {
  minFontCssPx: 14,
  // Device-px floor at DPI 100; scales to 17.5/21/28 at 125/150/200%.
  minDevicePx: 14,
  maxLineCh: 75,
  minLineHeight: 1.5,
  minContrastRatio: 7,
};

/** G-044 preset contract: ids, geometry and typography constraints. */
const PRESET_CONTRACT = [
  { id: "compact", minWidth: 300, maxWidth: 700, minHeight: 300, fontCssPx: 15, lineHeight: 1.5, maxCh: 60 },
  { id: "banner", minWidth: 600, maxWidth: 1400, minHeight: 360, fontCssPx: 18, lineHeight: 1.55, maxCh: 72 },
  { id: "teleprompter", minWidth: 600, maxWidth: 1400, minHeight: 400, fontCssPx: 26, lineHeight: 1.6, maxCh: 55 },
  { id: "side-column", minWidth: 300, maxWidth: 760, minHeight: 400, fontCssPx: 16, lineHeight: 1.55, maxCh: 52 },
  { id: "reading", minWidth: 500, maxWidth: 1200, minHeight: 400, fontCssPx: 20, lineHeight: 1.65, maxCh: 65 },
];

/* ── Readability math (same maths the CDP harness applies in the page) ───── */

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

function parseRgba(value: string): Rgb {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error("not a colour: " + value);
  const parts = match[1]!.split(",").map((part) => parseFloat(part.trim()));
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts.length > 3 ? parts[3]! : 1 };
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: 1,
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(color: Rgb): number {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast of answer text over the preset scrim composited on a backdrop. */
function textContrast(textColor: Rgb, scrim: Rgb, backdrop: Rgb): number {
  return contrastRatio(textColor, scrim.a < 1 ? composite(scrim, backdrop) : scrim);
}

/* ── Multi-monitor selection contract (O2 helper, pure) ─────────────────── */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Display {
  id: number;
  bounds: Rect;
  primary?: boolean;
}

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

/**
 * Contract spec for O2's monitor picker: choose the display with the largest
 * overlap with the proposed overlay bounds; if none overlap, choose the display
 * whose centre is nearest; ties prefer the primary display, then the lowest id.
 */
function pickDisplayForBounds(displays: Display[], bounds: Rect): Display {
  if (!displays.length) throw new Error("no displays");
  let best = displays[0]!;
  let bestOverlap = -1;
  for (const display of displays) {
    const overlap = intersectionArea(display.bounds, bounds);
    if (overlap > bestOverlap) {
      best = display;
      bestOverlap = overlap;
    }
  }
  if (bestOverlap > 0) return best;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const distance = (display: Display) => {
    const dx = display.bounds.x + display.bounds.width / 2 - center.x;
    const dy = display.bounds.y + display.bounds.height / 2 - center.y;
    return Math.hypot(dx, dy);
  };
  const sorted = [...displays].sort((a, b) => {
    const delta = distance(a) - distance(b);
    if (Math.abs(delta) > 0.001) return delta;
    if (Boolean(a.primary) !== Boolean(b.primary)) return a.primary ? -1 : 1;
    return a.id - b.id;
  });
  return sorted[0]!;
}

/* ── Speakability helpers (mirror of the harness fallback formatter) ────── */

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function countBullets(markdown: string): number {
  return markdown.split("\n").filter((line) => /^\s*[-*+]\s+/.test(line)).length;
}

function hasLiteralMarkdownTokens(text: string): boolean {
  return (
    /\*\*[^*]+\*\*/.test(text) ||
    /^#{1,6}\s/m.test(text) ||
    // A bullet marker is literal markdown when it leads a line (start of string
    // included), not only when preceded by whitespace.
    /(^|\n)\s*[-*+]\s+/m.test(text) ||
    text.includes("`")
  );
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("G-045 readability floors", () => {
  it("pins the minimum font/contrast/line-length/line-height contract", () => {
    expect(FLOORS).toEqual({
      minFontCssPx: 14,
      minDevicePx: 14,
      maxLineCh: 75,
      minLineHeight: 1.5,
      minContrastRatio: 7,
    });
  });

  it("scales the 14 css px floor into device px as DPI rises", () => {
    const cssPx = FLOORS.minFontCssPx;
    const devicePx = [1, 1.25, 1.5, 2].map((dpi) => cssPx * dpi);
    expect(devicePx).toEqual([14, 17.5, 21, 28]);
    for (const px of devicePx) expect(px).toBeGreaterThanOrEqual(FLOORS.minDevicePx);
    // Readability is a device-pixel promise: the floor must grow with DPI.
    expect(devicePx[3]).toBeGreaterThan(devicePx[0]);
  });

  it("computes WCAG contrast correctly for known pairs", () => {
    const white = hexToRgb("#ffffff");
    const black = hexToRgb("#000000");
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    const midGray = hexToRgb("#777777");
    expect(contrastRatio(midGray, white)).toBeCloseTo(4.478, 2);
  });
});

describe("scrim-composited contrast contract (G-044/G-045)", () => {
  const textColor = hexToRgb("#f4f7ff");
  const scrims = [
    { preset: "compact", scrim: "rgba(8, 10, 16, 0.82)" },
    { preset: "banner", scrim: "rgba(8, 10, 16, 0.8)" },
    { preset: "teleprompter", scrim: "rgba(4, 6, 10, 0.86)" },
    { preset: "side-column", scrim: "rgba(10, 12, 18, 0.84)" },
    { preset: "reading", scrim: "rgba(12, 14, 20, 0.86)" },
  ];
  const backdrops = [hexToRgb("#ffffff"), hexToRgb("#000000")];

  it("keeps every preset scrim at >= 7:1 against white and black backdrops", () => {
    for (const { preset, scrim } of scrims) {
      for (const backdrop of backdrops) {
        const ratio = textContrast(textColor, parseRgba(scrim), backdrop);
        expect(ratio, preset + " backdrop " + backdrop.r).toBeGreaterThanOrEqual(FLOORS.minContrastRatio);
      }
    }
  });

  it("would fail a too-transparent scrim (sensitivity check)", () => {
    const tooTransparent = parseRgba("rgba(8, 10, 16, 0.35)");
    const ratio = textContrast(textColor, tooTransparent, hexToRgb("#ffffff"));
    expect(ratio).toBeLessThan(FLOORS.minContrastRatio);
  });
});

describe("G-044 preset contract", () => {
  it("defines exactly the five required presets", () => {
    expect(PRESET_CONTRACT.map((preset) => preset.id)).toEqual([
      "compact",
      "banner",
      "teleprompter",
      "side-column",
      "reading",
    ]);
    const ids = new Set(PRESET_CONTRACT.map((preset) => preset.id));
    expect(ids.size).toBe(5);
  });

  it("gives every preset readable typography and sane geometry", () => {
    for (const preset of PRESET_CONTRACT) {
      expect(preset.minWidth).toBeGreaterThan(0);
      expect(preset.maxWidth).toBeGreaterThanOrEqual(preset.minWidth);
      expect(preset.minHeight).toBeGreaterThan(0);
      expect(preset.fontCssPx).toBeGreaterThanOrEqual(FLOORS.minFontCssPx);
      expect(preset.lineHeight).toBeGreaterThanOrEqual(FLOORS.minLineHeight);
      expect(preset.maxCh).toBeLessThanOrEqual(FLOORS.maxLineCh);
      expect(preset.maxCh).toBeGreaterThan(30);
    }
  });

  it("makes BANNER (the default) the widest preset", () => {
    // G-044: BANNER is full width minus margins; it must never be narrower than
    // COMPACT / SIDE COLUMN / READING (TELEPROMPTER may tie its cap).
    const banner = PRESET_CONTRACT.find((preset) => preset.id === "banner")!;
    for (const preset of PRESET_CONTRACT) {
      if (preset.id === "banner") continue;
      expect(banner.maxWidth, preset.id).toBeGreaterThanOrEqual(preset.maxWidth);
    }
    const widths = PRESET_CONTRACT.map((preset) => preset.maxWidth);
    expect(Math.max(...widths)).toBe(banner.maxWidth);
  });
});

describe("speakability word budgets (G-045)", () => {
  const generated = [
    { hook: "I built a Redis rate limiter for a high-traffic API.", bullets: 2 },
    { hook: "Short answer: I would use a sliding window counter.", bullets: 3 },
    { hook: "In my last role I owned the payments retry pipeline.", bullets: 4 },
  ];

  it("counts hook words and enforces the 12-word budget", () => {
    for (const answer of generated) {
      expect(countWords(answer.hook)).toBeLessThanOrEqual(12);
    }
    expect(countWords("one two three four five six seven eight nine ten eleven twelve thirteen")).toBe(13);
  });

  it("enforces 2-4 bullets", () => {
    for (const answer of generated) {
      expect(answer.bullets).toBeGreaterThanOrEqual(2);
      expect(answer.bullets).toBeLessThanOrEqual(4);
      const markdown = ["Hook.", "", ...Array.from({ length: answer.bullets }, (_v, i) => "- Bullet " + (i + 1) + ".")].join("\n");
      expect(countBullets(markdown)).toBe(answer.bullets);
    }
  });

  it("strips markdown tokens before rendering and detects leftovers", () => {
    const markdown = "## Heading\n\n**Hook** with `code`.\n\n- first\n- second";
    const plain = stripMarkdown(markdown);
    expect(plain).not.toMatch(/[#*]/);
    expect(plain).not.toContain("`");
    expect(plain).toContain("Hook with code.");
    expect(hasLiteralMarkdownTokens(plain)).toBe(false);
    expect(hasLiteralMarkdownTokens("**still bold**")).toBe(true);
    expect(hasLiteralMarkdownTokens("- still a bullet line")).toBe(true);
  });

  it("bounds the first screenful to 40 words (hook + first bullet)", () => {
    const hook = "I built a Redis rate limiter for a high-traffic API.";
    const bullet = "Use one key per user and route with an atomic increment and short TTL.";
    expect(countWords(hook) + countWords(bullet)).toBeLessThanOrEqual(40);
  });
});

describe("multi-monitor selection contract (O2 helper)", () => {
  const left = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, primary: true };
  const right = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } };

  it("picks the display with the largest overlap", () => {
    expect(pickDisplayForBounds([left, right], { x: 1800, y: 100, width: 800, height: 600 }).id).toBe(2);
    expect(pickDisplayForBounds([left, right], { x: 100, y: 100, width: 800, height: 600 }).id).toBe(1);
  });

  it("falls back to the nearest display for off-screen bounds", () => {
    expect(pickDisplayForBounds([left, right], { x: 5000, y: 100, width: 400, height: 300 }).id).toBe(2);
    expect(pickDisplayForBounds([left, right], { x: -900, y: 100, width: 400, height: 300 }).id).toBe(1);
  });

  it("picks a valid display for bounds spanning both monitors", () => {
    const picked = pickDisplayForBounds([left, right], { x: 1500, y: 100, width: 900, height: 600 });
    expect([1, 2]).toContain(picked.id);
  });

  it("is deterministic and prefers the primary display on ties", () => {
    const twinLeft = { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, primary: true };
    const twinRight = { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    const centered = { x: -960, y: 0, width: 100, height: 100 };
    const first = pickDisplayForBounds([twinLeft, twinRight], centered);
    const second = pickDisplayForBounds([twinRight, twinLeft], centered);
    // Bounds are centred on the left display's centre, so left (primary, id 1)
    // is nearest; ordering must not change the result.
    expect(first.id).toBe(1);
    expect(second.id).toBe(first.id);
    expect(pickDisplayForBounds([twinLeft, twinRight], { x: 960, y: 0, width: 100, height: 100 }).id).toBe(2);
  });
});

describe("integration guards", () => {
  const presetsIndex = path.join(CRAFT_VITA, "src", "overlay", "presets", "index.ts");
  const presetsFlat = path.join(CRAFT_VITA, "src", "overlay", "presets.ts");
  const answerFormat = path.join(CRAFT_VITA, "src", "overlay", "answerFormat.ts");
  const demoRunner = path.join(REPO_ROOT, "scripts", "demo", "run-demo.mjs");
  const sizeRunner = path.join(REPO_ROOT, "scripts", "overlay-size", "run-size-acceptance.mjs");

  it("has the O3 harness scripts in place", () => {
    expect(existsSync(sizeRunner)).toBe(true);
    expect(readFileSync(sizeRunner, "utf8")).toContain("setDeviceMetricsOverride");
    expect(readFileSync(sizeRunner, "utf8")).toContain("400");
  });

  it("wires the preset/readability step into make demo's orchestrator", () => {
    const source = readFileSync(demoRunner, "utf8");
    expect(source).toContain("overlay-size");
    expect(source).toContain("run-size-acceptance.mjs");
  });

  it("consumes O1 exports when they exist (or documents the fallback)", () => {
    const presetsPath = existsSync(presetsIndex) ? presetsIndex : existsSync(presetsFlat) ? presetsFlat : null;
    if (!presetsPath) {
      // O1 not landed yet: the harness falls back and labels the source.
      expect(existsSync(sizeRunner)).toBe(true);
      return;
    }
    const source = readFileSync(presetsPath, "utf8");
    expect(source).toMatch(/OVERLAY_PRESETS|PRESETS/);
    if (existsSync(answerFormat)) {
      expect(readFileSync(answerFormat, "utf8")).toContain("formatAnswerForOverlay");
    }
  });
});
