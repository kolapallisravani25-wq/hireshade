"use strict";

/**
 * Compiles the shared pure-TS modules from craft-vita into CommonJS files that
 * the Electron main process and preload can require at runtime.
 *
 * Why: main.js/preload.js run as CommonJS in Electron 37 (Node 22) where native
 * TypeScript type-stripping is not enabled, and a sandboxed preload cannot
 * require files outside its own inline scope. The single source of truth stays
 * in artifacts/craft-vita/src/overlay (unit-tested by vitest); this script emits
 * artifacts/desktop-electron/lib/*.js before dev/start.
 *
 * Usage: node scripts/build-main-helpers.js
 */
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const craftVitaRoot = path.resolve(__dirname, "..", "..", "craft-vita");
const outDir = path.resolve(__dirname, "..", "lib");

/** Source modules, relative to the craft-vita package root. */
const MODULES = [
  "src/overlay/hotkeys.ts",
  "src/overlay/overlayGeometry.ts",
];

function loadTypeScript() {
  try {
    return require(require.resolve("typescript", { paths: [repoRoot] }));
  } catch (error) {
    throw new Error(
      "typescript is required to build the Electron main helpers; run pnpm install at the repo root (" +
        error.message +
        ")",
    );
  }
}

function main() {
  const ts = loadTypeScript();
  fs.mkdirSync(outDir, { recursive: true });
  let built = 0;
  for (const relativeSource of MODULES) {
    const sourcePath = path.join(craftVitaRoot, relativeSource);
    const source = fs.readFileSync(sourcePath, "utf8");
    const output = ts.transpileModule(source, {
      fileName: sourcePath,
      reportDiagnostics: true,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    const errors = (output.diagnostics || []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    if (errors.length > 0) {
      const text = errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n");
      throw new Error("failed to compile " + relativeSource + ":\n" + text);
    }
    const outputName = path.basename(relativeSource, ".ts") + ".js";
    const outputPath = path.join(outDir, outputName);
    fs.writeFileSync(outputPath, output.outputText, "utf8");
    built += 1;
    console.log("[build-main-helpers] " + relativeSource + " -> " + path.relative(repoRoot, outputPath));
  }
  console.log("[build-main-helpers] wrote " + built + " CommonJS module(s) to " + path.relative(repoRoot, outDir));
}

try {
  main();
} catch (error) {
  console.error("[build-main-helpers] " + (error && error.message ? error.message : error));
  process.exitCode = 1;
}
