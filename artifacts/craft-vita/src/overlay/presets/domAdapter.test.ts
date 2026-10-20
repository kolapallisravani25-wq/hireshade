import { describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_PRESET_STORAGE_KEY,
  createOverlayPresetAdapter,
  installOverlayPresets,
} from './domAdapter';
import { PRESETS, PRESET_STYLE_PROPERTIES, presetStylePatch } from './presetModel';

interface FakeElement {
  style: { setProperty: (name: string, value: string) => void };
  attrs: Map<string, string>;
  props: Map<string, string>;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  textContent: string;
}

function makeElement(textContent = ''): FakeElement {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    textContent,
    style: {
      setProperty: (name: string, value: string) => {
        props.set(name, value);
      },
    },
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    getAttribute: (name: string) => attrs.get(name) ?? null,
  };
}

function makeWindow(width = 1920, height = 1080) {
  const map = new Map<string, string>();
  const events: unknown[] = [];
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => map,
  };
  return {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    localStorage: storage,
    dispatchEvent: (event: unknown) => {
      events.push(event);
      return true;
    },
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    events,
    storage,
  };
}

function makeDom(answerText = '') {
  const root = makeElement();
  const answer = makeElement(answerText);
  return {
    root,
    answer,
    document: {
      querySelector: (selector: string) => {
        if (selector === '[data-testid="answer-text"]') return answer;
        return root;
      },
    },
  };
}

