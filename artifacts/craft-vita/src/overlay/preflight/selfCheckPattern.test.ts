import { describe, expect, it } from 'vitest';
import {
  SELF_CHECK_CAPTION,
  generateSelfCheckPattern,
  generateSelfCheckPatterns,
  selfCheckPatternDataUrl,
} from './selfCheckPattern';

describe('self-check patterns', () => {
  it('generates both the content-leak and the black-bar-leak pattern', () => {
    const patterns = generateSelfCheckPatterns({ width: 1280, height: 720 });
    expect(patterns.map((pattern) => pattern.kind)).toEqual(['content-leak', 'black-bar-leak']);
    for (const pattern of patterns) {
      expect(pattern.width).toBe(1280);
      expect(pattern.height).toBe(720);
      expect(pattern.svg).toContain('<svg');
      expect(pattern.svg).toContain('data-pattern="' + pattern.kind + '"');
      expect(pattern.html).toContain('hireshade-selfcheck-pattern');
      expect(pattern.caption.toLowerCase().length).toBeGreaterThan(30);
      expect(pattern.caption).toBe(SELF_CHECK_CAPTION[pattern.kind]);
      expect(pattern.contrastRatio).toBeGreaterThanOrEqual(7);
    }
  });

  it('black-bar-leak has a large solid black rectangle plus many high-contrast bars', () => {
    const pattern = generateSelfCheckPattern('black-bar-leak', { width: 1600, height: 900 });
    expect(pattern.barCount).toBeGreaterThanOrEqual(4);
    expect(pattern.blackRect.width).toBeGreaterThan(0.3);
    expect(pattern.blackRect.height).toBeGreaterThan(0.3);
    expect(pattern.blackRect.x).toBeGreaterThan(0);
    expect(pattern.blackRect.y).toBeGreaterThan(0);
    expect(pattern.svg).toContain('data-black-rect="true"');
    expect(pattern.svg).toContain('fill="#ffffff"');
    expect(pattern.svg).toContain('fill="#000000"');
    expect(pattern.caption.toLowerCase()).toContain('black rectangle');
    expect(pattern.caption.toLowerCase()).toContain('invisible');
  });

  it('content-leak pattern is a readable high-contrast checkerboard', () => {
    const pattern = generateSelfCheckPattern('content-leak', { width: 800, height: 600 });
    expect(pattern.barCount).toBe(0);
    expect(pattern.svg).toContain('#000000');
    expect(pattern.svg).toContain('#ffffff');
    expect(pattern.label.toLowerCase()).toContain('content leak');
    expect(pattern.caption.toLowerCase()).toContain('read');
  });

  it('is deterministic and distinct per kind', () => {
    const first = generateSelfCheckPattern('black-bar-leak', { width: 1280, height: 720 });
    const second = generateSelfCheckPattern('black-bar-leak', { width: 1280, height: 720 });
    expect(first.svg).toBe(second.svg);
    const other = generateSelfCheckPattern('content-leak', { width: 1280, height: 720 });
    expect(other.svg).not.toBe(first.svg);
  });

  it('falls back to sane sizes and produces a data URL', () => {
    const pattern = generateSelfCheckPattern('black-bar-leak', { width: Number.NaN, height: -1 });
    expect(pattern.width).toBeGreaterThan(0);
    expect(pattern.height).toBeGreaterThan(0);
    expect(selfCheckPatternDataUrl('black-bar-leak')).toMatch(/^data:image\/svg\+xml/);
  });
});
