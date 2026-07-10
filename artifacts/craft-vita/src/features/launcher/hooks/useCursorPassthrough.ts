import { useEffect, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { tauriOverlay } from "@/services/tauriOverlay";

interface UseCursorPassthroughOptions {
  isDraggingRef: RefObject<boolean>;
  forceInteractive?: boolean;
  forcePassthrough?: boolean;
}

/**
 * Polls the OS cursor position and toggles Tauri's setIgnoreCursorEvents
 * based on whether the cursor overlaps a [data-interactive] element.
 *
 * CRITICAL: WKWebView/WebView2 receives ZERO mouse events while pass-through
 * is ON, so we cannot use mousemove. We poll a Rust command on a setTimeout
 * chain.
 *
 * Key design constraints:
 *
 * 1. Loop immortality — the continuation MUST be in the outermost finally block
 *    so the loop survives every exit path: early return (forcePassthrough /
 *    isDragging), exceptions, and concurrent-skip guards. Any `return` inside
 *    a try block skips code after that block, so a single missed scheduling
 *    call kills the loop permanently. Previously the continuation was outside
 *    the try/finally, so early returns murdered it.
 *
 * 2. setTimeout, not RAF — WKWebView pauses requestAnimationFrame callbacks
 *    while HireShade is not the active macOS application. setTimeout keeps
 *    firing while deactivated, so the cursor poll continues and passthrough
 *    recovers (window becomes interactive) BEFORE the user's first click back.
 *
 * 3. macOS watchdog — every REASSERT_INTERVAL_MS the desired native state is
 *    re-applied even if our cached JS value is unchanged, bounding any
 *    JS/native desync to that interval. Disabled on Windows (would reintroduce
 *    DWM surface flicker from excessive setIgnoreCursorEvents churn, WN1/WN6).
 *
 * 4. Blur cache invalidation — on app deactivation we drop the window-bounds /
 *    scale cache and clear lastPassthrough so the very next poll re-asserts
 *    native state from scratch, eliminating any desync without waiting for the
 *    watchdog.
 */
export function useCursorPassthrough({
  isDraggingRef,
  forceInteractive = false,
  forcePassthrough = false,
}: UseCursorPassthroughOptions): void {
  useEffect(() => {
    let timer = 0;
    let startTimeout = 0;
    let cancelled = false;
    // Prevent concurrent ticks: if an IPC await is still pending when the
    // next scheduled tick fires, skip the body but still schedule the next.
    let isTickRunning = false;
    let lastPassthrough: boolean | null = null;
    let cachedScale = 1;
    let cachedWinPos = { x: 0, y: 0 };
    let lastCacheUpdate = 0;
    let idleCycles = 0;
    let lastReassert = 0;

    const ua = navigator.userAgent.toLowerCase();
    const isWindows = ua.includes("windows");
    const POLL_BASE_MS = isWindows ? 120 : 32;
    const POLL_IDLE_MS = isWindows ? 240 : 64;
    const IDLE_THRESHOLD = 6;
    const CACHE_TTL_MS = isWindows ? 400 : 500;
    // Re-assert native passthrough state every 200 ms on macOS to bound any
    // JS/native desync after Space transitions, deactivation, etc.
    // Kept tighter than the previous 400 ms for faster first-click recovery.
    const REASSERT_INTERVAL_MS = 200;

    async function setPassthrough(p: boolean, force = false) {
      if (cancelled) return;
      const changed = p !== lastPassthrough;
      if (!changed && !force) return;
      lastPassthrough = p;
      if (changed) idleCycles = 0;
      try {
        await tauriOverlay.setIgnoreCursorEvents(p);
        if (changed) {
          console.debug(
            `[passthrough] state -> ${p ? "PASSTHROUGH" : "INTERACTIVE"}`,
          );
        }
      } catch (e) {
        console.error("[passthrough] setIgnoreCursorEvents failed", e);
      }
    }

    function collectInteractiveRects(): DOMRect[] {
      const nodes = document.querySelectorAll<HTMLElement>("[data-interactive]");
      const rects: DOMRect[] = [];
      for (let i = 0; i < nodes.length; i++) {
        rects.push(nodes[i].getBoundingClientRect());
      }
      return rects;
    }

    function isPointInRects(rects: DOMRect[], x: number, y: number) {
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
      }
      return false;
    }

    async function runTickBody() {
      // forcePassthrough / isDragging / forceInteractive are fast paths that do
      // not need cursor-position IPC. They no longer use early `return` — instead
      // they just resolve `desired` and fall through to the single setPassthrough
      // call, so the outer finally always schedules the next tick.
      let desired: boolean;

      if (forcePassthrough) {
        desired = true;
      } else if (isDraggingRef.current || forceInteractive) {
        desired = false;
      } else {
        const now = performance.now();
        if (now - lastCacheUpdate > CACHE_TTL_MS) {
          lastCacheUpdate = now;
          const [pos, scale] = await Promise.all([
            tauriOverlay.getOuterPosition(),
            tauriOverlay.getScaleFactor(),
          ]);
          cachedWinPos = { x: pos.x, y: pos.y };
          cachedScale = scale;
        }

        const [gx, gy] = await tauriOverlay.getCursorPosition();

        // Test both physical and logical coordinate conversions so DPI scaling
        // ambiguity (Retina macOS, Windows 125%/150%) never causes a miss.
        const localPhysX = (gx - cachedWinPos.x) / cachedScale;
        const localPhysY = (gy - cachedWinPos.y) / cachedScale;
        const localLogX = gx - cachedWinPos.x;
        const localLogY = gy - cachedWinPos.y;

        const rects = collectInteractiveRects();
        const over =
          isPointInRects(rects, localPhysX, localPhysY) ||
          isPointInRects(rects, localLogX, localLogY);

        desired = !over;

        // macOS watchdog: periodically force-re-assert native state to bound
        // JS/native desync after deactivation or Space transitions.
        const forceReassert = !isWindows && now - lastReassert > REASSERT_INTERVAL_MS;
        if (forceReassert) lastReassert = now;

        const before = lastPassthrough;
        await setPassthrough(desired, forceReassert);
        if (lastPassthrough === before) {
          idleCycles = Math.min(idleCycles + 1, IDLE_THRESHOLD + 1);
        }
        return; // already called setPassthrough above
      }

      // fast-path: forcePassthrough or isDragging/forceInteractive
      await setPassthrough(desired);
    }

    async function tick() {
      if (cancelled) return;

      // The outermost finally ALWAYS schedules the next tick regardless of
      // how the body exits: normal completion, early return (isTickRunning
      // guard), or any thrown exception. This is the single most important
      // invariant — without it the loop dies the first time the body is
      // skipped or throws.
      try {
        if (isTickRunning) return;
        isTickRunning = true;
        try {
          await runTickBody();
        } catch (e) {
          console.debug("[passthrough] tick error", e);
        } finally {
          isTickRunning = false;
        }
      } finally {
        if (!cancelled) {
          const interval = idleCycles >= IDLE_THRESHOLD ? POLL_IDLE_MS : POLL_BASE_MS;
          // setTimeout keeps firing while the macOS app is deactivated.
          // RAF pauses, which is why we switched: cursor state still updates
          // so the window becomes interactive before the user's first click.
          timer = window.setTimeout(() => void tick(), interval);
        }
      }
    }

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-interactive]")) {
        event.preventDefault();
        void setPassthrough(true);
      }
    };
    document.addEventListener("contextmenu", handleContextMenu, true);

    // On app deactivation: drop the window-bounds/scale cache and nullify
    // lastPassthrough so the very next poll tick re-asserts native state
    // unconditionally, eliminating any desync without waiting for the watchdog.
    // blur/visibilitychange fire on focus events, not mouse events, so they
    // work even while the window is in passthrough mode.
    const invalidateForRecovery = () => {
      lastCacheUpdate = 0;
      lastPassthrough = null;
      lastReassert = 0; // also reset watchdog so next tick is a force-reassert
    };
    const handleBlur = () => invalidateForRecovery();
    const handleVisibility = () => { if (!document.hidden) invalidateForRecovery(); };
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    // CRITICAL (Windows input-capture bug): the window-position cache must be
    // dropped the instant the window moves or resizes. Otherwise, after a drag,
    // the poll hit-tests the cursor against the OLD window bounds, wrongly
    // concludes the cursor is over an interactive region, and pins the whole
    // transparent overlay in click-CAPTURE mode — swallowing clicks meant for
    // every other app on screen until the stale cache expires. Re-assert from
    // scratch on move/resize so passthrough tracks reality immediately.
    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    const appWindow = getCurrentWindow();
    appWindow
      .onMoved(() => invalidateForRecovery())
      .then((u) => {
        if (cancelled) u();
        else unlistenMove = u;
      })
      .catch(() => {});
    appWindow
      .onResized(() => invalidateForRecovery())
      .then((u) => {
        if (cancelled) u();
        else unlistenResize = u;
      })
      .catch(() => {});

    const scheduleFirstTick = () => {
      timer = window.setTimeout(() => void tick(), 0);
    };
    if (isWindows) {
      startTimeout = window.setTimeout(scheduleFirstTick, 300);
    } else {
      scheduleFirstTick();
    }

    return () => {
      cancelled = true;
      clearTimeout(startTimeout);
      clearTimeout(timer);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      unlistenMove?.();
      unlistenResize?.();
      tauriOverlay.setIgnoreCursorEvents(true).catch(console.error);
    };
  }, [forceInteractive, forcePassthrough, isDraggingRef]);
}
