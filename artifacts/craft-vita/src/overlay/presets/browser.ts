/**
 * Classic-script entry for the demo overlay page (file:// blocks ESM).
 * Bundled by scripts/overlay/build-presets-runtime.mjs into
 * overlay-presets.iife.js with the global HireShadeOverlayPresets.
 *
 * On load it installs the adapter on the current document and exposes
 * window.HireShadeOverlayPresetsApi for the Electron main process.
 */
import { installOverlayPresets } from './domAdapter';

export * from './index';
export { installOverlayPresets };

const globalObject = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
};

if (globalObject.window && globalObject.document) {
  try {
    installOverlayPresets(globalObject.window as never, globalObject.document as never, {
      rootSelector: '[data-overlay-surface], [data-testid="overlay-card"]',
    });
  } catch {
    // Presets are a progressive enhancement: a missing DOM must not break the page.
  }
}
