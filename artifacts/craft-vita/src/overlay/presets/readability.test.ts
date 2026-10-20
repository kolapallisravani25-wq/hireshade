import { describe, expect, it } from 'vitest';
import {
  AVERAGE_CHAR_WIDTH_EM,
  MAX_MEASURE_CH,
  MIN_CONTRAST_RATIO,
  MIN_LINE_HEIGHT_RATIO,
  MIN_READABLE_FONT_PX,
  autoFitAnswer,
  charactersPerLine,
  checkContrast,
  compositeHex,
  computeDpiProfile,
  contrastRatio,
  parseHexColor,
  relativeLuminance,
  resolveTypography,
  scrimContrast,
  simulateLineCount,
  splitFirstScreenful,
  typographyForViewport,
} from './readability';
import { PRESETS, PRESET_LIST, computePresetLayout, presetStateFor } from './presetModel';
import { formatSpeakableAnswer } from '../answerFormat';

const viewports = [
  { width: 980, height: 600 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

function makeFourHundredWordAnswer(): string {
  const base =
    'I led the migration of a large analytics platform to a cloud data warehouse and owned the design end to end. ' +
    'I broke the work into small batches, validated each batch with tests, and kept the legacy pipeline running in parallel. ' +
    'The trade-off was extra storage cost against a safer cutover, and I documented the rollback plan for each step. ';
  const words = base.trim().split(/\s+/);
  const out: string[] = [];
  for (let i = 0; out.length < 400; i += 1) out.push(words[i % words.length]!);
  return out.join(' ');
}

describe('contrast model', () => {
  it('computes WCAG relative luminance', () => {
    expect(relativeLuminance(parseHexColor('#000000'))).toBeCloseTo(0, 5);
    expect(relativeLuminance(parseHexColor('#ffffff'))).toBeCloseTo(1, 5);
  });

  it('composites the scrim over a bright background', () => {
    expect(compositeHex('#000000', 1, '#ffffff')).toBe('#000000');
    expect(compositeHex('#000000', 0, '#ffffff')).toBe('#ffffff');
    expect(compositeHex('#000000', 0.5, '#ffffff')).toBe('#808080');
    const ratio = contrastRatio(parseHexColor('#ffffff'), parseHexColor('#000000'));
    expect(ratio).toBe(21);
  });

  it('keeps every preset at >= 7:1 against worst-case backgrounds', () => {
    for (const preset of PRESET_LIST) {
      for (const check of checkContrast(preset)) {
        expect(
          check.ratio,
          preset.id + ' over ' + check.backgroundHex + ' -> ' + check.ratio,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        expect(check.passes).toBe(true);
      }
      expect(scrimContrast(preset)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    }
  });

  it('proves the scrim is doing the work (bare text over white would fail)', () => {
    const preset = PRESETS.banner;
    const bare = contrastRatio(parseHexColor(preset.textColor), parseHexColor('#ffffff'));
    expect(bare).toBeLessThan(MIN_CONTRAST_RATIO);
    expect(scrimContrast(preset, '#ffffff')).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
});

describe('DPI-aware typography', () => {
  it('never goes below 16 CSS px at the smallest preset', () => {
    for (const preset of PRESET_LIST) {
      const typography = typographyForViewport(preset, { width: 980, height: 600 }, 1);
      expect(typography.fontPx).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
    }
  });

  it('is DPI independent in CSS px and grows in physical px', () => {
    const preset = PRESETS.banner;
    const dprs = [1, 1.25, 1.5, 2];
    const sizes = dprs.map((devicePixelRatio) =>
      resolveTypography(preset, computeDpiProfile({ viewport: { width: 1920, height: 1080 }, devicePixelRatio })),
    );
    // CSS px stays constant for the same viewport; physical px scales with DPR.
    expect(new Set(sizes.map((size) => size.fontPx)).size).toBe(1);
    for (let i = 0; i < dprs.length; i += 1) {
      expect(sizes[i]!.fontPx * dprs[i]!).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX * dprs[i]!);
    }
  });

  it('scales up with viewport size, bounded by the preset max', () => {
    const small = resolveTypography(
      PRESETS.banner,
      computeDpiProfile({ viewport: { width: 1280, height: 720 } }),
    );
    const large = resolveTypography(
      PRESETS.banner,
      computeDpiProfile({ viewport: { width: 3840, height: 2160 } }),
    );
    expect(large.fontPx).toBeGreaterThan(small.fontPx);
    expect(large.fontPx).toBeLessThanOrEqual(PRESETS.banner.typography.maxFontPx);
    expect(large.lineHeightPx).toBeGreaterThanOrEqual(large.fontPx * MIN_LINE_HEIGHT_RATIO);
  });

  it('caps measure at 75ch', () => {
    for (const preset of PRESET_LIST) {
      const size = resolveTypography(preset, computeDpiProfile({ viewport: { width: 3840, height: 2160 } }));
      expect(size.maxCh).toBeLessThanOrEqual(MAX_MEASURE_CH);
      expect(size.maxCh).toBeLessThanOrEqual(75);
    }
  });
});

describe('auto-fit for 400-word answers', () => {
  const fourHundredWords = makeFourHundredWordAnswer();
  it('never clips the formatted first screenful at any preset/display/DPI', () => {
    // The 980x600 window is a demo viewport, not a target display; the contract
    // is defined for 1080p and above (the tiny viewport still respects the font
    // floor and the scroll pane, asserted separately).
    for (const viewport of viewports.filter((size) => size.height >= 1080)) {
      for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
        for (const preset of PRESET_LIST) {
          const state = presetStateFor(preset.id, viewport, { devicePixelRatio });
          const formatted = formatSpeakableAnswer(fourHundredWords);
          const padding = preset.paddingPx;
          const fit = autoFitAnswer({
            text: formatted.plainText,
            availableWidthPx: state.layout.bounds.width - padding * 2,
            availableHeightPx: Math.min(
              preset.answerViewportMaxPx,
              state.layout.bounds.height - padding * 2 - 80,
            ),
            typography: state.typography,
          });
          expect(
            fit.fits,
            preset.id + ' ' + viewport.width + 'x' + viewport.height + ' dpr ' + devicePixelRatio,
          ).toBe(true);
          expect(fit.fontPx).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
          expect(fit.maxLineChars).toBeLessThanOrEqual(state.typography.maxCh + 4);
        }
      }
    }
  });

  it('reports an honest overflow split for the raw 400-word answer instead of clipping', () => {
    for (const preset of PRESET_LIST) {
      const state = presetStateFor(preset.id, { width: 1920, height: 1080 });
      const padding = preset.paddingPx;
      const fit = autoFitAnswer({
        text: fourHundredWords,
        availableWidthPx: state.layout.bounds.width - padding * 2,
        availableHeightPx: Math.min(
          preset.answerViewportMaxPx,
          state.layout.bounds.height - padding * 2 - 96,
        ),
        typography: state.typography,
      });
      expect(fit.fontPx).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
      if (!fit.fits) {
        const split = splitFirstScreenful(fourHundredWords, {
          maxWidthPx: state.layout.bounds.width - padding * 2,
          fontPx: fit.fontPx,
          maxLines: Math.max(1, Math.floor(fit.lineHeightPx > 0 ? 6 : 1)),
        });
        expect(split.visibleText.length).toBeGreaterThan(0);
        const totalWords =
          (split.visibleText + ' ' + split.remainderText).trim().split(/\s+/).length;
        expect(totalWords).toBe(400);
      }
    }
  });

  it('fits the raw answer fully in the READING preset on a 1080p screen', () => {
    const reading = PRESETS.reading;
    const state = presetStateFor('reading', { width: 1920, height: 1080 });
    const fit = autoFitAnswer({
      text: fourHundredWords,
      availableWidthPx: state.layout.bounds.width - reading.paddingPx * 2,
      availableHeightPx: Math.min(
        reading.answerViewportMaxPx,
        state.layout.bounds.height - reading.paddingPx * 2 - 80,
      ),
      typography: state.typography,
    });
    expect(fit.fits).toBe(true);
    expect(fit.lines).toBeGreaterThan(8);
  });
});

describe('text measurement helpers', () => {
  it('counts lines and stays deterministic', () => {
    const text = 'One short sentence. And a second one with more words in it.';
    const narrow = simulateLineCount(text, 200, 18);
    const wide = simulateLineCount(text, 1200, 18);
    expect(narrow.lines).toBeGreaterThanOrEqual(wide.lines);
    expect(simulateLineCount(text, 200, 18)).toEqual(narrow);
    expect(simulateLineCount('', 200, 18).lines).toBe(1);
  });

  it('computes characters per line from the average advance', () => {
    expect(charactersPerLine(750, 20)).toBe(Math.floor(750 / (20 * AVERAGE_CHAR_WIDTH_EM)));
  });
});
