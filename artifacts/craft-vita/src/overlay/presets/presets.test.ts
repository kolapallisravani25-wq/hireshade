import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OVERLAY_PRESET,
  OVERLAY_PRESET_IDS,
  OVERLAY_PRESET_STORAGE_KEY,
  OVERLAY_PRESET_STORE_VERSION,
  PRESETS,
  PRESET_LIST,
  PRESET_STYLE_PROPERTIES,
  SNAP_TO_EDGE_THRESHOLD_PX,
  computePresetLayout,
  emptyPresetStore,
  getPreset,
  isOverlayPresetId,
  isPresetStyleProperty,
  loadPresetStore,
  maxPresetSize,
  movePresetLayout,
  nextPresetId,
  parsePresetStore,
  parsePresetStoreJson,
  presetAriaLabel,
  presetStateFor,
  presetStateForStore,
  presetStylePatch,
  resizePresetLayout,
  savePresetStore,
  serializePresetStore,
  snapLayoutToEdges,
  stepPresetOpacity,
  storePresetState,
} from './presetModel';
import { MIN_READABLE_FONT_PX, computeDpiProfile } from './readability';
import type { PersistedPresetStore } from './types';

const viewport1080 = { width: 1920, height: 1080 };
const viewport1440 = { width: 2560, height: 1440 };
const viewport4k = { width: 3840, height: 2160 };
const demoViewport = { width: 980, height: 600 };

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => map,
  };
}

describe('five overlay presets', () => {
  it('ships exactly the five required presets', () => {
    expect(OVERLAY_PRESET_IDS).toEqual([
      'compact',
      'banner',
      'teleprompter',
      'side-column',
      'reading',
    ]);
    expect(PRESET_LIST).toHaveLength(5);
    for (const id of OVERLAY_PRESET_IDS) expect(PRESETS[id].id).toBe(id);
  });

  it('defaults to BANNER', () => {
    expect(DEFAULT_OVERLAY_PRESET).toBe('banner');
  });

  it('gives every preset geometry, typography, opacity and scrim', () => {
    for (const preset of PRESET_LIST) {
      expect(preset.geometry.widthRatio).toBeGreaterThan(0);
      expect(preset.geometry.heightRatio).toBeGreaterThan(0);
      expect(preset.typography.baseFontPx).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
      expect(preset.typography.lineHeightRatio).toBeGreaterThanOrEqual(1.5);
      expect(preset.typography.maxCh).toBeLessThanOrEqual(75);
      expect(preset.defaultOpacity).toBeLessThan(1);
      expect(preset.defaultOpacity).toBeGreaterThan(0.5);
      expect(preset.scrimAlpha).toBeGreaterThan(0.5);
      expect(preset.dragAreaPx).toBeGreaterThanOrEqual(40);
      expect(preset.resizeHandlePx).toBeGreaterThanOrEqual(24);
    }
  });

  it('resolves ids and falls back for unknown values', () => {
    expect(isOverlayPresetId('banner')).toBe(true);
    expect(isOverlayPresetId('nope')).toBe(false);
    expect(getPreset('reading').label).toBe('Reading');
    expect(presetAriaLabel('compact')).toContain('Compact overlay preset');
  });

  it('cycles through all presets in both directions', () => {
    let id = nextPresetId('compact');
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(id);
      id = nextPresetId(id);
    }
    expect(seen).toEqual([
      'banner',
      'teleprompter',
      'side-column',
      'reading',
      'compact',
    ]);
    expect(nextPresetId('compact', -1)).toBe('reading');
  });
});

describe('BANNER default geometry', () => {
  it('is full width minus margins and docks to the bottom', () => {
    const layout = computePresetLayout('banner', viewport1080);
    const preset = PRESETS.banner;
    expect(layout.bounds.width).toBe(viewport1080.width - preset.geometry.marginPx * 2);
    expect(layout.bounds.x).toBe(preset.geometry.marginPx);
    expect(layout.bounds.y + layout.bounds.height).toBe(
      viewport1080.height - preset.geometry.marginPx,
    );
    expect(layout.bounds.height / viewport1080.height).toBeGreaterThanOrEqual(0.35);
    expect(layout.bounds.height / viewport1080.height).toBeLessThanOrEqual(0.4);
  });

  it('keeps the 35-40% band on 1440p and 4K', () => {
    for (const viewport of [viewport1440, viewport4k]) {
      const layout = computePresetLayout('banner', viewport);
      const ratio = layout.bounds.height / viewport.height;
      expect(ratio, JSON.stringify(viewport)).toBeGreaterThanOrEqual(0.35);
      expect(ratio, JSON.stringify(viewport)).toBeLessThanOrEqual(0.4);
    }
  });
});

