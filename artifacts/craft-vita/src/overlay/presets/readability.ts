/**
 * Readability model for overlay presets (O1 / EXT G-044).
 *
 * Pure math only - no DOM. The DOM adapter applies these values once per
 * preset/resize; the Electron/CDP harness asserts the resulting computed styles.
 *
 * Contracts encoded here:
 *   - answer font never below 16 CSS px, on any preset at 1080p/100%;
 *   - font grows with viewport density/DPI, never shrinks below the floor;
 *   - line-height >= 1.5;
 *   - measure (line length) <= 75ch;
 *   - text/scrim contrast >= 7:1 against worst-case bright backgrounds;
 *   - auto-fit shrinks type to the box and reports the overflow split instead of
 *     clipping/ellipsis/horizontal scroll.
 */
import type {
  DpiProfile,
  OverlayPreset,
  ResolvedTypography,
  ViewportSize,
} from "./types";

export const MIN_READABLE_FONT_PX = 16;
export const MIN_LINE_HEIGHT_RATIO = 1.5;
export const MAX_MEASURE_CH = 75;
export const MIN_CONTRAST_RATIO = 7;

// --- DPI / viewport profile -------------------------------------------------

export function densityFor(viewport: ViewportSize): DpiProfile["density"] {
  const longest = Math.max(viewport.width, viewport.height);
  if (longest < 900) return "sm";
  if (longest < 1440) return "md";
  if (longest < 2200) return "lg";
  return "xl";
}

/**
 * CSS px are DIPs, so the font floor is expressed in CSS px; the device pixel
 * ratio only changes the physical pixel size (fontPx * dpr), which is what the
 * 'scales with DPI' contract means. fontScale makes larger displays use larger
 * type instead of returning a tiny measure in the middle of a 4K screen.
 */
export function computeDpiProfile(input: {
  viewport: ViewportSize;
  devicePixelRatio?: number;
}): DpiProfile {
  const width = Math.max(1, Math.round(input.viewport.width));
  const height = Math.max(1, Math.round(input.viewport.height));
  const dpr = Number.isFinite(input.devicePixelRatio)
    ? Math.max(0.5, Math.min(4, Number(input.devicePixelRatio)))
    : 1;
  const diagonal = Math.sqrt(width * width + height * height);
  // 1920x1080 reference diagonal ~= 2203; clamp to a 0.9 - 1.25 band so a tiny
  // demo window still renders legible type (the min font floor handles the rest).
  const rawScale = diagonal / 2203;
  const fontScale = Math.round(Math.min(1.25, Math.max(0.9, rawScale)) * 100) / 100;
  return {
    viewport: { width, height },
    devicePixelRatio: dpr,
    density: densityFor({ width, height }),
    fontScale,
  };
}

// --- Typography -------------------------------------------------------------

export function resolveTypography(
  preset: OverlayPreset,
  profile: DpiProfile,
): ResolvedTypography {
  const spec = preset.typography;
  const scaled = Math.round(spec.baseFontPx * profile.fontScale);
  const fontPx = Math.max(
    MIN_READABLE_FONT_PX,
    spec.minFontPx,
    Math.min(spec.maxFontPx, scaled),
  );
  const lineHeightRatio = Math.max(MIN_LINE_HEIGHT_RATIO, spec.lineHeightRatio);
  const maxCh = Math.max(20, Math.min(MAX_MEASURE_CH, spec.maxCh));
  return {
    fontPx,
    hookFontPx: Math.max(fontPx, Math.round(fontPx * Math.max(1, spec.hookScale))),
    bulletFontPx: Math.max(MIN_READABLE_FONT_PX, Math.round(fontPx * 0.96)),
    lineHeightPx: Math.round(fontPx * lineHeightRatio),
    lineHeightRatio,
    maxCh,
    minFontPx: MIN_READABLE_FONT_PX,
  };
}

/** Recomputed after a resize: the font must stay inside the preset's clamps. */
export function typographyForViewport(
  preset: OverlayPreset,
  viewport: ViewportSize,
  devicePixelRatio = 1,
): ResolvedTypography {
  return resolveTypography(preset, computeDpiProfile({ viewport, devicePixelRatio }));
}

