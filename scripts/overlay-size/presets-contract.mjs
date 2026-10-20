/**
 * O3 — overlay preset/readability contract (G-044/G-045).
 *
 * O1 owns the real preset model + answer formatter (src/overlay/presets/**,
 * src/overlay/answerFormat.ts). Those modules did not exist when this harness
 * was built, so the harness:
 *   1. probes for the O1 modules and consumes their exports when present
 *      (documented interface below), and
 *   2. otherwise uses the FALLBACK CONTRACT below — an explicitly labelled
 *      acceptance fixture, not a copy of the product implementation.
 *
 * Expected O1 interface (consumed when the files land):
 *   src/overlay/presets/index.ts | presets.ts
 *     export const OVERLAY_PRESETS (or PRESETS): PresetLike[]
 *     each: { id, label?, widthPx, heightPx, fontCssPx, lineHeight, maxCh, scrim }
 *   src/overlay/answerFormat.ts
 *     export function formatAnswerForOverlay(markdown: string): {
 *       hook: string; bullets: string[]; plainText: string;
 *     } | string
 *
 * Anything the probe cannot consume falls back and is reported in the evidence
 * JSON (source: "o1" | "contract-fallback", warnings[]).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

export const PRESET_IDS = ["compact", "banner", "teleprompter", "side-column", "reading"];

/** Readability floors from G-045. */
export const READABILITY_FLOORS = {
  minFontCssPx: 14,
  /**
   * Device-pixel floor at DPI 100. CSS px scale with the display scale factor,
   * so the same 14 css px minimum yields 14 / 17.5 / 21 / 28 device px at
   * 100/125/150/200% (the harness records that scaling per cell).
   */
  minDevicePx: 14,
  maxLineCh: 75,
  minLineHeight: 1.5,
  minContrastRatio: 7,
};

export const FALLBACK_PRESETS = [
  {
    id: "compact",
    label: "COMPACT",
    widthPx: 520,
    heightPx: 430,
    fontCssPx: 15,
    lineHeight: 1.5,
    maxCh: 60,
    scrim: "rgba(8, 10, 16, 0.82)",
    description: "Small corner overlay; tightest reading density.",
  },
  {
    id: "banner",
    label: "BANNER",
    widthPx: 860,
    heightPx: 520,
    fontCssPx: 18,
    lineHeight: 1.55,
    maxCh: 72,
    scrim: "rgba(8, 10, 16, 0.8)",
    description: "Default wide banner across the lower screen.",
  },
  {
    id: "teleprompter",
    label: "TELEPROMPTER",
    widthPx: 900,
    heightPx: 600,
    fontCssPx: 26,
    lineHeight: 1.6,
    maxCh: 55,
    scrim: "rgba(4, 6, 10, 0.86)",
    description: "Large type for glancing during a live answer.",
  },
  {
    id: "side-column",
    label: "SIDE COLUMN",
    widthPx: 480,
    heightPx: 640,
    fontCssPx: 16,
    lineHeight: 1.55,
    maxCh: 52,
    scrim: "rgba(10, 12, 18, 0.84)",
    description: "Tall narrow column for side-by-side layouts.",
  },
  {
    id: "reading",
    label: "READING",
    widthPx: 780,
    heightPx: 620,
    fontCssPx: 20,
    lineHeight: 1.65,
    maxCh: 65,
    scrim: "rgba(12, 14, 20, 0.86)",
    description: "Comfortable long-form reading mode.",
  },
];

export const REQUIRED_PRESET_IDS = PRESET_IDS;
export const DEFAULT_PRESET_ID = "banner";

export function presetById(presets, id) {
  const found = presets.find((preset) => preset.id === id);
  if (!found) throw new Error("Unknown preset: " + id);
  return found;
}