describe('preset geometry', () => {
  it('keeps every preset inside the viewport on all reference displays', () => {
    for (const viewport of [demoViewport, viewport1080, viewport1440, viewport4k]) {
      for (const id of OVERLAY_PRESET_IDS) {
        const { bounds } = computePresetLayout(id, viewport);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.height).toBeGreaterThan(0);
      }
    }
  });

  it('places teleprompter as close to the top-center/webcam as it can', () => {
    const layout = computePresetLayout('teleprompter', viewport1080);
    expect(layout.bounds.y).toBeLessThanOrEqual(PRESETS.teleprompter.geometry.marginPx);
    const center = layout.bounds.x + layout.bounds.width / 2;
    expect(Math.abs(center - viewport1080.width / 2)).toBeLessThanOrEqual(1);
    // Camera-preview region is top-center: teleprompter can be moved clear of it.
    expect(layout.bounds.y).toBeLessThan(PRESETS.banner.geometry.marginPx);
  });

  it('places side column at 30-35% width on the requested side', () => {
    for (const side of ['left', 'right'] as const) {
      const layout = computePresetLayout('side-column', viewport1080, { side });
      const ratio = layout.bounds.width / viewport1080.width;
      expect(ratio).toBeGreaterThanOrEqual(0.3);
      expect(ratio).toBeLessThanOrEqual(0.35);
      if (side === 'left') expect(layout.bounds.x).toBe(PRESETS['side-column'].geometry.marginPx);
      else
        expect(layout.bounds.x + layout.bounds.width).toBe(
          viewport1080.width - PRESETS['side-column'].geometry.marginPx,
        );
      expect(layout.bounds.height).toBeGreaterThan(viewport1080.height * 0.8);
    }
  });

  it('makes reading near full-screen and centered', () => {
    const layout = computePresetLayout('reading', viewport1080);
    expect(layout.bounds.width / viewport1080.width).toBeGreaterThanOrEqual(0.9);
    expect(layout.bounds.height / viewport1080.height).toBeGreaterThanOrEqual(0.85);
    expect(Math.abs(layout.bounds.x + layout.bounds.width / 2 - viewport1080.width / 2)).toBeLessThanOrEqual(2);
  });

  it('makes compact the smallest preset', () => {
    const compact = computePresetLayout('compact', viewport1080);
    for (const id of OVERLAY_PRESET_IDS) {
      if (id === 'compact') continue;
      const other = computePresetLayout(id, viewport1080);
      expect(compact.bounds.width * compact.bounds.height).toBeLessThan(
        other.bounds.width * other.bounds.height,
      );
    }
  });
});

