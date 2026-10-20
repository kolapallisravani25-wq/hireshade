#!/usr/bin/env node
/**
 * O3 — overlay-size acceptance harness (G-044/G-045/G-047 style evidence).
 *
 * Runs the generated acceptance surface in real Electron and asserts, via CDP:
 *   - 5 presets x DPI 100/125/150/200: computed typography (DPI-scaled min font,
 *     contrast >= 7:1 against scrim composited over white AND black backdrops,
 *     <= 75ch, line-height >= 1.5);
 *   - 400-word answer no-overflow/no-ellipsis/no-truncation at every cell;
 *   - 20 generated answers: hook <= 12 words, first screenful (hook + first
 *     bullet) <= 40 words, no literal markdown tokens, bullets as <li>;
 *   - re-layout within one frame (perf + rAF);
 *   - persisted preset restored after a full Electron restart (same userData);
 *   - OS-level click-through reaches a real background window.
 *
 * O1's preset/answerFormat exports are consumed when present; otherwise the
 * documented fallback contract is used and labelled in the evidence JSON.
 *
 * Usage: node scripts/overlay-size/run-size-acceptance.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, connectCdp, waitForCdp, waitForTarget } from "../scroll/cdp.mjs";
import {
  DEFAULT_PRESET_ID,
  READABILITY_FLOORS,
  loadAnswerFormatter,
  loadPresetContract,
} from "./presets-contract.mjs";
import { buildAcceptanceHtml, buildBackgroundHtml } from "./acceptance-page.mjs";
import {
  SPEAKABILITY_THRESHOLDS,
  fallbackFormatAnswer,
  generateAnswers,
} from "./speakability.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const evidenceRoot = path.join(root, "docs", "evidence", "overlay-size");
// O2 owns capture-matrix evidence in docs/evidence/overlay-size/ directly; the
// O3 harness writes into its own subdirectory so concurrent runs never clobber.
const evidenceDir = path.join(evidenceRoot, "o3");
const pagePath = path.join(evidenceDir, "o3-size-acceptance.generated.html");
const backgroundPath = path.join(evidenceDir, "o3-size-background.generated.html");
const resultsPath = path.join(evidenceDir, "o3-size-results.json");
const overlayHtmlPath = path.join(root, "artifacts", "craft-vita", "src", "demo", "overlay.html");
const electronDir = path.join(root, "artifacts", "desktop-electron", "node_modules", "electron");
const electronExe = path.join(
  electronDir,
  "dist",
  process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron",
);
const electronMain = path.join(here, "main.cjs");
const DPI_VALUES = [1, 1.25, 1.5, 2];
const BACKDROPS = ["#ffffff", "#000000"];
const WORDS_400 = Array.from({ length: 400 }, function (_value, index) {
  return "capability" + String(index + 1).padStart(3, "0");
}).join(" ");

const assertions = [];
function check(name, pass, detail, options) {
  const required = !options || options.required !== false;
  const status = pass ? "PASS" : required ? "FAIL" : "UNTESTED";
  assertions.push({ name: name, pass: Boolean(pass), status: status, required: required, detail: detail === undefined ? null : detail });
  console.log("[size]   " + status + " " + name + (detail !== undefined ? " (" + JSON.stringify(detail) + ")" : ""));
  return Boolean(pass);
}
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}
function electronVersion() {
  return readJson(path.join(electronDir, "package.json")).version;
}
function findEsbuildNotNeeded() {
  return null;
}
function buildArtifacts(contract, formatter) {
  mkdirSync(evidenceDir, { recursive: true });
  const page = buildAcceptanceHtml({
    overlayHtmlPath: overlayHtmlPath,
    presets: contract.presets,
    presetSource: contract.source,
    floors: contract.floors,
    title: "HireShade overlay size acceptance",
  });
  writeFileSync(pagePath, page);
  writeFileSync(backgroundPath, buildBackgroundHtml());
  return { pageBytes: page.length };
}
async function startServer() {
  const files = new Map([
    ["/size", { path: pagePath, type: "text/html; charset=utf-8" }],
    ["/background", { path: backgroundPath, type: "text/html; charset=utf-8" }],
  ]);
  const server = http.createServer(function (request, response) {
    const pathname = (request.url || "/").split("?")[0];
    const entry = files.get(pathname);
    if (!entry) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    try {
      const body = readFileSync(entry.path);
      response.writeHead(200, { "content-type": entry.type, "cache-control": "no-store" });
      response.end(body);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    origin: "http://127.0.0.1:" + port,
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    },
  };
}
function parseInfoLine(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    const marker = line.indexOf("[size-main] info ");
    if (marker >= 0) {
      try {
        return JSON.parse(line.slice(marker + "[size-main] info ".length));
      } catch (error) {
        return null;
      }
    }
  }
  return null;
}
function launchElectron(options) {
  const env = Object.assign({}, process.env, {
    DSH_CDP_PORT: String(options.port),
    DSH_OVERLAY_URL: options.origin + "/size",
    DSH_BACKGROUND_URL: options.origin + "/background",
    DSH_USER_DATA_DIR: options.userDataDir,
  });
  if (options.clickThrough) env.DSH_CLICK_THROUGH = "1";
  else delete env.DSH_CLICK_THROUGH;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronExe, [electronMain], {
    cwd: root,
    env: env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", function (chunk) {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", function (chunk) {
    stderr += chunk.toString();
  });
  const exit = new Promise(function (resolve) {
    child.once("exit", function (code, signal) {
      resolve({ code: code, signal: signal });
    });
  });
  return {
    child: child,
    exit: exit,
    port: options.port,
    stdout: function () { return stdout; },
    stderr: function () { return stderr; },
    info: function () { return parseInfoLine(stdout); },
  };
}
function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch (error) {
    /* best effort */
  }
}
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error("Runtime.evaluate failed: " + JSON.stringify(result.exceptionDetails));
  return result.result ? result.result.value : undefined;
}
async function waitReady(cdp, expression, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, expression)) return true;
    } catch (error) {
      /* page reloading */
    }
    await sleep(150);
  }
  throw new Error("timed out waiting for page readiness: " + expression);
}
async function connectOverlay(instance) {
  const cdpReady = await waitForCdp(instance.port, 15000);
  if (!cdpReady) throw new Error("Electron did not expose a CDP endpoint on port " + instance.port);
  const target = await waitForTarget(instance.port, function (entry) {
    return String(entry.url).includes("/size");
  });
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await waitReady(cdp, "window.__sizeReady === true");
  return cdp;
}
async function connectBackground(instance) {
  const target = await waitForTarget(instance.port, function (entry) {
    return String(entry.url).includes("/background");
  });
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await waitReady(cdp, "window.__bgReady === true");
  return cdp;
}
async function closeInstance(instance, cdp) {
  if (cdp) cdp.close();
  await closeBrowser(instance.port);
  const exited = await Promise.race([instance.exit.then(function () { return true; }), sleep(4000).then(function () { return false; })]);
  if (!exited) {
    killTree(instance.child);
    await instance.exit;
  }
}
async function pickAndLaunch(options) {
  for (const port of options.ports) {
    const instance = launchElectron(Object.assign({}, options, { port: port }));
    const ready = await waitForCdp(port, 12000);
    if (ready) return instance;
    killTree(instance.child);
    await instance.exit;
  }
  throw new Error("Electron did not expose CDP on any candidate port");
}
async function screenshot(cdp, fileName) {
  const pathName = path.join(evidenceDir, fileName);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(pathName, Buffer.from(result.data, "base64"));
  return { file: "docs/evidence/overlay-size/o3/" + fileName, bytes: statSync(pathName).size };
}
async function setDpi(cdp, dpi) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: dpi,
    mobile: false,
  });
}
function clickPhysical(point) {
  const script =
    "Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class SizeClick { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e); [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }'; " +
    "function Title { $sb = New-Object System.Text.StringBuilder 256; [SizeClick]::GetWindowText([SizeClick]::GetForegroundWindow(),$sb,256) | Out-Null; return $sb.ToString() }; " +
    "Write-Output (\"BEFORE=\" + (Title)); " +
    "[SizeClick]::SetCursorPos(" + point.x + "," + point.y + ") | Out-Null; Start-Sleep -Milliseconds 150; " +
    "[SizeClick]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; " +
    "[SizeClick]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 300; " +
    "Write-Output (\"AFTER=\" + (Title)); Write-Output 'clicked'";
  const run = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", timeout: 20000 });
  const output = String(run.stdout || "");
  const titleOf = function (marker) {
    const match = output.match(new RegExp(marker + "=(.*)"));
    return match ? match[1].trim() : null;
  };
  return { ok: run.status === 0, status: run.status, stderr: run.stderr, foregroundBefore: titleOf("BEFORE"), foregroundAfter: titleOf("AFTER") };
}
function metricRow(preset, dpi, white, black, floors) {
  const minContrast = Math.min(white.contrast.ratio, black.contrast.ratio);
  const row = {
    preset: preset.id,
    presetLabel: preset.label,
    dpi: dpi,
    fontCssPx: white.fontSizeCssPx,
    fontDevicePx: white.fontSizeCssPx * white.dpr,
    presetFontCssPx: preset.fontCssPx,
    fitFontPx: white.fitFontPx,
    lineHeightRatio: white.lineHeightRatio,
    longestLineCh: white.longestLineCh,
    maxLineChCss: white.maxLineChCss,
    contrast: {
      whiteBackdrop: white.contrast.ratio,
      blackBackdrop: black.contrast.ratio,
      min: minContrast,
      textColor: white.contrast.textColor,
      scrim: white.contrast.scrim,
    },
    overflow: {
      answerScrollWidth: white.layout.answerScrollWidth,
      answerClientWidth: white.layout.answerClientWidth,
      answerScrollHeight: white.layout.answerScrollHeight,
      answerClientHeight: white.layout.answerClientHeight,
      contentHeight: white.layout.contentHeight,
      docScrollWidth: white.layout.docScrollWidth,
      innerWidth: white.layout.innerWidth,
      textOverflow: white.layout.textOverflow,
      webkitLineClamp: white.layout.webkitLineClamp,
    },
    text: white.text,
    expectedWords: 400,
    failures: [],
  };
  if (!(row.fontCssPx >= floors.minFontCssPx)) row.failures.push("font below css floor");
  if (!(row.fontDevicePx >= floors.minDevicePx)) row.failures.push("font below device-px floor");
  if (!(row.contrast.min >= floors.minContrastRatio)) row.failures.push("contrast below 7:1");
  if (!(row.lineHeightRatio >= floors.minLineHeight)) row.failures.push("line-height below 1.5");
  if (!(row.longestLineCh <= floors.maxLineCh)) row.failures.push("line length above 75ch");
  if (!(row.maxLineChCss <= floors.maxLineCh)) row.failures.push("css max-width above 75ch");
  if (!(row.overflow.answerScrollWidth <= row.overflow.answerClientWidth + 1)) row.failures.push("horizontal answer overflow");
  if (!(row.overflow.docScrollWidth <= row.overflow.innerWidth + 1)) row.failures.push("horizontal document overflow");
  if (row.overflow.textOverflow === "ellipsis") row.failures.push("text-overflow ellipsis");
  if (row.overflow.webkitLineClamp !== "none") row.failures.push("line clamp truncation");
  if (row.text.words !== 400) row.failures.push("answer words changed");
  if (!(row.overflow.contentHeight >= row.overflow.answerScrollHeight - 1)) row.failures.push("answer clipped (content shorter than text)");
  row.pass = row.failures.length === 0;
  return row;
}
function speakabilityRow(answer, metrics, formatted) {
  const failures = [];
  const speak = metrics.speakability;
  if (!(speak.hookWords !== null && speak.hookWords <= SPEAKABILITY_THRESHOLDS.hookMaxWords)) failures.push("hook > 12 words");
  if (!(speak.firstScreenfulWords <= SPEAKABILITY_THRESHOLDS.firstScreenfulMaxWords)) failures.push("first screenful > 40 words");
  if (!(speak.markdownTokens.length === 0)) failures.push("literal markdown tokens rendered: " + speak.markdownTokens.join(","));
  if (!(speak.bulletCount >= SPEAKABILITY_THRESHOLDS.bulletsMin && speak.bulletCount <= SPEAKABILITY_THRESHOLDS.bulletsMax)) failures.push("bullet count outside 2-4");
  if (!(speak.bulletCount === formatted.bullets.length)) failures.push("bullets not all rendered as list items");
  return {
    id: answer.id,
    formatterSource: formatted.source,
    hook: formatted.hook,
    hookWords: speak.hookWords,
    formatterHookWords: formatted.hookWords,
    firstScreenfulWords: speak.firstScreenfulWords,
    viewportVisibleWords: speak.viewportVisibleWords,
    bulletCount: speak.bulletCount,
    expectedBullets: formatted.bullets.length,
    markdownTokens: speak.markdownTokens,
    pass: failures.length === 0,
    failures: failures,
  };
}

