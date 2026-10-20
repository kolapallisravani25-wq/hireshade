/**
 * Self-check patterns (S3 extension of the O2 self-check).
 *
 * Two high-contrast patterns:
 *   content-leak  - checkerboard + readable label: if the shared view shows the
 *                   label, the overlay content is leaking.
 *   black-bar-leak - white bars/stripes around a large SOLID BLACK rectangle.
 *                   In the shared view the black rectangle should be invisible;
 *                   bright bars appearing inside/around that region make a
 *                   capture-path leak unmistakable (and work even when the app
 *                   background is itself dark).
 *
 * The patterns are pure strings (SVG + CSS) so main/preload/renderer can use the
 * same source of truth after a build step (see docs/evidence/capture-sprint/preflight).
 */

export type SelfCheckPatternKind = 'content-leak' | 'black-bar-leak';

export interface SelfCheckPatternOptions {
  readonly width?: number;
  readonly height?: number;
  readonly label?: string;
}

export interface SelfCheckPattern {
  readonly kind: SelfCheckPatternKind;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly caption: string;
  readonly svg: string;
  /** Normalized rect (0..1 of width/height) that should read as pure black. */
  readonly blackRect: { x: number; y: number; width: number; height: number };
  readonly barCount: number;
  /** White-on-black contrast (21 for pure #fff / #000). */
  readonly contrastRatio: number;
  readonly html: string;
}

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const BAR_PX = 48;

export const SELF_CHECK_CAPTION = {
  'content-leak':
    'If you can read the HireShade label in the shared screen, this capture path is showing the overlay.',
  'black-bar-leak':
    'The big black rectangle should be invisible in the shared view. If you see bright bars or the black rectangle, the overlay is being captured - switch to a window/tab share or move HireShade to the other display.',
} as const;

function normalizeSize(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.round(Number(value)) : fallback;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Generates the SVG + metadata for a self-check pattern. Deterministic. */
export function generateSelfCheckPattern(
  kind: SelfCheckPatternKind,
  options: SelfCheckPatternOptions = {},
): SelfCheckPattern {
  const width = normalizeSize(options.width, FALLBACK_WIDTH);
  const height = normalizeSize(options.height, FALLBACK_HEIGHT);
  const label =
    options.label ??
    (kind === 'black-bar-leak' ? 'BLACK BAR LEAK TEST' : 'HIRESHADE TEST - CONTENT LEAK');

  if (kind === 'content-leak') {
    const cell = Math.max(32, Math.round(Math.min(width, height) / 9));
    const rects: string[] = [];
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        const dark = (x / cell + y / cell) % 2 === 0;
        rects.push(
          '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + (dark ? '#000000' : '#ffffff') + '"/>',
        );
      }
    }
    const textX = width / 2;
    const textY = height / 2;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" data-pattern="content-leak">' +
      rects.join('') +
      '<rect x="' + Math.round(width * 0.08) + '" y="' + Math.round(height * 0.38) + '" width="' + Math.round(width * 0.84) + '" height="' + Math.round(height * 0.24) + '" fill="#000000" stroke="#ffffff" stroke-width="6"/>' +
      '<text x="' + textX + '" y="' + textY + '" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="' + Math.round(height * 0.07) + '" font-weight="700" text-anchor="middle" dominant-baseline="middle">' + escapeXml(label) + '</text>' +
      '</svg>';
    return {
      kind,
      width,
      height,
      label,
      caption: SELF_CHECK_CAPTION['content-leak'],
      svg,
      blackRect: {
        x: Math.round(width * 0.08) / width,
        y: Math.round(height * 0.38) / height,
        width: Math.round(width * 0.84) / width,
        height: Math.round(height * 0.24) / height,
      },
      barCount: 0,
      contrastRatio: 21,
      html:
        '<div class="hireshade-selfcheck-pattern" data-pattern="content-leak" role="img" aria-label="' + escapeXml(label) + '">' + svg + '</div>',
    };
  }

  // black-bar-leak: white bars on black, with a large solid black rectangle.
  const barCount = Math.max(4, Math.floor(width / BAR_PX));
  const bars: string[] = [];
  for (let index = 0; index < barCount; index += 1) {
    const x = index * BAR_PX;
    bars.push('<rect x="' + x + '" y="0" width="' + Math.round(BAR_PX / 2) + '" height="' + height + '" fill="#ffffff"/>');
  }
  const blackHeight = Math.round(height * 0.5);
  const blackWidth = Math.round(width * 0.6);
  const blackX = Math.round((width - blackWidth) / 2);
  const blackY = Math.round((height - blackHeight) / 2);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" data-pattern="black-bar-leak">' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#000000"/>' +
    bars.join('') +
    '<rect x="' + blackX + '" y="' + blackY + '" width="' + blackWidth + '" height="' + blackHeight + '" fill="#000000" stroke="#ffffff" stroke-width="10" data-black-rect="true"/>' +
    '<text x="' + (blackX + blackWidth / 2) + '" y="' + (blackY + blackHeight / 2) + '" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="' + Math.round(height * 0.06) + '" font-weight="700" text-anchor="middle" dominant-baseline="middle">' + escapeXml(label) + '</text>' +
    '</svg>';
  return {
    kind,
    width,
    height,
    label,
    caption: SELF_CHECK_CAPTION['black-bar-leak'],
    svg,
    blackRect: {
      x: blackX / width,
      y: blackY / height,
      width: blackWidth / width,
      height: blackHeight / height,
    },
    barCount,
    contrastRatio: 21,
    html:
      '<div class="hireshade-selfcheck-pattern" data-pattern="black-bar-leak" role="img" aria-label="' + escapeXml(label) + '">' + svg + '</div>',
  };
}

/** data: URL for <img src> / CSS background use. */
export function selfCheckPatternDataUrl(
  kind: SelfCheckPatternKind,
  options: SelfCheckPatternOptions = {},
): string {
  const pattern = generateSelfCheckPattern(kind, options);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pattern.svg);
}

/** Both patterns, in the order the self-check UI offers them. */
export function generateSelfCheckPatterns(
  options: SelfCheckPatternOptions = {},
): SelfCheckPattern[] {
  return [
    generateSelfCheckPattern('content-leak', options),
    generateSelfCheckPattern('black-bar-leak', options),
  ];
}
