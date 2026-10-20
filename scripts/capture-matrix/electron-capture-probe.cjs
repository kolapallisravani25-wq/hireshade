"use strict";

/**
 * Chromium capture-path probe for the O2 matrix.
 *
 * Runs as a small Electron app while the HireShade shell is open and captures a
 * screen thumbnail + window-source thumbnails through
 * desktopCapturer.getSources(). On Windows this exercises Chromium's own capture
 * path (Windows Graphics Capture / DXGI depending on OS + flags), which is the
 * path a Chrome "share entire screen" flow uses underneath.
 *
 * Usage (ELECTRON_RUN_AS_NODE must be unset):
 *   set O2_PROBE_OUT=docs/evidence/overlay-size
 *   set O2_PROBE_LABEL=banner-stealth-on
 *   electron scripts/capture-matrix/electron-capture-probe.cjs
 */
const { app, desktopCapturer, screen } = require("electron");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const outDir = process.env.O2_PROBE_OUT
  ? path.resolve(process.env.O2_PROBE_OUT)
  : path.join(repoRoot, "docs", "evidence", "overlay-size");
const label = process.env.O2_PROBE_LABEL || "probe";

function safeName(value) {
  return String(value || "source").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await app.whenReady();
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const physical = {
    width: Math.round(display.size.width * scaleFactor),
    height: Math.round(display.size.height * scaleFactor),
  };
  const result = {
    captured_at: new Date().toISOString(),
    label: label,
    method: "Electron desktopCapturer.getSources() thumbnails (Chromium Windows capture path; screen + window sources)",
    display: {
      id: display.id,
      size: display.size,
      workArea: display.workArea,
      scaleFactor: scaleFactor,
      physical: physical,
    },
    screen_sources: [],
    window_sources: [],
  };

  const screenSources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: physical,
    fetchWindowIcons: false,
  });
  screenSources.forEach(function (source, index) {
    const fileName = "desktopcapturer-" + label + "-screen-" + index + ".png";
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, source.thumbnail.toPNG());
    result.screen_sources.push({
      id: source.id,
      name: source.name,
      path: filePath,
      thumbnail_size: source.thumbnail.getSize(),
    });
  });

  const windowSources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: Math.min(2000, physical.width), height: Math.min(1200, physical.height) },
    fetchWindowIcons: false,
  });
  windowSources.forEach(function (source) {
    if (!/Floating|HireShade|Launcher/i.test(source.name)) return;
    const fileName = "desktopcapturer-" + label + "-window-" + safeName(source.name) + ".png";
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, source.thumbnail.toPNG());
    result.window_sources.push({
      id: source.id,
      name: source.name,
      path: filePath,
      thumbnail_size: source.thumbnail.getSize(),
    });
  });

  const outFile = path.join(outDir, "desktopcapturer-" + label + ".json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result));
  app.quit();
}

main().catch(function (error) {
  console.error("[capture-probe] " + (error && error.message ? error.message : error));
  app.quit();
  process.exitCode = 1;
});
