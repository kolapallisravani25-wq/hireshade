# Overlay auto-scroll UX (W2)

Status: **PASS** — 31/31 Electron/CDP assertions, 46/46 headless unit tests.
Scope of this document: the framework-free auto-scroll core + DOM adapter, its
integration into the demo overlay page, and the recorded evidence.

## What was built

| # | UX requirement | Implementation | Proof |
|---|---|---|---|
| 1 | Sticky bottom while streaming | machine snaps on every content-growth event while pinned; adapter writes the transform in the ResizeObserver callback (pre-paint) | unit + CDP: 200-token stream, max distance from bottom **0.00 px** |
| 2 | Instant 24 px unlock, no snap-back | `user-scroll` distance > `UNLOCK_DISTANCE_PX=24` unpins in the same event; growth while unlocked never emits `snap-bottom` | unit (23 px keeps following / 25 px unlocks) + CDP: wheel-up 40 px unlocks in one frame; +30 tokens keeps the exact offset |
| 3 | Jump-to-latest pill; click/manual-bottom re-lock | pill visible only while unlocked+overflowing; click emits `animate-to-bottom`; manual return within `RELOCK_DISTANCE_PX=2` re-locks | CDP: pill visible after unlock, click re-locks to **0 px**; unit manual-bottom re-lock |
| 4 | New question: question in view, reset pane, keep answer start, then follow | `question-changed` → `scroll-question-into-view` + `reset-answer-viewport` + pinned follow | CDP: question top **32.3 px** in viewport, answer top **85.3 px**, follow distance **0 px** |
| 5 | ResizeObserver only, transform animation, reduced motion | single RO on viewport+content (no polling); rAF eased `translate3d` animation; `prefers-reduced-motion` → instant write | CDP: Chromium emulation reduce → pill click relocks with **0 px** distance in the same task |
| 6 | Never steal focus, never fight drag/resize | adapter never calls `focus()`; `setDragging()` / `overlay:drag-start|end` suspend snapping | CDP: activeElement stays `BODY`; unit drag test: no movement during drag, snap after drag end |
| 7 | PageUp/PageDown/Home/End/Space | document capture listener (ignores editable targets/modifiers), preventDefault, machine computes target offset | CDP: PageUp unlock, End relock, Home→0, Space page-down; unit target-offset table |
| 8 | Persist per session, restore on reopen | localStorage key `hireshade.overlay.scroll.v1:<sessionId>`; user changes persist immediately, streaming throttled; restored offset re-applied as late transcript content grows | CDP: saved offset **172** → reload → restored **172**, still unlocked + pill; unit late-render restore |
| 9 | ARIA live polite | adapter sets `role="log"`, `aria-live="polite"`, `aria-atomic="false"`, `aria-relevant="additions text"` on the answer pane | unit + DOM assertion |
| 10 | Short answer and 2000-token answer | pane height shrinks to content (border-compensated) for short answers; long content clipped and followed | CDP: short answer `maxOffset=0`, `offset=0`, no pill; 200-token stream pinned throughout |

## Architecture

```
artifacts/craft-vita/src/overlay/autoscroll/
  autoScrollMachine.ts   pure reducer: events -> state + commands (no DOM)
  overlayAutoScroll.ts   DOM adapter: transform virtual scroll, ResizeObserver,
                         persistence, keyboard, drag guard, ARIA, frame stats
  index.ts               barrel (consumers import from "@/overlay/autoscroll")
  overlay-autoscroll.iife.js  GENERATED classic bundle for the file:///http demo page
  *.test.ts              46 headless tests (node env + fake DOM)
```

The adapter is intentionally framework-free: the real overlay can mount it from a
`useEffect` without pulling React into the module. The machine owns every
decision; the adapter only executes commands (`snap-bottom`,
`animate-to-offset`, `scroll-question-into-view`, `show-pill`, …).

## Measured numbers

