export type UnlistenFn = () => void;

export const emit = async () => {};
export const listen = async () => () => {};
export const once = async () => () => {};

/**
 * `emitTo` is part of the real @tauri-apps/api/event export surface and is
 * imported by src/services/tauriEvents.ts. Without it the browser/stub build
 * aborts its dependency scan — esbuild reports
 *   No matching export in "src/tauri-stubs/api-event.ts" for import "emitTo"
 * — and the app never mounts under `pnpm dev` or a plain (non-Tauri) web build.
 */
export const emitTo = async () => {};
