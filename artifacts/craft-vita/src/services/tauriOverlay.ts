import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Thin wrapper around Tauri window + custom commands used by the launcher
 * overlay. Centralizes all invoke/window calls so feature code stays
 * import-free from raw Tauri APIs.
 */
export const tauriOverlay = {
  getCursorPosition: (): Promise<[number, number]> =>
    invoke<[number, number]>("get_cursor_position"),

  setIgnoreCursorEvents: (v: boolean): Promise<void> =>
    invoke("set_cursor_passthrough", { passthrough: v }),

  getOuterPosition: () => getCurrentWindow().outerPosition(),

  getScaleFactor: () => getCurrentWindow().scaleFactor(),

  showMini: (): Promise<void> => invoke("show_mini_top_center"),

  hideLauncher: (): Promise<void> => getCurrentWindow().hide(),

  closeLauncher: (): Promise<void> => getCurrentWindow().close(),

  toggleContentProtection: (v: boolean): Promise<void> =>
    invoke("toggle_content_protection", { protected: v }),
} as const;