Source: [`docs/evidence/overlay-scroll/scroll-results.json`](evidence/overlay-scroll/scroll-results.json) (Electron 37.10.3, Chromium 138, 1004×644 viewport, dpr 1.05).

| Scenario | Measurement |
|---|---|
| 200-token stream | max distance from bottom **0.00 px** across 200 sampled growth frames; pinned at end |
| Per-frame update work (measure + transform write) | max **0.4 ms** (budget 16 ms); 99 transform updates (early tokens fit without overflow) |
| Scroll-up unlock | 40 px wheel → offset 184 → 144 in **one frame**, pill visible, pinned false |
| No snap-back | +30 tokens while unlocked → offset unchanged 144 |
| Pill click relock | pinned true, distance bottom **0 px**, pill hidden |
| New question | question top **32.3 px** into viewport, answer start **85.3 px** (visible), follow distance **0 px** |
| Reopen restore | saved {offset 172, pinned false} → restored **172**, unlocked + pill |
| Reduced motion | emulated reduce → instant relock, distance **0 px**, same task (no animation wait) |
| Short answer | `maxOffset=0`, offset 0, no pill |
| Keyboard | PageUp offset 229 (unlocked), End 229 (pinned), Home 0, Space 229, PageDown 229; activeElement BODY |
| Capture | 4.52 s, 205 frames, 30 fps, 632,589 B MP4 |

## Commands

```bash
# build the classic runtime bundle used by the demo page
node scripts/scroll/build-runtime.mjs

# 46 headless unit tests (machine + DOM adapter)
pnpm --dir artifacts/craft-vita exec vitest run src/overlay/autoscroll

# Electron/CDP scenario suite + screenshots + streaming capture
node scripts/scroll/overlay-scroll-e2e.mjs

# regression: the committed demo overlay page still passes its own e2e
node scripts/demo/overlay-e2e.mjs
```

The capture is produced with CDP `Page.startScreencast` frames and encoded with:

```bash
ffmpeg -framerate <fps> -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 \
  -i frame-%05d.jpg -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -movflags +faststart overlay-scroll-capture.mp4
```

## Integration

- The demo overlay page (`artifacts/craft-vita/src/demo/overlay.html`) now wraps
  the question+answer in a virtual-scroll viewport, includes the generated IIFE
  (classic script because `file://` blocks ES modules), creates the controller,
  and calls `notifyContentChanged()` after every replayed stream frame and
  `notifyQuestionChanged()` when the question changes. The previous
  `scripts/demo/overlay-e2e.mjs` DOM proof still passes (784-char answer).
- The generated runtime is committed at
  `src/overlay/autoscroll/overlay-autoscroll.iife.js` so the plain HTML demo can
  load it without a bundler. Regenerate with `node scripts/scroll/build-runtime.mjs`.

## Limits / not verified

- **React `SessionLayer` not wired yet.** `src/overlay/index.ts` was outside the
  task write scope, so the module is exported from `@/overlay/autoscroll`.
  Mounting it in the real overlay is a small `useEffect` adapter.
- **Frame budget is per-update work**, not compositor drop counts. `maxUpdateMs`
  is the measure+transform cost (0.4 ms). `maxFrameIntervalMs` in the results
  includes idle gaps between update frames (only post-overflow frames write), so
  it is reported but **not asserted**; continuous rAF sampling would be needed to
  claim "no dropped vsync frame" end-to-end.
- **Drag guard is covered by the fake-DOM unit test only.** The Electron capture
  has no OS window drag; the shell must emit `overlay:drag-start`/`overlay:drag-end`
  (or call `setDragging(true/false)`) while the window is dragged.
- **Capture harness drives tokens directly** (append text → `notifyContentChanged`)
  rather than replaying the full mock-session transcript, so the recording shows
  the streamed answer pane and pill behaviour, not ASR/LLM plumbing.
- Persistence uses `localStorage` for the http demo origin; a desktop build can
  inject a file-backed `StorageLike` via the adapter option.
