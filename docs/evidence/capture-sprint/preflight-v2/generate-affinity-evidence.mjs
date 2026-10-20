#!/usr/bin/env node
/**
 * V2 affinity-routing evidence (black box is a targeted mitigation, never a default).
 *
 * Bundles the REAL pre-flight modules with esbuild and asserts:
 *   - 0x01 (black box) is never offered on setups that are not known-DXGI/high-risk
 *     single-display setups;
 *   - the cost copy (GDI/PrintWindow/desktopCapturer lose invisibility for a
 *     discoverable black band) is present in the action + verdict copy;
 *   - black box ON without justification offers the undo;
 *   - black box ON with justification recommends COMPACT via a one-click action.
 *
 * Usage: node docs/evidence/capture-sprint/preflight-v2/generate-affinity-evidence.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const outfile = path.join(here, "v2-affinity-preflight.json");

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
async function loadModule(relativePath) {
  const bundle = buildSync({
    entryPoints: [path.join(root, "artifacts", "craft-vita", "src", "overlay", "preflight", relativePath)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: ["chrome120"],
    logLevel: "silent",
  });
  const url = "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text, "utf8").toString("base64");
  return import(url);
}

const Preflight = await loadModule("preflight.ts");
const Actions = await loadModule("actions.ts");

const assertions = [];
function check(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
}

const primary = { id: 1, primary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondary = { id: 2, primary: false, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
const base = (overrides = {}) => ({
  displays: [primary],
  overlay: { displayId: 1, preset: "banner", transparent: true, areaRatio: 0.2 },
  detectedApps: [],
  userReport: null,
  compatMode: false,
  capturePathHint: null,
  ...overrides,
});

const cases = [
  { name: "exclude-good-path-unknown-app", input: base(), expectOffer: false },
  { name: "exclude-medium-risk-app", input: base({ detectedApps: [{ appId: "google-meet", matchedBy: "process", matchedValue: "chrome.exe" }] }), expectOffer: false },
  { name: "exclude-generic-visible-report", input: base({ userReport: "visible" }), expectOffer: false },
  { name: "exclude-hint-but-user-confirmed-hidden", input: base({ capturePathHint: "dxgi", userReport: "hidden" }), expectOffer: false },
  { name: "exclude-high-risk-with-second-display", input: base({ displays: [primary, secondary], detectedApps: [{ appId: "zoom", matchedBy: "process", matchedValue: "zoom.exe" }] }), expectOffer: false },
  { name: "exclude-known-dxgi-single-display", input: base({ capturePathHint: "DXGI Desktop Duplication" }), expectOffer: true },
  { name: "exclude-high-risk-single-display", input: base({ detectedApps: [{ appId: "zoom", matchedBy: "process", matchedValue: "zoom.exe" }] }), expectOffer: true },
  { name: "monitor-unjustified-banner", input: base({ affinityMode: "monitor", overlay: { displayId: 1, preset: "banner" } }), expectOffer: false },
  { name: "monitor-justified-banner", input: base({ affinityMode: "monitor", capturePathHint: "dxgi", overlay: { displayId: 1, preset: "banner" } }), expectOffer: false },
  { name: "monitor-justified-compact", input: base({ affinityMode: "monitor", capturePathHint: "dxgi", overlay: { displayId: 1, preset: "card" } }), expectOffer: false },
  { name: "monitor-visible-report", input: base({ affinityMode: "monitor", userReport: "visible" }), expectOffer: false },
];

const matrix = cases.map((testCase) => {
  const verdict = Preflight.evaluatePreflight(testCase.input);
  const actionIds = verdict.actions.map((action) => action.id);
  const offersBlackBox = actionIds.includes("enable-black-box-mode");
  check(
    "offer-rule-" + testCase.name,
    offersBlackBox === testCase.expectOffer && verdict.facts.blackBoxEligible === testCase.expectOffer,
    { offered: offersBlackBox, eligible: verdict.facts.blackBoxEligible, actions: actionIds },
  );
  return {
    name: testCase.name,
    status: verdict.status,
    affinityMode: verdict.facts.affinityMode,
    blackBoxEligible: verdict.facts.blackBoxEligible,
    blackBoxJustified: verdict.facts.blackBoxJustified,
    offersBlackBox,
    actions: verdict.actions,
    message: verdict.message,
    recommendation: verdict.recommendation,
    headline: verdict.headline,
    pass: offersBlackBox === testCase.expectOffer,
  };
});

check(
  "never-defaults-to-0x01",
  matrix
    .filter((row) => row.offersBlackBox)
    .every((row) => row.status === "RED" && row.actions[0] && row.actions[0].kind === "one-click"),
  matrix.filter((row) => row.offersBlackBox).map((row) => ({ row: row.name, status: row.status })),
);
check(
  "offered-only-for-known-dxgi-or-high-risk-single-display",
  matrix.filter((row) => row.offersBlackBox).map((row) => row.name).join(",") ===
    "exclude-known-dxgi-single-display,exclude-high-risk-single-display",
  matrix.filter((row) => row.offersBlackBox).map((row) => row.name),
);

const costDescription = Actions.PREFLIGHT_ACTION_CATALOG["enable-black-box-mode"].description.toLowerCase();
for (const token of ["gdi", "printwindow", "desktopcapturer", "black band", "discoverable", "not as an upgrade"]) {
  check("cost-copy-action-" + token, costDescription.includes(token), Actions.PREFLIGHT_ACTION_CATALOG["enable-black-box-mode"].description);
}
for (const token of ["gdi", "printwindow", "desktopcapturer", "black band", "discoverable"]) {
  check("cost-copy-constant-" + token, Preflight.BLACK_BOX_COST_COPY.toLowerCase().includes(token), Preflight.BLACK_BOX_COST_COPY);
}

const undo = Preflight.evaluatePreflight(base({ affinityMode: "monitor", overlay: { displayId: 1, preset: "banner" } }));
check(
  "undo-offered-when-unjustified",
  undo.actions.map((action) => action.id).join(",") === "switch-back-to-invisible,switch-to-compact" &&
    undo.message.includes("not targeted at anything here"),
  undo.actions.map((action) => action.id),
);
const compact = Preflight.evaluatePreflight(
  base({ affinityMode: "monitor", capturePathHint: "dxgi", overlay: { displayId: 1, preset: "banner" } }),
);
check(
  "switch-to-compact-offered-when-justified",
  compact.actions.map((action) => action.id).join(",") === "switch-to-compact" &&
    compact.recommendation.recommendedPresetId === "card" &&
    compact.recommendation.copy.toLowerCase().includes("docked panel"),
  { actions: compact.actions.map((action) => action.id), recommendedPresetId: compact.recommendation.recommendedPresetId },
);
const justifiedCompact = Preflight.evaluatePreflight(
  base({ affinityMode: "monitor", capturePathHint: "dxgi", overlay: { displayId: 1, preset: "card" } }),
);
check(
  "justified-compact-is-green",
  justifiedCompact.status === "GREEN" && justifiedCompact.actions.length === 0,
  justifiedCompact.status,
);

const evidence = {
  generatedAt: new Date().toISOString(),
  modules: {
    preflight: "artifacts/craft-vita/src/overlay/preflight/preflight.ts",
    actions: "artifacts/craft-vita/src/overlay/preflight/actions.ts",
  },
  fact: "0x11 (exclude) is invisible on good paths and leaks on DXGI; 0x01 (monitor/black box) is black on GDI/PrintWindow/DXGI, so it is a targeted mitigation, not an upgrade.",
  matrix,
  copy: {
    blackBoxActionDescription: Actions.PREFLIGHT_ACTION_CATALOG["enable-black-box-mode"].description,
    blackBoxCostCopy: Preflight.BLACK_BOX_COST_COPY,
    blackBoxJustifiedCopy: Preflight.BLACK_BOX_JUSTIFIED_COPY,
    blackBoxUndoCopy: Preflight.BLACK_BOX_UNDO_COPY,
    undoVerdictMessage: undo.message,
    switchToCompactMessage: compact.message,
  },
  assertions,
  pass: assertions.every((assertion) => assertion.pass),
};
mkdirSync(here, { recursive: true });
writeFileSync(outfile, JSON.stringify(evidence, null, 2) + "\n");
console.log("[preflight-v2] " + (evidence.pass ? "PASS" : "FAIL") + " rows=" + matrix.length + " -> " + path.relative(root, outfile).replace(/\\/g, "/"));
for (const assertion of assertions) console.log("[preflight-v2]   " + (assertion.pass ? "PASS" : "FAIL") + " " + assertion.name);
if (!evidence.pass) process.exit(1);