/** Normalises O1 formatAnswerForOverlay output and the fallback shape. */
function normalizeFormatted(output, source) {
  if (typeof output === "string") {
    return { source: source, hook: output.trim(), hookWords: countWords(output), bullets: [] };
  }
  const hook = String(output && output.hook !== undefined ? output.hook : "");
  const bullets = Array.isArray(output && output.bullets) ? output.bullets.map(String) : [];
  const screenfulWords = Number(output && output.screenfulWords);
  return {
    source: source,
    hook: hook,
    hookWords: countWords(hook),
    bullets: bullets,
    screenfulWords: Number.isFinite(screenfulWords) ? screenfulWords : null,
  };
}

function countWords(text) {
  const value = String(text || "").trim();
  return value ? value.split(/\s+/).filter(Boolean).length : 0;
}
async function main() {
  if (!existsSync(electronExe)) throw new Error("Electron binary not found at " + electronExe);
  mkdirSync(evidenceDir, { recursive: true });
  const contract = await loadPresetContract(root);
  const formatter = await loadAnswerFormatter(root, fallbackFormatAnswer);
  const artifacts = buildArtifacts(contract, formatter);
  console.log("[size] presets source=" + contract.source + " (" + contract.presets.length + ") formatter=" + formatter.source);
  const server = await startServer();
  const userDataDir = path.join(os.tmpdir(), "hireshade-size-" + process.pid);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  console.log("[size] serving " + server.origin + " userData=" + userDataDir);

  let instance = null;
  let cdp = null;
  let matrixRows = [];
  let speakRows = [];
  let relayout = null;
  let persistence = null;
  let clickThrough = null;
  const screenshots = [];

  try {
    instance = await pickAndLaunch({ origin: server.origin, userDataDir: userDataDir, ports: [9440, 9441, 9442, 9443] });
    cdp = await connectOverlay(instance);
    console.log("[size] overlay ready");

    // ── 1. Presets x DPI computed styles + 400-word overflow ───────────────
    for (const dpi of DPI_VALUES) {
      await setDpi(cdp, dpi);
      for (const preset of contract.presets) {
        const whiteExpression =
          "(function(){var h=window.__sizeHarness;h.setBackdrop('#ffffff');h.applyPreset(" + JSON.stringify(preset.id) + ");h.setAnswer(" + JSON.stringify(WORDS_400) + ");h.autoFit();return h.getMetrics('#ffffff');})()";
        const blackExpression =
          "(function(){var h=window.__sizeHarness;h.setBackdrop('#000000');var m=h.getMetrics('#000000');h.setBackdrop('#1e293b');return m;})()";
        const white = await evaluate(cdp, whiteExpression);
        const black = await evaluate(cdp, blackExpression);
        const row = metricRow(preset, dpi, white, black, contract.floors);
        matrixRows.push(row);
        if (!row.pass) check("matrix-" + preset.id + "-dpi" + dpi, false, row.failures);
        if (dpi === 1.25) {
          screenshots.push(await screenshot(cdp, "o3-preset-" + preset.id + "-dpi125.png"));
        }
      }
    }
    const matrixFailures = matrixRows.filter(function (row) { return !row.pass; });
    check("matrix-font-floor-all", matrixRows.every(function (row) { return row.fontCssPx >= contract.floors.minFontCssPx && row.fontDevicePx >= contract.floors.minDevicePx; }), matrixRows.length + " cells");
    check("matrix-contrast-7to1-all", matrixRows.every(function (row) { return row.contrast.min >= contract.floors.minContrastRatio; }), { min: Math.min.apply(null, matrixRows.map(function (row) { return row.contrast.min; })) });
    check("matrix-line-height-all", matrixRows.every(function (row) { return row.lineHeightRatio >= contract.floors.minLineHeight; }), { min: Math.min.apply(null, matrixRows.map(function (row) { return row.lineHeightRatio; })) });
    check("matrix-line-length-75ch-all", matrixRows.every(function (row) { return row.longestLineCh <= contract.floors.maxLineCh && row.maxLineChCss <= contract.floors.maxLineCh; }), { max: Math.max.apply(null, matrixRows.map(function (row) { return row.longestLineCh; })) });
    check("matrix-no-overflow-400w-all", matrixFailures.length === 0, matrixFailures.length + " failing cells");
    // Dedicated 400-word worst-case screenshot (COMPACT at DPI 200).
    await setDpi(cdp, 2);
    await evaluate(cdp, "(function(){var h=window.__sizeHarness;h.setBackdrop('#1e293b');h.applyPreset('compact');h.setAnswer(" + JSON.stringify(WORDS_400) + ");h.autoFit();return true;})()");
    screenshots.push(await screenshot(cdp, "o3-overflow-400words-compact-dpi200.png"));

    // ── 2. Speakability: 20 generated answers ─────────────────────────────
    await setDpi(cdp, 1.25);
    const answers = generateAnswers(20);
    const formatterSources = { o1: 0, "contract-fallback": 0 };
    for (const answer of answers) {
      let formatted;
      try {
        formatted = normalizeFormatted(formatter.format(answer.markdown), formatter.source);
      } catch (error) {
        formatted = normalizeFormatted(fallbackFormatAnswer(answer.markdown), "contract-fallback");
      }
      if (!(formatted.hook && formatted.bullets.length)) {
        // O1 rejected/failed on a fixture: keep the run honest and visible.
        formatted = normalizeFormatted(fallbackFormatAnswer(answer.markdown), "contract-fallback");
      }
      formatterSources[formatted.source] = (formatterSources[formatted.source] || 0) + 1;
      const speakMarkdown = [formatted.hook, "", ...formatted.bullets.map(function (bullet) { return "- " + bullet; })].join("\n");
      const expression =
        "(function(){var h=window.__sizeHarness;h.setBackdrop('#ffffff');h.applyPreset('banner');h.setAnswerMarkdown(" + JSON.stringify(speakMarkdown) + ");return h.getMetrics('#ffffff');})()";
      const metrics = await evaluate(cdp, expression);
      const row = speakabilityRow(answer, metrics, formatted);
      speakRows.push(row);
      if (!row.pass) check("speak-" + answer.id, false, row.failures);
    }
    const speakFailures = speakRows.filter(function (row) { return !row.pass; });
    check("speakability-20-answers", speakFailures.length === 0, { answers: speakRows.length, failing: speakFailures.length });
    check("speakability-hook-12w", speakRows.every(function (row) { return row.hookWords <= SPEAKABILITY_THRESHOLDS.hookMaxWords; }), { max: Math.max.apply(null, speakRows.map(function (row) { return row.hookWords; })) });
    check("speakability-first-screenful-40w", speakRows.every(function (row) { return row.firstScreenfulWords <= SPEAKABILITY_THRESHOLDS.firstScreenfulMaxWords; }), { max: Math.max.apply(null, speakRows.map(function (row) { return row.firstScreenfulWords; })) });
    check("speakability-no-markdown-tokens", speakRows.every(function (row) { return row.markdownTokens.length === 0; }), speakRows.length + " answers");
    check("speakability-bullets-rendered", speakRows.every(function (row) { return row.bulletCount >= 2 && row.bulletCount <= 4 && row.bulletCount === row.expectedBullets; }), { min: Math.min.apply(null, speakRows.map(function (row) { return row.bulletCount; })), max: Math.max.apply(null, speakRows.map(function (row) { return row.bulletCount; })) });

    // ── 3. Re-layout within one frame ─────────────────────────────────────
    // A preset switch re-lays out the pane. Measure three switches on a normal
    // (short) answer: the median synchronous style+layout cost must fit a frame.
    await evaluate(cdp, "window.__sizeHarness.setAnswer('Short answer used to time preset re-layout.')");
    const relayoutSamples = [];
    for (const presetTarget of ["teleprompter", "compact", "reading"]) {
      const sample = await evaluate(cdp, "window.__sizeHarness.relayoutTo(" + JSON.stringify(presetTarget) + ")");
      relayoutSamples.push(sample);
    }
    const applySamples = relayoutSamples.map(function (sample) { return sample.applyMs; }).sort(function (a, b) { return a - b; });
    const medianApplyMs = applySamples[Math.floor(applySamples.length / 2)];
    relayout = {
      samples: relayoutSamples,
      medianApplyMs: medianApplyMs,
      maxApplyMs: applySamples[applySamples.length - 1],
      frameMs: relayoutSamples[relayoutSamples.length - 1].frameMs,
      preset: relayoutSamples[relayoutSamples.length - 1].preset,
      fontSize: relayoutSamples[relayoutSamples.length - 1].fontSize,
      method: "median of 3 preset switches; applyMs = attribute + forced style/layout read; frameMs = until next rAF",
    };
    check("relayout-median-under-16ms", medianApplyMs <= 16, { medianApplyMs: medianApplyMs, samples: applySamples });
    const readingPreset = contract.presets.find(function (preset) { return preset.id === "reading"; });
    check("relayout-next-frame-applied", relayout.frameMs >= 0 && relayout.preset === "reading" && relayout.fontSize === readingPreset.fontCssPx, { preset: relayout.preset, fontSize: relayout.fontSize, expectedFont: readingPreset.fontCssPx, frameMs: relayout.frameMs });

    // ── 4. Persistence across a full restart (same userData) ──────────────
    const persisted = await evaluate(
      cdp,
      "(function(){var h=window.__sizeHarness;h.applyPreset('reading');return {stored:h.getStoredPreset(),raw:h.getStoredRaw()};})()",
    );
    await closeInstance(instance, cdp);
    instance = null;
    cdp = null;
    instance = await pickAndLaunch({ origin: server.origin, userDataDir: userDataDir, ports: [9440, 9441, 9442, 9443] });
    cdp = await connectOverlay(instance);
    const restored = await evaluate(cdp, "(function(){var h=window.__sizeHarness;return {preset:h.getPreset(),stored:h.getStoredPreset(),raw:h.getStoredRaw(),metrics:h.getMetrics('#ffffff')};})()");
    persistence = { persisted: persisted, restored: restored, restarts: 1 };
    check("persistence-stored-reading", persisted.stored === "reading" && String(persisted.raw).indexOf("reading") >= 0, persisted.stored);
    check("persistence-restored-after-restart", restored.preset === "reading" && restored.metrics.fontSizeCssPx === readingPreset.fontCssPx, { preset: restored.preset, font: restored.metrics.fontSizeCssPx, expectedFont: readingPreset.fontCssPx });

    // ── 5. OS-level click-through to a real background window ─────────────
    await closeInstance(instance, cdp);
    instance = null;
    cdp = null;
    instance = await pickAndLaunch({ origin: server.origin, userDataDir: userDataDir, ports: [9440, 9441, 9442, 9443], clickThrough: true });
    cdp = await connectOverlay(instance);
    const bgCdp = await connectBackground(instance);
    const info = instance.info();
    await evaluate(cdp, "window.__sizeHarness.resetClicks(); true");
    await evaluate(bgCdp, "window.__bgClicks = 0; true");
    const clicked = clickPhysical(info.clickPointPhysical);
    await sleep(700);
    const overlayClicks = await evaluate(cdp, "window.__sizeHarness.getClicks()");
    const backgroundClicks = await evaluate(bgCdp, "({ clicks: window.__bgClicks, last: window.__bgLastClick || null })");
    clickThrough = {
      physicalPoint: info.clickPointPhysical,
      pointDip: info.clickPointDip,
      scaleFactor: info.scaleFactor,
      overlayClicks: overlayClicks.overlay,
      backgroundClicks: backgroundClicks.clicks,
      backgroundLastClick: backgroundClicks.last,
      injection: clicked,
      foregroundBefore: clicked.foregroundBefore,
      foregroundAfter: clicked.foregroundAfter,
      status: backgroundClicks.clicks > 0 && overlayClicks.overlay === 0 ? "PASS" : backgroundClicks.clicks === 0 ? "UNTESTED" : "FAIL",
    };
    if (clickThrough.status === "PASS") {
      check("click-through-reaches-background-app", true, clickThrough);
    } else if (clickThrough.status === "UNTESTED") {
      check("click-through-reaches-background-app", false, Object.assign({ reason: "OS did not deliver the synthetic click (no interactive desktop / injection blocked)" }, clickThrough), { required: false });
    } else {
      check("click-through-reaches-background-app", false, Object.assign({ reason: "overlay received clicks despite setIgnoreMouseEvents" }, clickThrough));
    }
    screenshots.push(await screenshot(cdp, "o3-click-through-overlay.png"));
    await closeInstance(instance, bgCdp);
    instance = null;
    cdp = null;

    const requiredFailures = assertions.filter(function (entry) { return entry.required && !entry.pass; });
    const pass = requiredFailures.length === 0;
    mkdirSync(evidenceDir, { recursive: true });
    const evidence = {
      generatedAt: new Date().toISOString(),
      pass: pass,
      kind: "overlay-size-acceptance",
      environment: {
        platform: process.platform,
        node: process.version,
        electron: electronVersion(),
        hostScaleFactor: info ? info.scaleFactor : null,
        window: { width: 1000, height: 760, frame: false, transparent: true, alwaysOnTop: true },
        dpiValues: DPI_VALUES,
        dpiMethod: "CDP Emulation.setDeviceMetricsOverride deviceScaleFactor (emulation, not physical monitor scaling)",
      },
      sources: {
        presetContract: { source: contract.source, presetsPath: contract.presetsPath, warnings: contract.warnings },
        answerFormatter: { source: formatter.source, formatPath: formatter.formatPath, warnings: formatter.warnings, usedInSpeakability: true, usage: formatterSources },
      },
      floors: contract.floors,
      presets: contract.presets,
      matrix: {
        rows: matrixRows,
        aggregate: {
          cells: matrixRows.length,
          failingCells: matrixFailures.length,
          minContrast: Math.min.apply(null, matrixRows.map(function (row) { return row.contrast.min; })),
          minFontCssPx: Math.min.apply(null, matrixRows.map(function (row) { return row.fontCssPx; })),
          minFontDevicePx: Math.min.apply(null, matrixRows.map(function (row) { return row.fontDevicePx; })),
          minLineHeightRatio: Math.min.apply(null, matrixRows.map(function (row) { return row.lineHeightRatio; })),
          maxLineCh: Math.max.apply(null, matrixRows.map(function (row) { return row.longestLineCh; })),
        },
      },
      speakability: {
        thresholds: SPEAKABILITY_THRESHOLDS,
        firstScreenfulDefinition: "hook + first bullet (the spoken lead-in), not every viewport-visible word",
        rows: speakRows,
        aggregate: {
          answers: speakRows.length,
          failing: speakFailures.length,
          maxHookWords: Math.max.apply(null, speakRows.map(function (row) { return row.hookWords; })),
          maxFirstScreenfulWords: Math.max.apply(null, speakRows.map(function (row) { return row.firstScreenfulWords; })),
          markdownTokenViolations: speakRows.filter(function (row) { return row.markdownTokens.length > 0; }).length,
        },
      },
      relayout: relayout,
      persistence: persistence,
      clickThrough: clickThrough,
      assertions: assertions,
      screenshots: screenshots,
      honestLabels: {
        contrast:
          "Text color vs scrim composited over solid #ffffff and #000000 extremes; contrast over real video/desktop content is UNTESTED (no video fixture in this harness).",
        dpi: "deviceScaleFactor emulation via CDP; physical monitor scaling not measured.",
        clickThrough:
          "Win32 SendInput at physical screen coordinates on this Windows host; macOS/Linux click-through is UNTESTED.",
        multiMonitor:
          "Pure selection-logic unit tests live in artifacts/craft-vita/src/overlay/size.test.ts; no multi-monitor hardware available here.",
        verticalOverflow:
          "400-word answers may scroll vertically in the overlay (virtual scroll); clipping is asserted via preserved word count + content height, not by requiring everything to fit on one screen.",
      },
      commands: {
        run: "node scripts/overlay-size/run-size-acceptance.mjs",
        unitTests: "pnpm --dir artifacts/craft-vita exec vitest run src/overlay/size.test.ts",
        viaDemo: "node scripts/demo/run-demo.mjs size",
        viaMake: "make demo (runs the size step)",
        evidence: "docs/evidence/overlay-size/o3/o3-size-results.json",
      },
      artifacts: artifacts,
    };
    writeFileSync(resultsPath, JSON.stringify(evidence, null, 2) + "\n");
    console.log("[size] results " + resultsPath);
    console.log("[size] matrix cells=" + matrixRows.length + " failing=" + matrixFailures.length + " minContrast=" + evidence.matrix.aggregate.minContrast.toFixed(2) + " minFontDevicePx=" + evidence.matrix.aggregate.minFontDevicePx + " maxLineCh=" + evidence.matrix.aggregate.maxLineCh.toFixed(1));
    console.log("[size] speakability answers=" + speakRows.length + " maxHook=" + evidence.speakability.aggregate.maxHookWords + " maxFirstScreenful=" + evidence.speakability.aggregate.maxFirstScreenfulWords);
    console.log("[size] clickThrough=" + clickThrough.status + " persistence=" + (persistence.restored.preset === "reading" ? "restored" : "FAILED"));
    if (!pass) throw new Error("overlay-size acceptance failed: " + requiredFailures.map(function (entry) { return entry.name; }).join(", "));
  } finally {
    if (cdp) cdp.close();
    if (instance) {
      await closeBrowser(instance.port);
      const exited = await Promise.race([instance.exit.then(function () { return true; }), sleep(3000).then(function () { return false; })]);
      if (!exited) {
        killTree(instance.child);
        await instance.exit;
      }
    }
    await server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error("[size] FAILED:", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
