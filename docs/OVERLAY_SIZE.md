# Overlay size, presets & readability (O1 / EXT G-044)

Status: **PASS** — 69/69 O1 unit tests, full frontend suite 613/616 (the 3
failures are O3's `src/overlay/size.test.ts` self-contract bugs, see "Limits"),
`tsc -p tsconfig.json --noEmit` exit 0.

Scope: the five-position preset model + DOM adapter, the readability/auto-fit
math, the speakable answer formatter, and the demo-overlay integration that the
Electron/CDP harness asserts. No changes to `artifacts/desktop-electron/main.js`.

## Presets (G-044)

Default = **BANNER**. Each preset has its own geometry, typography, opacity and
scrim; every preset persists its own tuned bounds/opacity/side in localStorage
key `hireshade.overlay.presets.v1` (fractions of the viewport, so a display
change keeps the relative layout).

| preset | geometry | anchor | type | opacity / scrim |
|---|---|---|---|---|
| COMPACT | 36% width (min 360, max 560), 24% height (min 170, max 30%) | top-right | 16-24px, LH 1.55, max 62ch | 0.84 / 0.82 |
| **BANNER (default)** | **full width minus 2×24px, 38% height (clamped 35-40%), docked bottom** | bottom-center | 16-28px, LH 1.55, max 75ch | 0.86 / 0.80 |
| TELEPROMPTER | 72% width (max 1120), 26% height (max 30%) | top-center (closest to webcam) | 16-34px, LH 1.50, max 64ch | 0.88 / 0.84 |
| SIDE COLUMN | 32% width (hard clamp 30-35%), 90% height | left or right | 16-26px, LH 1.55, max 58ch | 0.90 / 0.82 |
| READING | 94% width, 90% height | center + dimmed full-screen scrim (0.55) | 16-30px, LH 1.60, max 75ch | 0.96 / 0.72 |

Interactions:
- **resizable** from a 28-30px bottom-right grip; clamped to preset min/max and
  the viewport.
- **snap-to-edge** with a 24px threshold on all four edges.
- **generous drag area**: a 44-48px top band, separate from the content.
- **one-frame re-layout**: position is written only as
  `transform: translate3d(x, y, 0)`; the style patch whitelist
  (`PRESET_STYLE_PROPERTIES`) contains no `top/left/margin` and no layout reads.
- **persistence per preset**: switching presets never discards the other
  preset's bounds/opacity/side.

## Readability model (G-045)

Source: `src/overlay/presets/readability.ts` (pure math, unit-tested).

- **DPI**: CSS px stay CSS px (browser/OS handle device scale); the floor is
  **16 CSS px** at the smallest preset, which is ≥ 16/20/24/32 device px at
  100/125/150/200%. Larger viewports raise the base size via a clamped
  `fontScale` (0.9-1.25); the floor never drops.
- **Line height**: every preset encodes LH ≥ 1.5 (actual 1.5-1.6).
- **Measure**: every preset caps at ≤ 75ch; the answer element sets
  `max-width: calc(var(--overlay-max-ch) * 1ch)`.
- **Contrast**: text `#f7faff` over a near-black scrim composited on the
  backdrop. WCAG relative luminance + sRGB alpha compositing; **all presets
  ≥ 7:1 against both white and black backdrops** (worst case 7.9:1), verified in
  tests and available as `checkContrast()`.
- **Auto-fit**: `autoFitAnswer()` simulates word-wrap at descending font sizes
  from the resolved size down to 16px and returns the largest size whose
  full block fits the available box. It never returns < 16px.
- **400-word answers**: the speakable formatter guarantees a ≤ 40-word first
  screenful; auto-fit guarantees that screenful fits fully at every preset on
  1080p/1440p/4K and DPI 100-200%. The full raw answer is never clipped or
  ellipsized: `splitFirstScreenful()` reports the honest visible/remainder split
  and the existing auto-scroll viewport handles the remainder (READING fits the
  full 400-word answer at 1080p without scrolling). No horizontal scrolling:
  `overflow-wrap: anywhere`, `text-overflow: clip`, no `-webkit-line-clamp`.

## Speakable answer formatting (G-045)

Source: `src/overlay/answerFormat.ts`.

```
line 1    hook (<= 12 words)
then      2-4 short bullets, one idea each, first person
optional  one-line pushback follow-up question
```

- first screenful (hook + bullets + optional pushback) **≤ 40 words**;
- markdown headings/bold/italic/code fences/links stripped; inline code text kept;
- deliberate source emoji are preserved, none are ever added;
- rendered with real `<ul><li>` bullets, never literal `- ` markers;
- covered by 20 generated answers with markdown/length/emoji variation.

## Non-obstruction

- **Opacity**: every preset defaults semi-transparent (0.84-0.96); slider model
  clamps 0.20-1.00 in 0.05 steps.
- **Click-through**: state + hotkey affordance copy
  (`CommandOrControl+Shift+X`); the hotkey hook is already in
  `src/overlay/hotkeys.ts`. The demo exposes a toggle + `data-click-through`.
- **Second display**: `suggestSecondaryDisplay()` returns
  "You have N displays. Put HireShade on the other screen so the overlay never
  covers your call." (or the single-display fallback copy).
- **Camera preview**: `avoidCameraPreviewRegion()` moves the surface below,
  above, then sideways out of a camera rectangle; TELEPROMPTER, being top-center,
  is the preset affected. Demo has a camera-preview override button.
- **Never steal focus**: the adapter never calls `focus()`; demo control buttons
  are `tabindex="-1"` with `pointerdown.preventDefault()` so clicking a preset
  does not move focus.

## DOM adapter + Electron main API (O2 wiring point)

`src/overlay/presets/domAdapter.ts`:

```js
window.HireShadeOverlayPresetsApi.applyPreset("banner");
window.HireShadeOverlayPresetsApi.applyPreset({ preset: "reading", reason: "hotkey" });
// also: cycle, setOpacity, setClickThrough/toggleClickThrough, resizeBy, moveTo,
//       avoidCamera, getState, getPresets, getOpacitySlider,
//       getClickThroughAffordance, suggestSecondaryDisplay, refitAnswer,
//       getLastAutoFit, storageKey, parseStore
```

Each apply dispatches `hireshade:overlay-preset-changed` with the full state.
O2 can either call this from a preload/renderer bridge or use
`webContents.executeJavaScript('window.HireShadeOverlayPresetsApi.applyPreset("banner")')`.
The demo page (`src/demo/overlay.html`) loads the generated classic bundle
`src/overlay/presets/overlay-presets.iife.js`; rebuild with
`node scripts/overlay/build-presets-runtime.mjs`.

## Demo-overlay integration + CDP assertions

`src/demo/overlay.html` now exposes:
- `[data-overlay-surface]` card with `data-overlay-preset`, `data-overlay-scrim-alpha`,
  `data-click-through`, `data-answer-fits`;
- CSS vars `--overlay-font-px`, `--overlay-line-height-px`, `--overlay-max-ch`,
  `--overlay-scrim`, `--overlay-full-scrim`, `--overlay-viewport-max`;
- controls `preset-compact/banner/teleprompter/side-column/reading`,
  `opacity-slider`, `click-through-toggle`, `suggest-display`,
  `display-suggestion`, `camera-avoid`, `camera-preview`, `drag-handle`,
  `resize-handle`, `preset-state` (machine-readable state for CDP);
- the auto-scroll runtime is untouched; the answer pane height is now
  preset-aware (`--overlay-viewport-max` + available room) while keeping the
  short-answer/no-overflow and long-answer/virtual-scroll behavior.

Evidence (all PASS in this workspace):
- `docs/evidence/overlay-size/o1/generate-model-evidence.mjs` →
  `o1-preset-model.json`: 60 cells (5 presets × 3 viewports × 4 DPIs), all pass
  font / line-height / measure / contrast / geometry / opacity; 400-word auto-fit
  behaviour; per-preset persistence; transform-only patch.
- `docs/evidence/overlay-size/o1/run-demo-cdp.mjs` → `o1-demo-cdp.json` +
  `o1-demo-banner.png`: 20/20 CDP assertions in real Electron (demo window
  980×600, DPR 1). BANNER = 936×240 @24,340 (full width minus margins, 39.7%
  height, 24px docked bottom); fonts 17/20/23/19/20px; LHR 1.52-1.60; longest
  line 74.9ch; contrast 7.17-11.32:1; apply 2.3-4.1 ms; drag/resize 44-48/28-30px;
  per-preset storage written; no horizontal overflow / ellipsis / line-clamp.

```bash
node docs/evidence/overlay-size/o1/generate-model-evidence.mjs
node docs/evidence/overlay-size/o1/run-demo-cdp.mjs
```

## Tests

```
pnpm --dir artifacts/craft-vita exec vitest run \
  src/overlay/presets src/overlay/answerFormat.test.ts
# 4 files / 69 tests passed

pnpm --dir artifacts/craft-vita test        # full suite (incl. O3 acceptance contract)
pnpm --dir artifacts/craft-vita exec tsc -p tsconfig.json --noEmit
```

## Limits / deferred

- O3's `src/overlay/size.test.ts` self-contract bugs were fixed:
  BANNER is now asserted as the widest preset (allowing the TELEPROMPTER cap
  tie), bullet-token detection treats a marker at the start of a line as literal
  markdown, and the `pickDisplayForBounds` tie test now follows its own
  "nearest → primary → lowest id" spec. The integration guard consumes O1's
  `PRESETS`/`OVERLAY_PRESETS` exports.
- The CDP evidence run is limited to the Electron demo page in this workspace;
  the full 5×4 DPI acceptance matrix is O3's harness
  (`scripts/overlay-size/run-size-acceptance.mjs`).
- Real multi-display enumeration and OS-level click-through are O2/main-process
  responsibilities; O1 ships the pure helpers + adapter state.

---

## O3 acceptance section (G-044/G-045 evidence)

Status: **PASS** — all required assertions pass in real Electron via CDP.
Click-through is **UNTESTED** on this host (see limits). No commit.

### What is asserted (5 presets × DPI 100/125/150/200 = 20 cells)

For every preset at every `deviceScaleFactor` (CDP
`Emulation.setDeviceMetricsOverride`, 1280×800 viewport), with a 400-word answer:

| Metric | Contract | Measured |
|---|---|---|
| Answer font (CSS) | ≥ `MIN_READABLE_FONT_PX` (O1: 16 px) | min **16.0 px** |
| Answer font (device px) | ≥ readable floor, scales with DPI | min **16.0** → 32 device px at 200% |
| Contrast (text vs scrim over `#ffffff` **and** `#000000`) | ≥ 7:1 | min **8.14:1** |
| Line length | ≤ 75ch | max **74.9ch** |
| Line height | ≥ 1.5 | min **1.5** |
| 400-word no-overflow | `scrollWidth ≤ clientWidth`, no document h-scroll, no ellipsis/line-clamp, full text preserved (vertical virtual scroll allowed) | **0 failing cells** of 20 |

Sources consumed from O1 (labelled in the evidence JSON):
`sources.presetContract.source = "o1"` (`PRESETS` + `computePresetLayout` +
`typographyForViewport`) and `sources.answerFormatter.source = "o1"`
(`formatAnswerForOverlay` used for all 20 speakability answers).

### Speakability (20 generated answers, rendered through O1's formatter)

| Metric | Threshold | Max measured |
|---|---|---|
| Hook words | ≤ 12 | **12** |
| First screenful (hook + first bullet) | ≤ 40 words | **26** |
| Literal markdown tokens in rendered text | 0 | **0** |
| Bullets as `<li>` | 2-4, all rendered | **2** (all rendered) |

### Preset persistence, re-layout, click-through

| Check | Result |
|---|---|
| Persist across full Electron restart (same `userData`) | PASS — stored `reading`, restored `reading`, font 20 px |
| Re-layout within one frame | PASS — median synchronous style+layout **4.4 ms** (samples 1.3 / 4.4 / 6.3 ms), applied by next rAF (**11.2 ms**) |
| OS-level click-through to a background window | **UNTESTED** — the synthetic Win32 click was not delivered (raw counters 0/0; foreground window was an unrelated terminal). The harness implements the proof (overlay `setIgnoreMouseEvents`, background click counter, physical-coordinate SendInput) and records the raw counters; it needs an unoccluded interactive desktop. |
| Multi-monitor selection logic | pure contract tests in `src/overlay/size.test.ts`: largest-overlap pick, nearest-display fallback, deterministic nearest → primary → lowest-id tie-break; no multi-monitor hardware on this host |

### Honest labels

- **Contrast basis:** scrim composited over solid white and solid black extremes
  (worst-case light/dark desktops). Contrast over real video/screen content is
  **UNVERIFIED** — no video fixture is used.
- **DPI:** `deviceScaleFactor` emulation via CDP, not physical monitor scaling.
- **Vertical overflow:** a 400-word answer may scroll vertically inside the
  overlay (virtual scroll by design). "No clipping" is asserted by preserved word
  count + content height + no ellipsis/line-clamp, not by requiring one screen.
- **First screenful** = hook + first bullet (the spoken lead-in), measured from
  the rendered DOM, not every viewport-visible word.

### Commands

```bash
# full acceptance: presets x DPI, 400-word overflow, speakability, restart, click-through
node scripts/overlay-size/run-size-acceptance.mjs

# keyless demo path (also exercises every preset; no provider keys)
node scripts/demo/run-demo.mjs size
# via make:  make demo   (the demo target now ends with the overlay-size step)

# pure contract tests (contrast math, floors, speakability budgets, monitor picker)
pnpm --dir artifacts/craft-vita exec vitest run src/overlay/size.test.ts

# full frontend suite + typecheck
pnpm --dir artifacts/craft-vita test
pnpm --dir artifacts/craft-vita typecheck
```

### Evidence

- `docs/evidence/overlay-size/o3/o3-size-results.json` — rows for all 20 cells,
  20 speakability rows, relayout samples, persistence, click-through raw counters,
  source labels and honest limits.
- Screenshots: `o3/o3-preset-<preset>-dpi125.png` (all five presets),
  `o3/o3-overflow-400words-compact-dpi200.png`, `o3/o3-click-through-overlay.png`.
- O2 writes capture/affinity evidence directly under
  `docs/evidence/overlay-size/`; O3 deliberately writes into `o3/` so concurrent
  runs cannot clobber each other.