describe('resize + snap-to-edge + drag', () => {
  it('resizes within preset min/max bounds', () => {
    const layout = computePresetLayout('compact', viewport1080);
    const bigger = resizePresetLayout(layout, { dx: 5000, dy: 5000 }, viewport1080);
    expect(bigger.bounds.width).toBeLessThanOrEqual(
      maxPresetSize('compact', viewport1080).width,
    );
    const smaller = resizePresetLayout(layout, { dx: -5000, dy: -5000 }, viewport1080);
    expect(smaller.bounds.width).toBeGreaterThanOrEqual(PRESETS.compact.geometry.minWidthPx);
    expect(smaller.bounds.height).toBeGreaterThanOrEqual(PRESETS.compact.geometry.minHeightPx);
  });

  it('snaps to an edge within the generous threshold', () => {
    const layout = computePresetLayout('compact', viewport1080);
    const nearlyLeft = {
      ...layout,
      bounds: {
        ...layout.bounds,
        x: PRESETS.compact.geometry.marginPx + SNAP_TO_EDGE_THRESHOLD_PX - 1,
      },
    };
    const snapped = snapLayoutToEdges(nearlyLeft, viewport1080);
    expect(snapped.snapped).toContain('left');
    expect(snapped.layout.bounds.x).toBe(PRESETS.compact.geometry.marginPx);

    const notNear = {
      ...layout,
      bounds: { ...layout.bounds, x: layout.bounds.x + SNAP_TO_EDGE_THRESHOLD_PX + 10 },
    };
    expect(snapLayoutToEdges(notNear, viewport1080).snapped).not.toContain('left');
  });

  it('snaps to the right and bottom edges too', () => {
    const layout = computePresetLayout('compact', viewport1080);
    const moved = {
      ...layout,
      bounds: {
        ...layout.bounds,
        x: viewport1080.width - layout.bounds.width - 2,
        y: viewport1080.height - layout.bounds.height - 3,
      },
    };
    const snapped = snapLayoutToEdges(moved, viewport1080);
    expect(snapped.snapped).toEqual(expect.arrayContaining(['right', 'bottom']));
  });

  it('drags within the viewport, keeping the surface fully visible', () => {
    const layout = computePresetLayout('banner', viewport1080);
    const moved = movePresetLayout(layout, { x: 99999, y: -9999 }, viewport1080);
    expect(moved.layout.bounds.x).toBeGreaterThanOrEqual(0);
    expect(moved.layout.bounds.y).toBeGreaterThanOrEqual(0);
    expect(moved.layout.bounds.x + moved.layout.bounds.width).toBeLessThanOrEqual(
      viewport1080.width,
    );
  });
});

describe('per-preset opacity', () => {
  it('keeps semi-transparent defaults and clamps user values', () => {
    for (const preset of PRESET_LIST) {
      expect(preset.defaultOpacity).toBeLessThan(1);
      const state = presetStateFor(preset.id, viewport1080);
      expect(state.opacity).toBeLessThan(1);
    }
    expect(stepPresetOpacity(0.5, 0.1)).toBeCloseTo(0.6);
    expect(stepPresetOpacity(0.99, 0.1)).toBe(1);
    expect(stepPresetOpacity(0.21, -0.1)).toBe(0.2);
  });
});

