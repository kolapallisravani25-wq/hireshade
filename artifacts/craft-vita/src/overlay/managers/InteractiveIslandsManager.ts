/**
 * InteractiveIslandsManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Advanced cursor-passthrough manager for the unified fullscreen overlay.
 *
 * The overlay window is globally click-through (pointer-events: none).
 * Only registered interactive regions should receive mouse/keyboard events.
 *
 * How it works:
 *   1. Components call `register(id, ref)` to track their DOM node.
 *   2. A rAF loop measures DOMRects and builds a flat list of hot regions.
 *   3. A document-level pointermove listener checks if the cursor is inside
 *      any hot region and calls invoke("set_cursor_passthrough", ...) accordingly.
 *
 * Scale-aware: DOMRect is in viewport coordinates so CSS transforms / zoom
 * are automatically accounted for by the browser's layout engine.
 *
 * Usage (React):
 *   const { register, unregister } = useInteractiveIslands();
 *   useEffect(() => {
 *     register("my-card", cardRef);
 *     return () => unregister("my-card");
 *   }, []);
 */
import { invoke } from "@tauri-apps/api/core";
import type { InteractiveRegion } from "../types";

// ─── Singleton state ──────────────────────────────────────────────────────────

type ElementRef = React.RefObject<HTMLElement | null> | HTMLElement;

const _refs = new Map<string, ElementRef>();
let _rafId: number | null = null;
let _isPassthrough = true;
let _lastX = -1;
let _lastY = -1;

// ─── Region measurement ───────────────────────────────────────────────────────

function measureRegions(): InteractiveRegion[] {
  const regions: InteractiveRegion[] = [];
  for (const [id, ref] of _refs) {
    const el = ref instanceof HTMLElement ? ref : ref.current;
    if (!el || !document.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      regions.push({ id, rect });
    }
  }
  return regions;
}

function isInsideAnyRegion(x: number, y: number, regions: InteractiveRegion[]): boolean {
  for (const { rect } of regions) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return true;
    }
  }
  return false;
}

// ─── Passthrough toggle (debounced by rAF) ────────────────────────────────────

async function syncPassthrough(inside: boolean): Promise<void> {
  if (inside === !_isPassthrough) return; // already correct
  const next = !inside;
  if (next === _isPassthrough) return;
  _isPassthrough = next;
  try {
    await invoke("set_cursor_passthrough", { passthrough: next });
  } catch {
    // Not a Tauri environment or command not registered — silently ignore
  }
}

// ─── Pointer listener ─────────────────────────────────────────────────────────

function onPointerMove(e: PointerEvent): void {
  _lastX = e.clientX;
  _lastY = e.clientY;
}

document.addEventListener("pointermove", onPointerMove, { passive: true });

// ─── rAF loop ─────────────────────────────────────────────────────────────────

function tick(): void {
  const regions = measureRegions();
  const inside = isInsideAnyRegion(_lastX, _lastY, regions);
  syncPassthrough(inside);
  _rafId = requestAnimationFrame(tick);
}

function startLoop(): void {
  if (_rafId !== null) return;
  _rafId = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const InteractiveIslandsManager = {
  /**
   * Register a DOM element (or React ref) as an interactive region.
   * The manager starts measuring it immediately.
   */
  register(id: string, ref: ElementRef): void {
    _refs.set(id, ref);
    if (_refs.size === 1) startLoop();
  },

  /**
   * Unregister an interactive region.
   * Stops the rAF loop when no regions remain.
   */
  unregister(id: string): void {
    _refs.delete(id);
    if (_refs.size === 0) stopLoop();
  },

  /** Return a snapshot of all currently measured regions (for debugging). */
  getRegions(): InteractiveRegion[] {
    return measureRegions();
  },

  /** Force-enable passthrough (e.g. during drag-end cleanup) */
  forcePassthrough(): void {
    _isPassthrough = true;
    invoke("set_cursor_passthrough", { passthrough: true }).catch(() => {});
  },

  /** Force-disable passthrough (e.g. when popover opens) */
  forceInteractive(): void {
    _isPassthrough = false;
    invoke("set_cursor_passthrough", { passthrough: false }).catch(() => {});
  },
} as const;

// ─── React hook ──────────────────────────────────────────────────────────────

import { useCallback } from "react";

/** Convenience React hook wrapping InteractiveIslandsManager */
export function useInteractiveIslands() {
  const register = useCallback(
    (id: string, ref: ElementRef) => InteractiveIslandsManager.register(id, ref),
    [],
  );
  const unregister = useCallback(
    (id: string) => InteractiveIslandsManager.unregister(id),
    [],
  );
  return { register, unregister };
}
