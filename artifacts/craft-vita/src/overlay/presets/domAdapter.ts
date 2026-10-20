/**
 * Framework-free DOM adapter for overlay presets (O1 / EXT G-044).
 *
 * Owns NO decisions: layout/typography/scrim come from the pure preset model.
 * Applies the preset with CSS custom properties + a transform-only position so a
 * re-layout is a single compositor update (no layout thrash, one frame),
 * persists per-preset state in localStorage, and exposes:
 *
 *   window.HireShadeOverlayPresetsApi.applyPreset('banner' | {preset})
 *
 * for the Electron main process (O2 wires the IPC). This module never edits
 * desktop-electron/main.js and never calls focus().
 */
import {
  OVERLAY_PRESET_STORAGE_KEY,
  clampPresetOpacity,
  getPreset,
  isOverlayPresetId,
  loadPresetStore,
  movePresetLayout,
  nextPresetId,
  parsePresetStore,
  presetStateFor,
  presetStateForStore,
  presetStylePatch,
  resizePresetLayout,
  savePresetStore,
  setStoreActivePreset,
  snapLayoutToEdges,
  storePresetState,
  PRESET_LIST,
} from './presetModel';
import { autoFitAnswer } from './readability';
import {
  avoidCameraPreviewRegion,
  clickThroughAffordance,
  opacitySliderModel,
  suggestSecondaryDisplay,
  type DisplayInfo,
  type SecondaryDisplaySuggestion,
} from './nonObstruction';
import type {
  OverlayPresetId,
  PresetLayout,
  PresetState,
  ViewportSize,
} from './types';
import { DEFAULT_OVERLAY_PRESET } from './types';

export const OVERLAY_PRESET_GLOBAL = 'HireShadeOverlayPresetsApi';
export const OVERLAY_PRESET_EVENT = 'hireshade:overlay-preset-changed';

export interface PresetStyleLike {
  setProperty(name: string, value: string): void;
}