describe('overlay preset DOM adapter', () => {
  it('mounts with BANNER by default and writes a transform-only layout', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    expect(adapter.getState().preset).toBe('banner');
    expect(dom.root.attrs.get('data-overlay-preset')).toBe('banner');
    const transform = dom.root.props.get('transform')!;
    expect(transform).toContain('translate3d(');
    expect(dom.root.props.has('top')).toBe(false);
    expect(dom.root.props.has('left')).toBe(false);
    expect(dom.root.props.get('width')).toBe('1872px');
    expect(dom.root.props.get('--overlay-font-px')).toMatch(/px$/);
  });

  it('only writes declared CSS properties', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('reading');
    const extra = new Set(['--overlay-answer-font-px', '--overlay-answer-line-height-px', '--overlay-answer-max-ch']);
    for (const property of dom.root.props.keys()) {
      expect(
        (PRESET_STYLE_PROPERTIES as readonly string[]).includes(property) || extra.has(property),
        property,
      ).toBe(true);
    }
  });

  it('applies all five presets synchronously and persists the active one', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    for (const preset of ['compact', 'banner', 'teleprompter', 'side-column', 'reading'] as const) {
      const state = adapter.applyPreset(preset);
      expect(state.preset).toBe(preset);
      expect(dom.root.attrs.get('data-overlay-preset')).toBe(preset);
      expect(dom.root.attrs.get('data-overlay-scrim-alpha')).toBe(String(PRESETS[preset].scrimAlpha));
    }
    const stored = JSON.parse(window.storage.dump().get(OVERLAY_PRESET_STORAGE_KEY)!);
    expect(stored.active).toBe('reading');
    expect(window.events.length).toBeGreaterThan(0);
  });

  it('restores the persisted active preset and per-preset bounds on mount', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('side-column');
    adapter.resizeBy(60, 0);
    const savedWidth = adapter.getState().layout.bounds.width;

    const secondDom = makeDom();
    const second = createOverlayPresetAdapter({ window, document: secondDom.document });
    expect(second.getState().preset).toBe('side-column');
    expect(second.getState().layout.restored).toBe(true);
    expect(second.getState().layout.bounds.width).toBe(savedWidth);
  });

  it('persists opacity per preset and clamps the slider', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('compact');
    adapter.setOpacity(0.55);
    adapter.applyPreset('reading');
    adapter.setOpacity(0.97);
    adapter.applyPreset('compact');
    expect(adapter.getState().opacity).toBe(0.55);
    const slider = adapter.getOpacitySlider();
    expect(slider.min).toBe(0.2);
    expect(slider.value).toBe(0.55);
    expect(adapter.setOpacity(5).opacity).toBe(1);
    expect(PRESETS.banner.defaultOpacity).toBeLessThan(1);
  });

  it('toggles click-through and exposes the hotkey affordance', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    const initial = adapter.getState().clickThrough;
    const next = adapter.toggleClickThrough();
    expect(next).toBe(!initial);
    expect(dom.root.attrs.get('data-click-through')).toBe(String(!initial));
    const affordance = adapter.getClickThroughAffordance();
    expect(affordance.label).toBe('Click-through');
    expect(affordance.instruction).toContain('Ctrl');
  });

  it('resizes within preset bounds and snaps to edges', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('compact');
    const before = adapter.getState().layout.bounds;
    const bigger = adapter.resizeBy(10000, 10000).layout.bounds;
    expect(bigger.width).toBeGreaterThanOrEqual(before.width);
    expect(bigger.width).toBeLessThanOrEqual(1920);
    expect(bigger.height).toBeLessThanOrEqual(1080);

    adapter.moveTo(4, 4);
    const moved = adapter.getState().layout.bounds;
    expect(moved.x).toBe(PRESETS.compact.geometry.marginPx);
    expect(moved.y).toBe(PRESETS.compact.geometry.marginPx);
  });

  it('moves the teleprompter out of the camera preview region', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('teleprompter');
    const before = adapter.getState().layout.bounds;
    const camera = { x: 700, y: 0, width: 500, height: 240 };
    const after = adapter.avoidCamera(camera).layout.bounds;
    expect(after.y).toBeGreaterThanOrEqual(camera.y + camera.height);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it('cycles presets in both directions', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    expect(adapter.cycle().preset).toBe('teleprompter');
    expect(adapter.cycle(-1).preset).toBe('banner');
    expect(adapter.getPresets()).toHaveLength(5);
  });

  it('auto-fits the answer inside the preset and reports the fit', () => {
    const longAnswer =
      'I led the migration of a large analytics platform to a cloud warehouse and owned the design end to end. '.repeat(12);
    const window = makeWindow(1280, 720);
    const dom = makeDom(longAnswer);
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('compact');
    const fit = adapter.getLastAutoFit();
    expect(fit).not.toBeNull();
    expect(fit!.fontPx).toBeGreaterThanOrEqual(16);
    expect(dom.root.props.get('--overlay-answer-font-px')).toBe(fit!.fontPx + 'px');
    expect(dom.root.attrs.has('data-answer-fits')).toBe(true);
  });

  it('never calls focus and has no focus method', () => {
    const window = makeWindow();
    const dom = makeDom();
    const focusSpy = vi.fn();
    (dom.root as unknown as { focus: () => void }).focus = focusSpy;
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    adapter.applyPreset('reading');
    adapter.resizeBy(10, 10);
    expect(focusSpy).not.toHaveBeenCalled();
    expect((adapter as unknown as { focus?: unknown }).focus).toBeUndefined();
  });

  it('never throws when storage is unavailable', () => {
    const window = makeWindow();
    const dom = makeDom();
    const brokenStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const adapter = createOverlayPresetAdapter({
      window,
      document: dom.document,
      storage: brokenStorage,
    });
    expect(() => adapter.applyPreset('reading')).not.toThrow();
    expect(adapter.getState().preset).toBe('reading');
  });

  it('installs a singleton global API that main can call', () => {
    const window = makeWindow();
    const dom = makeDom();
    const first = installOverlayPresets(window as never, dom.document);
    const second = installOverlayPresets(window as never, dom.document);
    expect(second).toBe(first);
    const api = (window as unknown as Record<string, {
      applyPreset: (value: string) => { preset: string };
      getState: () => { preset: string };
      storageKey: string;
    }>)['HireShadeOverlayPresetsApi']!;
    expect(api.storageKey).toBe(OVERLAY_PRESET_STORAGE_KEY);
    api.applyPreset('compact');
    expect(api.getState().preset).toBe('compact');
    expect(dom.root.attrs.get('data-overlay-preset')).toBe('compact');
  });

  it('returns the secondary-display suggestion copy', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    const single = adapter.suggestSecondaryDisplay([{ id: 'main', primary: true }]);
    expect(single.hasSecondary).toBe(false);
    const dual = adapter.suggestSecondaryDisplay([
      { id: 'main', primary: true },
      { id: 'side', primary: false },
    ]);
    expect(dual.hasSecondary).toBe(true);
    expect(dual.targetDisplayId).toBe('side');
    expect(dual.copy).toContain('other screen');
  });

  it('style patch only touches transform for position (one-frame re-layout)', () => {
    const window = makeWindow();
    const dom = makeDom();
    const adapter = createOverlayPresetAdapter({ window, document: dom.document });
    const patch = presetStylePatch(adapter.getState());
    const positionKeys = Object.keys(patch).filter((key) => /^(top|left|right|bottom|margin)/.test(key));
    expect(positionKeys).toEqual([]);
    expect(patch.transform).toEqual(
      'translate3d(' +
        adapter.getState().layout.bounds.x +
        'px, ' +
        adapter.getState().layout.bounds.y +
        'px, 0)',
    );
  });
});