// --- Colour / contrast ------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHexColor(input: string): Rgb {
  const value = input.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((part) => part + part)
          .join("")
      : value;
  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error("Invalid hex colour: " + input);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const c = Math.max(0, Math.min(255, channel)) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channelToLinear(color.r) +
    0.7152 * channelToLinear(color.g) +
    0.0722 * channelToLinear(color.b)
  );
}

/** sRGB alpha compositing (matches CSS default compositing). */
export function compositeColor(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return {
    r: a * top.r + (1 - a) * bottom.r,
    g: a * top.g + (1 - a) * bottom.g,
    b: a * top.b + (1 - a) * bottom.b,
  };
}

export function compositeHex(
  topHex: string,
  alpha: number,
  bottomHex: string,
): string {
  const mixed = compositeColor(parseHexColor(topHex), alpha, parseHexColor(bottomHex));
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return "#" + toHex(mixed.r) + toHex(mixed.g) + toHex(mixed.b);
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lf = relativeLuminance(foreground);
  const lb = relativeLuminance(background);
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * Contrast of the overlay text against the scrim composited over a background.
 * Default background is pure white - the worst case over a bright video frame.
 */
export function scrimContrast(
  preset: Pick<OverlayPreset, "textColor" | "scrimColor" | "scrimAlpha">,
  backgroundHex = "#ffffff",
): number {
  const composited = compositeColor(
    parseHexColor(preset.scrimColor),
    preset.scrimAlpha,
    parseHexColor(backgroundHex),
  );
  return contrastRatio(parseHexColor(preset.textColor), composited);
}

export interface ContrastCheck {
  ratio: number;
  passes: boolean;
  backgroundHex: string;
  compositedHex: string;
}

export function checkContrast(
  preset: Pick<OverlayPreset, "textColor" | "scrimColor" | "scrimAlpha">,
  backgrounds: readonly string[] = ["#ffffff", "#e8eefc", "#000000"],
): ContrastCheck[] {
  return backgrounds.map((backgroundHex) => {
    const ratio = scrimContrast(preset, backgroundHex);
    return {
      ratio,
      passes: ratio >= MIN_CONTRAST_RATIO,
      backgroundHex,
      compositedHex: compositeHex(preset.scrimColor, preset.scrimAlpha, backgroundHex),
    };
  });
}

// --- Measure / auto-fit -----------------------------------------------------

/**
 * Approximate glyph advance in em for a UI sans stack at normal weight. The
 * auto-fit loop only needs a stable relative measure; the DOM adapter's CSS
 * (max-width in ch, word-wrap) is the source of truth for actual wrapping.
 */
export const AVERAGE_CHAR_WIDTH_EM = 0.52;

const NARROW = new Set(["i", "l", "j", "t", "f", "r", " ", ".", ",", "'", "|", "!"]);
const WIDE = new Set(["m", "w", "M", "W", "\u2014", "\u2013", "@"]);

export function charWidthEm(char: string): number {
  if (NARROW.has(char)) return 0.3;
  if (WIDE.has(char)) return 0.85;
  if (/[A-Z]/.test(char)) return 0.62;
  if (/[0-9]/.test(char)) return 0.55;
  return AVERAGE_CHAR_WIDTH_EM;
}

export function textWidthEm(text: string): number {
  let total = 0;
  for (const char of text) total += charWidthEm(char);
  return total;
}

/** Greedy word-wrap simulation; returns line count for a block of text. */
export function simulateLineCount(
  text: string,
  maxWidthPx: number,
  fontPx: number,
): { lines: number; maxLineChars: number } {
  const lines = text.split(/\n/);
  let totalLines = 0;
  let widestChars = 0;
  for (const line of lines) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      totalLines += 1;
      continue;
    }
    let currentEm = 0;
    let currentChars = 0;
    let lineCount = 1;
    for (const word of words) {
      const wordEm = textWidthEm(word);
      const spaceEm = currentEm > 0 ? charWidthEm(" ") : 0;
      if (currentEm + spaceEm + wordEm > maxWidthPx / fontPx && currentEm > 0) {
        widestChars = Math.max(widestChars, currentChars);
        lineCount += 1;
        currentEm = wordEm;
        currentChars = word.length;
      } else {
        currentEm += spaceEm + wordEm;
        currentChars += (spaceEm > 0 ? 1 : 0) + word.length;
      }
    }
    widestChars = Math.max(widestChars, currentChars);
    totalLines += lineCount;
  }
  return { lines: totalLines, maxLineChars: widestChars };
}

