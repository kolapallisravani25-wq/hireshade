import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Thin wrapper around Tauri window + custom commands used by the launcher
 * overlay. Centralizes all invoke/window calls so feature code stays
 * import-free from raw Tauri APIs.
 */

// ── Content-protection coalescer (Slice 8 fix) ───────────────────────────
// Multiple call-sites (WidgetApp, HeaderMenu, FloatingApp, useOverlayShortcuts,
// ActiveSession page) all call toggle_content_protection independently. During
// resize / mode switches / rapid keyboard shortcut presses, this can produce
// racing invokes where the FINAL call to the Rust command may be for the
// OPPOSITE value from what UI state expects, briefly leaving the window
// screen-share visible.
//
// Strategy: track the last-applied value + the last-requested value. Same-
// value calls short-circuit. Different-value calls debounce for 150ms so a
// burst collapses to the final desired value.
let cpAppliedValue: boolean | null = null;
let cpPendingValue: boolean | null = null;
let cpPendingTimer: ReturnType<typeof setTimeout> | null = null;

async function applyContentProtection(v: boolean): Promise<void> {
  if (cpAppliedValue === v) return; // Nothing to do.
  try {
    await invoke("toggle_content_protection", { protected: v });
    cpAppliedValue = v;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[tauriOverlay] toggle_content_protection failed:", err);
    // Do NOT update cpAppliedValue — next call will retry.
  }
}

function toggleContentProtection(v: boolean): Promise<void> {
  cpPendingValue = v;
  if (cpPendingTimer) clearTimeout(cpPendingTimer);
  return new Promise<void>((resolve) => {
    cpPendingTimer = setTimeout(async () => {
      cpPendingTimer = null;
      const target = cpPendingValue;
      cpPendingValue = null;
      if (target === null) {
        resolve();
        return;
      }
      await applyContentProtection(target);
      resolve();
    }, 150);
  });
}

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

  toggleContentProtection,
} as const;

// Exposed for tests + for the callers that use invoke() directly today
// (WidgetApp, FloatingApp, ActiveSession) so they can migrate incrementally.
export { toggleContentProtection };
