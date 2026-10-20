/**
 * Overlay preset runtime barrel (O1 / EXT G-044).
 *
 * O3's size-acceptance harness probes this module and consumes PRESETS /
 * OVERLAY_PRESETS plus the layout + typography helpers. Keep the flat alias so
 * both harness shapes resolve.
 */
export * from './types';
export * from './readability';
export * from './presetModel';
export * from './nonObstruction';
export * from './domAdapter';
export * from '../answerFormat';

// Alias expected by scripts/overlay-size/presets-contract.mjs (O3).
export { PRESETS as OVERLAY_PRESETS } from './presetModel';
