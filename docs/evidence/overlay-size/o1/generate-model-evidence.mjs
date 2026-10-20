#!/usr/bin/env node
/**
 * O1 pure-model evidence for docs/evidence/overlay-size/o1.
 *
 * Bundles the real O1 modules (no copies) with esbuild and records:
 *   - the 5-preset table,
 *   - layout/typography/contrast per viewport x DPI,
 *   - formatted first-screenful auto-fit + raw 400-word behaviour per preset,
 *   - per-preset persistence round-trip and the transform-only style patch.
 *
 * Usage: node docs/evidence/overlay-size/o1/generate-model-evidence.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const entry = path.join(root, "artifacts", "craft-vita", "src", "overlay", "presets", "index.ts");
const outfile = path.join(here, "o1-preset-model.json");

function findEsbuild() {
  const candidates = [
    path.join(root, "artifacts", "api-server", "node_modules", "esbuild", "lib", "main.js"),
    path.join(root, "artifacts", "craft-vita", "node_modules", "esbuild", "lib", "main.js"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const store = path.join(root, "node_modules", ".pnpm");
  for (const dir of readdirSync(store)) {
    if (!dir.startsWith("esbuild@")) continue;
    const candidate = path.join(store, dir, "node_modules", "esbuild", "lib", "main.js");
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("esbuild not found");
}

const { buildSync } = require(findEsbuild());
const bundle = buildSync({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: ["chrome120"],
  logLevel: "silent",
});
const dataUrl = "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text, "utf8").toString("base64");
const O1 = await import(dataUrl);

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];
const DPIS = [1, 1.25, 1.5, 2];

const words400 = Array.from({ length: 400 }, (_v, i) => "capability" + String(i + 1).padStart(3, "0")).join(" ");
const speakable = O1.formatSpeakableAnswer(
  "I led the rate-limiter redesign for a high-traffic public API. " +
    "I used a Redis token bucket per key and kept the hot path to one atomic increment. " +
    "The trade-off was a small amount of clock skew, which I bounded with a short TTL. " +
    "I measured p95 latency before and after and documented the rollback plan. " +
    "Would you like me to walk through the trade-offs?",
);

const assertions = [];
function check(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: detail ?? null });
}

check("default-preset-is-banner", O1.DEFAULT_OVERLAY_PRESET === "banner", O1.DEFAULT_OVERLAY_PRESET);
check("five-presets", O1.PRESET_LIST.length === 5, O1.PRESET_LIST.map((p) => p.id));
check("speakable-hook-12w", O1.countWords(speakable.hook) <= 12, speakable.hook);
check("speakable-screenful-40w", speakable.screenfulWords <= 40, speakable.screenfulWords);
check("speakable-bullets-2-4", speakable.bullets.length >= 2 && speakable.bullets.length <= 4, speakable.bullets.length);

const matrix = [];
for (const viewport of VIEWPORTS) {
  for (const dpi of DPIS) {
    for (const preset of O1.PRESET_LIST) {
      const state = O1.presetStateFor(preset.id, viewport, { devicePixelRatio: dpi });
      const typography = state.typography;
      const contrast = O1.checkContrast(preset);
      const minContrast = Math.min(...contrast.map((entry) => entry.ratio));
      const padding = preset.paddingPx;
      const formattedFit = O1.autoFitAnswer({
        text: speakable.plainText,
        availableWidthPx: state.layout.bounds.width - padding * 2,
        availableHeightPx: Math.min(
          preset.answerViewportMaxPx,
          state.layout.bounds.height - padding * 2 - 80,
        ),
        typography,
      });
      const rawFit = O1.autoFitAnswer({
        text: words400,
        availableWidthPx: state.layout.bounds.width - padding * 2,
        availableHeightPx: Math.min(
          preset.answerViewportMaxPx,
          state.layout.bounds.height - padding * 2 - 80,
        ),
        typography,
      });
      const rowPass =
        typography.fontPx >= 16 &&
        typography.lineHeightRatio >= 1.5 &&
        typography.maxCh <= 75 &&
        minContrast >= 7 &&
        formattedFit.fits &&
        state.opacity < 1 &&
        state.layout.bounds.x >= 0 &&
        state.layout.bounds.y >= 0 &&
        state.layout.bounds.x + state.layout.bounds.width <= viewport.width &&
        state.layout.bounds.y + state.layout.bounds.height <= viewport.height;
      if (!rowPass) check("matrix-" + preset.id + "-" + viewport.width + "x" + viewport.height + "@" + dpi, false, {
        fontPx: typography.fontPx,
        lineHeightRatio: typography.lineHeightRatio,
        maxCh: typography.maxCh,
        minContrast,
        formattedFits: formattedFit.fits,
        bounds: state.layout.bounds,
      });
      matrix.push({
        viewport,
        dpi,
        preset: preset.id,
        bounds: state.layout.bounds,
        fontCssPx: typography.fontPx,
        fontDevicePx: typography.fontPx * dpi,
        lineHeightRatio: typography.lineHeightRatio,
        maxCh: typography.maxCh,
        minContrastRatio: minContrast,
        opacity: state.opacity,
        scrimAlpha: state.scrimAlpha,
        formattedScreenful: {
          words: speakable.screenfulWords,
          fits: formattedFit.fits,
          fontPxWhenFitted: formattedFit.fontPx,
          lines: formattedFit.lines,
        },
        raw400Words: {
          fitsWithoutScroll: rawFit.fits,
          fontPx: rawFit.fontPx,
          lines: rawFit.lines,
          overflowPx: rawFit.overflowPx,
        },
        pass: rowPass,
      });
    }
  }
}
check("matrix-all-cells-pass", matrix.every((row) => row.pass), matrix.length + " cells");

// Per-preset persistence round-trip.
const storageMap = new Map();
const storage = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, value) => void storageMap.set(key, value),
};
let store = O1.emptyPresetStore();
for (const preset of O1.PRESET_LIST) {
  const layout = O1.computePresetLayout(preset.id, VIEWPORTS[0]);
  store = O1.storePresetState(store, layout, VIEWPORTS[0], 0.6);
}
O1.savePresetStore(storage, store);
const loaded = O1.loadPresetStore(storage);
check(
  "per-preset-persistence",
  O1.PRESET_LIST.every((preset) => loaded.perPreset[preset.id] !== undefined),
  Object.keys(loaded.perPreset),
);

// Transform-only style patch.
const patch = O1.presetStylePatch(O1.presetStateFor("banner", VIEWPORTS[0]));
const positionProps = Object.keys(patch).filter((key) => /^(top|left|right|bottom|margin)/.test(key));
check("transform-only-position", positionProps.length === 0, positionProps);
check("patch-whitelisted", Object.keys(patch).every((key) => O1.isPresetStyleProperty(key)), Object.keys(patch).length);

const evidence = {
  generatedAt: new Date().toISOString(),
  module: path.relative(root, entry).replace(/\\/g, "/"),
  generatedAtUtc: new Date().toISOString(),
  presetTable: O1.PRESET_LIST.map((preset) => ({
    id: preset.id,
    label: preset.label,
    geometry: preset.geometry,
    typography: preset.typography,
    defaultOpacity: preset.defaultOpacity,
    scrimAlpha: preset.scrimAlpha,
    scrimColor: preset.scrimColor,
    answerViewportMaxPx: preset.answerViewportMaxPx,
    dragAreaPx: preset.dragAreaPx,
    resizeHandlePx: preset.resizeHandlePx,
    fullScreenScrimAlpha: preset.fullScreenScrimAlpha,
  })),
  readability: {
    minFontCssPx: O1.MIN_READABLE_FONT_PX,
    minLineHeight: O1.MIN_LINE_HEIGHT_RATIO,
    maxMeasureCh: O1.MAX_MEASURE_CH,
    minContrastRatio: O1.MIN_CONTRAST_RATIO,
  },
  speakable,
  matrix,
  assertions,
  pass: assertions.every((assertion) => assertion.pass),
};
mkdirSync(here, { recursive: true });
writeFileSync(outfile, JSON.stringify(evidence, null, 2) + "\n");
console.log("[o1-model] " + (evidence.pass ? "PASS" : "FAIL") + " cells=" + matrix.length + " -> " + path.relative(root, outfile).replace(/\\/g, "/"));
for (const assertion of assertions) {
  console.log("[o1-model]   " + (assertion.pass ? "PASS" : "FAIL") + " " + assertion.name + " " + JSON.stringify(assertion.detail));
}
if (!evidence.pass) process.exit(1);