/** Normalises an O1 preset object into this harness' shape, defensively. */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return null;
  const widthPx = Number(raw.widthPx ?? raw.width ?? 0);
  const heightPx = Number(raw.heightPx ?? raw.height ?? 0);
  if (!(widthPx > 0) || !(heightPx > 0)) return null;
  return {
    id,
    label: String(raw.label ?? id.toUpperCase()),
    widthPx,
    heightPx,
    fontCssPx: Number(raw.fontCssPx ?? raw.fontSize ?? 16),
    lineHeight: Number(raw.lineHeight ?? 1.5),
    maxCh: Number(raw.maxCh ?? raw.maxLineCh ?? 75),
    scrim: String(raw.scrim ?? raw.backgroundColor ?? "rgba(8,10,16,0.8)"),
    description: String(raw.description ?? ""),
  };
}

function findEsbuild(root) {
  const candidates = [
    path.join(root, "artifacts", "api-server", "node_modules", "esbuild", "lib", "main.js"),
    path.join(root, "artifacts", "craft-vita", "node_modules", "esbuild", "lib", "main.js"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

function probeFile(root, relativePaths) {
  for (const relativePath of relativePaths) {
    const candidate = path.join(root, relativePath);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function bundleToDataUrl(esbuildPath, entryPath) {
  const esbuild = require(esbuildPath);
  const result = esbuild.buildSync({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
    target: ["chrome120"],
    logLevel: "silent",
  });
  const text = result.outputFiles[0].text;
  return "data:text/javascript;base64," + Buffer.from(text, "utf8").toString("base64");
}

/**
 * Resolves the preset table: O1 export when available, otherwise the fallback
 * contract. Never throws: warnings are surfaced in the evidence JSON.
 */
/** eslint-disable-next-line no-unused-vars */
function unusedMarker() {}

function scrimFromPreset(raw) {
  if (typeof raw.scrim === "string") return raw.scrim;
  const color = typeof raw.scrimColor === "string" ? raw.scrimColor : "#05070c";
  const alpha = Number(raw.scrimAlpha ?? 0.82);
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return "rgba(" + r + ", " + g + ", " + b + ", " + Math.max(0, Math.min(1, alpha)) + ")";
}

/** Maps an O1 OverlayPreset + computed layout/typography into the harness shape. */
function mapO1Preset(raw, layout, resolvedTypography) {
  return {
    id: raw.id,
    label: String(raw.label ?? raw.id.toUpperCase()),
    widthPx: layout.width,
    heightPx: layout.height,
    fontCssPx: resolvedTypography.fontPx,
    lineHeight: resolvedTypography.lineHeightRatio,
    maxCh: resolvedTypography.maxCh,
    scrim: scrimFromPreset(raw),
    description: String(raw.description ?? ""),
    sourceGeometry: {
      x: layout.x,
      y: layout.y,
      widthRatio: raw.geometry?.widthRatio ?? null,
      heightRatio: raw.geometry?.heightRatio ?? null,
      anchor: raw.geometry?.anchor ?? null,
    },
  };
}

function effectiveFloors(exports) {
  return {
    minFontCssPx: Number(exports.MIN_READABLE_FONT_PX ?? READABILITY_FLOORS.minFontCssPx),
    minDevicePx: Number(exports.MIN_READABLE_FONT_PX ?? READABILITY_FLOORS.minFontCssPx),
    maxLineCh: Number(exports.MAX_MEASURE_CH ?? READABILITY_FLOORS.maxLineCh),
    minLineHeight: Number(exports.MIN_LINE_HEIGHT_RATIO ?? READABILITY_FLOORS.minLineHeight),
    minContrastRatio: Number(exports.MIN_CONTRAST_RATIO ?? READABILITY_FLOORS.minContrastRatio),
  };
}

export async function loadPresetContract(root) {
  const warnings = [];
  const presetsPath = probeFile(root, [
    "artifacts/craft-vita/src/overlay/presets/index.ts",
    "artifacts/craft-vita/src/overlay/presets.ts",
  ]);
  const esbuildPath = findEsbuild(root);
  if (!presetsPath) {
    return { source: "contract-fallback", presets: FALLBACK_PRESETS, floors: READABILITY_FLOORS, presetsPath: null, warnings: ["O1 presets module not found; using documented fallback contract"] };
  }
  if (!esbuildPath) {
    return { source: "contract-fallback", presets: FALLBACK_PRESETS, floors: READABILITY_FLOORS, presetsPath, warnings: ["esbuild unavailable; cannot consume O1 presets module"] };
  }
  try {
    const exports = await import(await bundleToDataUrl(esbuildPath, presetsPath));
    const floors = effectiveFloors(exports);
    // O1 shape: PRESETS is a Record<id, OverlayPreset>; geometry/typography are
    // computed from the 1280x800 acceptance viewport (the CDP emulated size).
    if (exports.PRESETS && typeof exports.PRESETS === "object" && !Array.isArray(exports.PRESETS)) {
      const viewport = { width: 1280, height: 800 };
      const presets = REQUIRED_PRESET_IDS.map(function (id) {
        const raw = exports.PRESETS[id];
        if (!raw) throw new Error("missing O1 preset: " + id);
        const layout = exports.computePresetLayout
          ? exports.computePresetLayout(id, viewport).bounds
          : { x: 0, y: 0, width: raw.geometry?.maxWidthPx ?? 900, height: raw.geometry?.minHeightPx ?? 420 };
        const typography = exports.typographyForViewport
          ? exports.typographyForViewport(raw, viewport, 1.25)
          : {
              fontPx: raw.typography?.baseFontPx ?? 16,
              lineHeightRatio: raw.typography?.lineHeightRatio ?? 1.5,
              maxCh: raw.typography?.maxCh ?? 75,
            };
        return mapO1Preset(raw, layout, typography);
      });
      return { source: "o1", presets: presets, floors: floors, presetsPath, warnings };
    }
    const rawPresets = exports.OVERLAY_PRESETS ?? exports.PRESET_LIST ?? exports.default;
    if (!Array.isArray(rawPresets)) throw new Error("no preset array export");
    const normalized = rawPresets.map(function (raw) {
      return normalizePreset(raw);
    }).filter(Boolean);
    const missing = REQUIRED_PRESET_IDS.filter(function (id) {
      return !normalized.some(function (preset) { return preset.id === id; });
    });
    if (missing.length) throw new Error("missing presets: " + missing.join(", "));
    return { source: "o1", presets: normalized, floors: floors, presetsPath, warnings };
  } catch (error) {
    warnings.push("failed to consume O1 presets module (" + String(error && error.message ? error.message : error) + "); using fallback contract");
    return { source: "contract-fallback", presets: FALLBACK_PRESETS, floors: READABILITY_FLOORS, presetsPath, warnings };
  }
}

/**
 * Resolves the answer formatter: O1 answerFormat when available, else the
 * documented fallback formatter from speakability.mjs.
 */
export async function loadAnswerFormatter(root, fallbackFormat) {
  const warnings = [];
  const formatPath = probeFile(root, ["artifacts/craft-vita/src/overlay/answerFormat.ts"]);
  const esbuildPath = findEsbuild(root);
  if (!formatPath) {
    return { source: "contract-fallback", format: fallbackFormat, formatPath: null, warnings: ["O1 answerFormat module not found; using documented fallback formatter"] };
  }
  if (!esbuildPath) {
    return { source: "contract-fallback", format: fallbackFormat, formatPath, warnings: ["esbuild unavailable; cannot consume O1 answerFormat module"] };
  }
  try {
    const exports = await import(await bundleToDataUrl(esbuildPath, formatPath));
    const format = exports.formatAnswerForOverlay;
    if (typeof format !== "function") throw new Error("formatAnswerForOverlay export missing");
    return { source: "o1", format: format, formatPath, warnings };
  } catch (error) {
    warnings.push("failed to consume O1 answerFormat module (" + String(error && error.message ? error.message : error) + "); using fallback formatter");
    return { source: "contract-fallback", format: fallbackFormat, formatPath, warnings };
  }
}

export { pathToFileURL };