describe('typography + style patch', () => {
  it('resolves >= 16px type and >= 1.5 line-height at every preset', () => {
    for (const viewport of [demoViewport, viewport1080, viewport4k]) {
      for (const id of OVERLAY_PRESET_IDS) {
        const state = presetStateFor(id, viewport, {
          devicePixelRatio: viewport === viewport4k ? 2 : 1,
        });
        expect(state.typography.fontPx).toBeGreaterThanOrEqual(16);
        expect(state.typography.lineHeightRatio).toBeGreaterThanOrEqual(1.5);
        expect(state.typography.maxCh).toBeLessThanOrEqual(75);
      }
    }
  });

  it('builds a CSS patch with transform-only positioning', () => {
    const state = presetStateFor('banner', viewport1080);
    const patch = presetStylePatch(state);
    for (const property of Object.keys(patch)) {
      expect(isPresetStyleProperty(property), property).toBe(true);
    }
    expect(patch.transform).toContain('translate3d(');
    expect(patch.transform).toContain(state.layout.bounds.x + 'px');
    expect(patch).not.toHaveProperty('top');
    expect(patch).not.toHaveProperty('left');
    expect(patch).not.toHaveProperty('marginLeft');
    expect(patch['--overlay-font-px']).toBe(state.typography.fontPx + 'px');
    expect(patch['--overlay-max-ch']).toBe(String(state.typography.maxCh));
    expect(PRESET_STYLE_PROPERTIES.length).toBeGreaterThan(10);
  });

  it('exposes the scrim colour/alpha for the composited contrast model', () => {
    for (const id of OVERLAY_PRESET_IDS) {
      const state = presetStateFor(id, viewport1080);
      expect(state.scrimAlpha).toBeGreaterThan(0.5);
      expect(state.scrimColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(state.textColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('per-preset persistence', () => {
  function storeAfter(id: 'compact' | 'banner' | 'teleprompter' | 'side-column' | 'reading', viewport = viewport1080) {
    let store = emptyPresetStore();
    const layout = computePresetLayout(id, viewport);
    store = storePresetState(store, layout, viewport, getPreset(id).defaultOpacity);
    return store;
  }

  it('round-trips through JSON', () => {
    const store = storeAfter('banner');
    const parsed = parsePresetStoreJson(serializePresetStore(store));
    expect(parsed.version).toBe(OVERLAY_PRESET_STORE_VERSION);
    expect(parsed.active).toBe('banner');
    expect(parsed.perPreset.banner?.widthRatio).toBeCloseTo(
      store.perPreset.banner!.widthRatio!,
      4,
    );
  });

  it('remembers a different layout for each preset', () => {
    let store: PersistedPresetStore = emptyPresetStore();
    const bannerViewport = viewport1080;
    const compactBounds = { ...computePresetLayout('compact', viewport1080).bounds, width: 500, height: 220 };
    store = storePresetState(
      store,
      { preset: 'compact', bounds: compactBounds, side: null, restored: false },
      bannerViewport,
      0.6,
    );
    store = storePresetState(
      store,
      computePresetLayout('banner', viewport1080),
      bannerViewport,
      0.9,
    );
    expect(store.perPreset.compact?.opacity).toBe(0.6);
    expect(store.perPreset.banner?.opacity).toBe(0.9);

    const compactState = presetStateForStore(store, 'compact');
    expect(compactState).not.toBeNull();
    const restored = computePresetLayout('compact', viewport1080, { persisted: compactState });
    expect(restored.restored).toBe(true);
    expect(restored.bounds.width).toBe(500);
    expect(restored.bounds.height).toBe(220);
  });

  it('loads/saves with a storage object and survives corrupt JSON', () => {
    const storage = makeStorage();
    const store = storeAfter('reading');
    savePresetStore(storage, store);
    const loaded = loadPresetStore(storage);
    expect(loaded.active).toBe('reading');
    expect(storage.dump().get(OVERLAY_PRESET_STORAGE_KEY)).toContain('reading');

    storage.setItem(OVERLAY_PRESET_STORAGE_KEY, '{not json');
    expect(loadPresetStore(storage).active).toBe(DEFAULT_OVERLAY_PRESET);
    storage.setItem(OVERLAY_PRESET_STORAGE_KEY, JSON.stringify({ active: 'evil', perPreset: 4 }));
    expect(loadPresetStore(storage).active).toBe(DEFAULT_OVERLAY_PRESET);
  });

  it('sanitises untrusted persisted values', () => {
    const parsed = parsePresetStore({
      active: 'compact',
      perPreset: {
        compact: {
          xRatio: 99,
          yRatio: -5,
          widthRatio: 0.5,
          heightRatio: 0.3,
          opacity: 0.999,
          side: 'middle',
        },
      },
    });
    expect(parsed.perPreset.compact?.xRatio).toBe(1.5);
    expect(parsed.perPreset.compact?.side).toBeNull();
    expect(parsed.perPreset.compact?.opacity).toBe(1);
  });

  it('respects a persisted opacity when building state', () => {
    const state = presetStateFor('banner', viewport1080, {
      persisted: {
        preset: 'banner',
        xRatio: null,
        yRatio: null,
        widthRatio: null,
        heightRatio: null,
        opacity: 0.42,
        side: null,
      },
    });
    expect(state.opacity).toBe(0.42);
  });
});

describe('DPI-aware typography', () => {
  it('never drops below 16 CSS px and grows with viewport density', () => {
    const small = presetStateFor('banner', { width: 980, height: 600 });
    const large = presetStateFor('banner', viewport4k, { devicePixelRatio: 2 });
    expect(small.typography.fontPx).toBeGreaterThanOrEqual(16);
    expect(large.typography.fontPx).toBeGreaterThanOrEqual(small.typography.fontPx);
    expect(computeDpiProfile({ viewport: viewport1080 }).density).toBe('lg');
    expect(computeDpiProfile({ viewport: viewport4k }).density).toBe('xl');
    expect(computeDpiProfile({ viewport: { width: 800, height: 600 } }).density).toBe('sm');
  });
});
