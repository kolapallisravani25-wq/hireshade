/**
 * overlaySettings — lightweight persisted overlay settings.
 *
 * NOT a Redux slice — the launcher and mini windows are separate JS contexts
 * and do NOT share a Redux store. Each context reads/writes the same
 * localStorage keys so settings are globally consistent across windows.
 *
 * Keys
 *   hireshade.widget.opacity   — number  0.20 → 1.00
 *   hireshade.widget.zoom      — number  0.70 → 1.60
 *   hireshade.widget.private   — boolean
 *   hireshade.widget.autodetect — boolean
 */

import { isTauri } from "@/lib/utils";

export const OPACITY_KEY   = "hireshade.widget.opacity";
export const ZOOM_KEY      = "hireshade.widget.zoom";
export const PRIVATE_KEY   = "hireshade.widget.private";
export const AUTODETECT_KEY = "hireshade.widget.autodetect";

export const OPACITY_MIN  = 0.20;
export const OPACITY_MAX  = 1.00;
export const OPACITY_DEFAULT = 1.00;

export const ZOOM_MIN     = 0.70;
export const ZOOM_MAX     = 1.60;
export const ZOOM_STEP    = 0.10;
export const ZOOM_DEFAULT = 1.00;

let desktopPrivateDefaultApplied = false;

function applyDesktopPrivateModeDefault(): void {
  if (desktopPrivateDefaultApplied) {
    return;
  }

  desktopPrivateDefaultApplied = true;

  if (!isTauri()) {
    return;
  }

  localStorage.setItem(PRIVATE_KEY, "true");
}

// ── Getters ──────────────────────────────────────────────────────────────────

export function getOpacity(): number {
  const v = parseFloat(localStorage.getItem(OPACITY_KEY) ?? String(OPACITY_DEFAULT));
  return isNaN(v) ? OPACITY_DEFAULT : Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v));
}

export function getZoom(): number {
  const v = parseFloat(localStorage.getItem(ZOOM_KEY) ?? String(ZOOM_DEFAULT));
  return isNaN(v) ? ZOOM_DEFAULT : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
}

export function getPrivateMode(): boolean {
  applyDesktopPrivateModeDefault();
  return localStorage.getItem(PRIVATE_KEY) === "true";
}

export function getAutoDetect(): boolean {
  return localStorage.getItem(AUTODETECT_KEY) === "true";
}

// ── Setters ──────────────────────────────────────────────────────────────────

export function saveOpacity(v: number): void {
  const clamped = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, +v.toFixed(2)));
  localStorage.setItem(OPACITY_KEY, String(clamped));
}

export function saveZoom(v: number): void {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +v.toFixed(2)));
  localStorage.setItem(ZOOM_KEY, String(clamped));
}

export function savePrivateMode(v: boolean): void {
  localStorage.setItem(PRIVATE_KEY, v ? "true" : "false");
}

export function saveAutoDetect(v: boolean): void {
  localStorage.setItem(AUTODETECT_KEY, v ? "true" : "false");
}

/**
 * Reset overlay display settings to their post-session defaults.
 *
 * IMPORTANT: privateMode (content protection) is intentionally NOT reset.
 * It is a user privacy preference and must persist across sessions —
 * AI actions, screen analysis, and session lifecycle events must NEVER
 * mutate it. Only an explicit user toggle (HeaderMenu / SessionMenu /
 * keyboard shortcut) is allowed to change it.
 */
export function resetOverlaySettings(): void {
  saveOpacity(OPACITY_DEFAULT);
  saveZoom(ZOOM_DEFAULT);
  // Do NOT touch privateMode — it is a user-owned privacy setting.
}