export interface AutoFitInput {
  readonly text: string;
  readonly availableWidthPx: number;
  readonly availableHeightPx: number;
  readonly typography: ResolvedTypography;
  /** Extra vertical space used by the hook line/bullet gaps (default 0). */
  readonly extraHeightPx?: number;
}

export interface AutoFitResult {
  readonly fontPx: number;
  readonly hookFontPx: number;
  readonly bulletFontPx: number;
  readonly lineHeightPx: number;
  readonly lineHeightRatio: number;
  readonly maxCh: number;
  readonly lines: number;
  readonly contentHeightPx: number;
  readonly fits: boolean;
  readonly overflowPx: number;
  readonly maxLineChars: number;
}

/** Auto-fit: shrink type from the resolved size down to 16px until the block fits. */
export function autoFitAnswer(input: AutoFitInput): AutoFitResult {
  const { text, availableWidthPx, availableHeightPx, typography } = input;
  const extraHeight = Math.max(0, input.extraHeightPx ?? 0);
  const safeWidth = Math.max(80, availableWidthPx);
  const safeHeight = Math.max(40, availableHeightPx);
  const minFont = Math.max(MIN_READABLE_FONT_PX, typography.minFontPx);

  let chosen: AutoFitResult | null = null;
  for (let fontPx = typography.fontPx; fontPx >= minFont; fontPx -= 1) {
    const maxByCh = Math.floor(typography.maxCh * AVERAGE_CHAR_WIDTH_EM * fontPx);
    const effectiveWidth = Math.min(safeWidth, Math.max(120, maxByCh));
    const lineHeightRatio = Math.max(MIN_LINE_HEIGHT_RATIO, typography.lineHeightRatio);
    const lineHeightPx = Math.round(fontPx * lineHeightRatio);
    const { lines, maxLineChars } = simulateLineCount(text, effectiveWidth, fontPx);
    const contentHeightPx = lines * lineHeightPx + extraHeight;
    const hookScale = typography.hookFontPx / typography.fontPx;
    const result: AutoFitResult = {
      fontPx,
      hookFontPx: Math.max(fontPx, Math.round(fontPx * hookScale)),
      bulletFontPx: Math.max(minFont, Math.round(fontPx * 0.96)),
      lineHeightPx,
      lineHeightRatio,
      maxCh: typography.maxCh,
      lines,
      contentHeightPx,
      fits: contentHeightPx <= safeHeight,
      overflowPx: Math.max(0, contentHeightPx - safeHeight),
      maxLineChars,
    };
    chosen = result;
    if (result.fits) return result;
  }
  return chosen!;
}

/**
 * Splits a text block into the largest prefix that fits in maxLines lines plus
 * the remainder. Used so a 400-word answer is never clipped: the first screenful
 * is fully rendered, the rest flows into the existing auto-scroll pane.
 */
export function splitFirstScreenful(
  text: string,
  args: { maxWidthPx: number; fontPx: number; maxLines: number },
): { visibleText: string; remainderText: string } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { visibleText: "", remainderText: "" };
  let visible: string[] = [];
  for (const word of words) {
    const candidate = [...visible, word].join(" ");
    const { lines } = simulateLineCount(candidate, args.maxWidthPx, args.fontPx);
    if (lines > args.maxLines) break;
    visible = [...visible, word];
  }
  if (visible.length === 0) visible = words.slice(0, 1);
  const remainder = words.slice(visible.length);
  return { visibleText: visible.join(" "), remainderText: remainder.join(" ") };
}

/** Number of ch units that fit in a px width at a font size. */
export function charactersPerLine(widthPx: number, fontPx: number): number {
  return Math.max(1, Math.floor(widthPx / (fontPx * AVERAGE_CHAR_WIDTH_EM)));
}