export interface PresetElementLike {
  style: PresetStyleLike;
  setAttribute(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  textContent?: string | null;
}

export interface PresetDocumentLike {
  querySelector(selector: string): PresetElementLike | null;
}

export interface PresetStorageLikeLocal {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PresetWindowLike {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio?: number;
  localStorage?: PresetStorageLikeLocal;
  dispatchEvent?: (event: unknown) => boolean;
  CustomEvent?: new (type: string, init: { detail: unknown }) => unknown;
}

export interface OverlayPresetAdapterOptions {
  readonly window: PresetWindowLike;
  readonly document: PresetDocumentLike;
  readonly storage?: PresetStorageLikeLocal | null;
  readonly rootSelector?: string;
  readonly answerSelector?: string;
  readonly getViewport?: () => ViewportSize;
  readonly onApply?: (state: PresetState) => void;
}

export interface PresetApplyInput {
  readonly preset: OverlayPresetId;
  readonly reason?: string;
}

export interface OverlayPresetAdapter {
  applyPreset(changed: OverlayPresetId | PresetApplyInput): PresetState;
  setOpacity(opacity: number): PresetState;
  setClickThrough(enabled: boolean): PresetState;
  toggleClickThrough(): boolean;
  resizeBy(dx: number, dy: number): PresetState;
  moveTo(x: number, y: number): PresetState;
  avoidCamera(cameraRect: { x: number; y: number; width: number; height: number }): PresetState;
  cycle(direction?: number): PresetState;
  getState(): PresetState;
  getPresets(): typeof PRESET_LIST;
  getOpacitySlider(): ReturnType<typeof opacitySliderModel>;
  getClickThroughAffordance(): ReturnType<typeof clickThroughAffordance>;
  suggestSecondaryDisplay(displays: readonly DisplayInfo[]): SecondaryDisplaySuggestion;
  /** Re-runs auto-fit against the current answer text (call after new content). */
  refitAnswer(): ReturnType<typeof autoFitAnswer> | null;
  getLastAutoFit(): ReturnType<typeof autoFitAnswer> | null;
  destroy(): void;
}

const DEFAULT_ROOT_SELECTOR = '[data-overlay-surface], [data-testid="overlay-card"]';
const DEFAULT_ANSWER_SELECTOR = '[data-testid="answer-text"]';

export function createOverlayPresetAdapter(
  options: OverlayPresetAdapterOptions,
): OverlayPresetAdapter {
  const { window, document } = options;
  const rootSelector = options.rootSelector ?? DEFAULT_ROOT_SELECTOR;
  const answerSelector = options.answerSelector ?? DEFAULT_ANSWER_SELECTOR;
  const storage =
    options.storage !== undefined
      ? options.storage
      : (() => {
          try {
            return window.localStorage ?? null;
          } catch {
            return null;
          }
        })();
  const getViewport = (): ViewportSize =>
    options.getViewport
      ? options.getViewport()
      : { width: window.innerWidth, height: window.innerHeight };

  const root = document.querySelector(rootSelector);
  let store = loadPresetStore(storage);
  let initialState = presetStateFor(store.active, getViewport(), {
    devicePixelRatio: window.devicePixelRatio ?? 1,
    persisted: presetStateForStore(store, store.active),
  });
  let state: PresetState = initialState;
  let lastAutoFit: ReturnType<typeof autoFitAnswer> | null = null;

  const writePatch = (): void => {
    const patch = presetStylePatch(state);
    if (!root) return;
    for (const property of Object.keys(patch) as (keyof typeof patch)[]) {
      root.style.setProperty(property, patch[property]);
    }
    root.setAttribute('data-overlay-preset', state.preset);
    root.setAttribute('data-click-through', state.clickThrough ? 'true' : 'false');
    root.setAttribute('data-overlay-scrim-alpha', String(state.scrimAlpha));
    root.setAttribute('data-typography-max-ch', String(state.typography.maxCh));
  };

  const applyAnswerFit = (): void => {
    const answer = document.querySelector(answerSelector);
    const text = (answer?.textContent ?? '') || '';
    if (!answer || !text.trim()) {
      lastAutoFit = null;
      return;
    }
    const preset = getPreset(state.preset);
    const padding = preset.paddingPx;
    const fit = autoFitAnswer({
      text,
      availableWidthPx: Math.max(80, state.layout.bounds.width - padding * 2),
      availableHeightPx: Math.max(
        40,
        Math.min(preset.answerViewportMaxPx, state.layout.bounds.height - padding * 2 - 80),
      ),
      typography: state.typography,
    });
    lastAutoFit = fit;
    if (!root) return;
    root.style.setProperty('--overlay-answer-font-px', fit.fontPx + 'px');
    root.style.setProperty('--overlay-answer-line-height-px', fit.lineHeightPx + 'px');
    root.style.setProperty('--overlay-answer-max-ch', String(fit.maxCh));
    root.setAttribute('data-answer-fits', fit.fits ? 'true' : 'false');
  };

  const persist = (): void => {
    store = storePresetState(store, state.layout, getViewport(), state.opacity);
    savePresetStore(storage, store);
  };

  const emit = (reason: string): void => {
    if (root) root.setAttribute('data-overlay-preset-reason', reason);
    options.onApply?.(state);
    try {
      if (typeof window.dispatchEvent === 'function') {
        const detail = { ...state, reason };
        const event =
          typeof window.CustomEvent === 'function'
            ? new window.CustomEvent(OVERLAY_PRESET_EVENT, { detail })
            : { type: OVERLAY_PRESET_EVENT, detail };
        window.dispatchEvent(event);
      }
    } catch {
      // Event dispatch must never break the overlay.
    }
  };

  const commit = (reason: string): PresetState => {
    writePatch();
    applyAnswerFit();
    persist();
    emit(reason);
    return state;
  };

  const applyPreset = (changed: OverlayPresetId | PresetApplyInput): PresetState => {
    const requested = typeof changed === 'string' ? changed : changed.preset;
    const presetId = isOverlayPresetId(requested) ? requested : DEFAULT_OVERLAY_PRESET;
    const reason =
      typeof changed === 'string' ? 'applyPreset' : changed.reason ?? 'applyPreset';
    const viewport = getViewport();
    state = presetStateFor(presetId, viewport, {
      devicePixelRatio: window.devicePixelRatio ?? 1,
      persisted: presetStateForStore(store, presetId),
      clickThrough: state.clickThrough,
    });
    return commit(reason);
  };

  const withLayout = (layout: PresetLayout): PresetState => {
    const viewport = getViewport();
    state = {
      ...state,
      layout,
    };
    // Re-resolve typography for the (possibly new) viewport, then keep it.
    const fitted = presetStateFor(state.preset, viewport, {
      devicePixelRatio: window.devicePixelRatio ?? 1,
      persisted: null,
      clickThrough: state.clickThrough,
    });
    state = { ...fitted, layout, opacity: state.opacity };
    return commit('layout');
  };

  const setOpacity = (opacity: number): PresetState => {
    state = { ...state, opacity: clampPresetOpacity(opacity) };
    return commit('opacity');
  };

  const setClickThrough = (enabled: boolean): PresetState => {
    state = { ...state, clickThrough: Boolean(enabled) };
    return commit('click-through');
  };

  const resizeBy = (dx: number, dy: number): PresetState => {
    const viewport = getViewport();
    const resized = resizePresetLayout(state.layout, { dx, dy }, viewport);
    const snapped = snapLayoutToEdges(resized, viewport);
    return withLayout(snapped.layout);
  };

  const moveTo = (x: number, y: number): PresetState => {
    const viewport = getViewport();
    const moved = movePresetLayout(state.layout, { x, y }, viewport);
    return withLayout(moved.layout);
  };

  const avoidCamera = (cameraRect: { x: number; y: number; width: number; height: number }): PresetState => {
    const viewport = getViewport();
    const avoided = avoidCameraPreviewRegion(state.layout.bounds, cameraRect, viewport);
    if (!avoided.avoided) return state;
    return withLayout({ ...state.layout, bounds: avoided.bounds, restored: false });
  };

  const cycle = (direction = 1): PresetState => {
    const next = nextPresetId(state.preset, direction);
    store = setStoreActivePreset(store, next);
    return applyPreset({ preset: next, reason: 'cycle' });
  };

  // Initial mount: BANNER default unless the persisted active preset exists.
  writePatch();
  applyAnswerFit();

  return {
    applyPreset,
    setOpacity,
    setClickThrough,
    toggleClickThrough: () => {
      setClickThrough(!state.clickThrough);
      return state.clickThrough;
    },
    resizeBy,
    moveTo,
    avoidCamera,
    cycle,
    getState: () => state,
    getPresets: () => PRESET_LIST,
    getOpacitySlider: () => opacitySliderModel(state.opacity),
    getClickThroughAffordance: () => clickThroughAffordance(),
    suggestSecondaryDisplay: (displays) => suggestSecondaryDisplay(displays),
    refitAnswer: () => {
      applyAnswerFit();
      return lastAutoFit;
    },
    getLastAutoFit: () => lastAutoFit,
    destroy: () => {
      root?.setAttribute('data-overlay-preset-destroyed', 'true');
    },
  };
}

export interface GlobalThisLike {
  [key: string]: unknown;
}

/**
 * Installs the adapter as a singleton and exposes the main-process API on
 * window.HireShadeOverlayPresetsApi. Idempotent.
 */
export function installOverlayPresets(
  window: PresetWindowLike & GlobalThisLike,
  document: PresetDocumentLike,
  options: Partial<OverlayPresetAdapterOptions> = {},
): OverlayPresetAdapter {
  const existing = window['__hireshadeOverlayPresetAdapter'] as OverlayPresetAdapter | undefined;
  const adapter =
    existing ?? createOverlayPresetAdapter({ ...options, window, document });
  const target = window as unknown as Record<string, unknown>;
  target['__hireshadeOverlayPresetAdapter'] = adapter;
  target[OVERLAY_PRESET_GLOBAL] = {
    applyPreset: (changed: OverlayPresetId | PresetApplyInput) => adapter.applyPreset(changed),
    cycle: (direction?: number) => adapter.cycle(direction),
    setOpacity: (opacity: number) => adapter.setOpacity(opacity),
    setClickThrough: (enabled: boolean) => adapter.setClickThrough(enabled),
    toggleClickThrough: () => adapter.toggleClickThrough(),
    resizeBy: (dx: number, dy: number) => adapter.resizeBy(dx, dy),
    moveTo: (x: number, y: number) => adapter.moveTo(x, y),
    avoidCamera: (rect: { x: number; y: number; width: number; height: number }) =>
      adapter.avoidCamera(rect),
    getState: () => adapter.getState(),
    getPresets: () => adapter.getPresets(),
    getOpacitySlider: () => adapter.getOpacitySlider(),
    getClickThroughAffordance: () => adapter.getClickThroughAffordance(),
    suggestSecondaryDisplay: (displays: readonly DisplayInfo[]) =>
      adapter.suggestSecondaryDisplay(displays),
    refitAnswer: () => adapter.refitAnswer(),
    getLastAutoFit: () => adapter.getLastAutoFit(),
    storageKey: OVERLAY_PRESET_STORAGE_KEY,
    parseStore: (raw: unknown) => parsePresetStore(raw),
  };
  return adapter;
}

export { DEFAULT_OVERLAY_PRESET, OVERLAY_PRESET_STORAGE_KEY };
