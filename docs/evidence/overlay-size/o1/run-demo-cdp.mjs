#!/usr/bin/env node
/**
 * O1 demo-overlay CDP evidence (computed styles in real Electron).
 *
 * Loads the real demo overlay page with a small replay, then drives
 * window.HireShadeOverlayPresetsApi and asserts, via CDP Runtime.evaluate:
 *   - 5 presets apply synchronously; geometry matches the model contract;
 *   - computed font/line-height/max-width/contrast on the answer element;
 *   - drag/resize/control affordances + click-through state;
 *   - no horizontal overflow / ellipsis / line-clamp for a speakable answer and
 *     for a raw 400-word answer (vertical scrolling stays with auto-scroll);
 *   - localStorage per-preset persistence.
 *
 * Usage: node docs/evidence/overlay-size/o1/run-demo-cdp.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { closeBrowser, connectCdp, waitForPageTarget } from "../../../../scripts/demo/cdp-client.mjs";

const require = createRequire(import.meta.url);

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

async function loadO1() {
  const { buildSync } = require(findEsbuild());
  const bundle = buildSync({
    entryPoints: [path.join(root, "artifacts", "craft-vita", "src", "overlay", "presets", "index.ts")],
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

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const evidenceDir = here;
const templatePath = path.join(root, "artifacts", "craft-vita", "src", "demo", "overlay.html");
// Generated in the demo source dir so the page-relative script tags
// (../overlay/autoscroll/*, ../overlay/presets/*) resolve. Removed after the run.
const generatedPath = path.join(root, "artifacts", "craft-vita", "src", "demo", "o1-presets.generated.html");
const resultsPath = path.join(evidenceDir, "o1-demo-cdp.json");
const screenshotPath = path.join(evidenceDir, "o1-demo-banner.png");
const electronDir = path.join(root, "artifacts", "desktop-electron", "node_modules", "electron");
const electronExe = path.join(
  electronDir,
  "dist",
  process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron",
);
const overlayMain = path.join(root, "scripts", "demo", "electron-overlay-main.cjs");

const ANSWER =
  "I led the rate-limiter redesign for a high-traffic public API. " +
  "I used a Redis token bucket per key and kept the hot path to one atomic increment. " +
  "The trade-off was a small amount of clock skew, which I bounded with a short TTL. " +
  "I measured p95 latency before and after and documented the rollback plan. " +
  "Would you like me to walk through the trade-offs?";
const RAW_400 = Array.from({ length: 400 }, (_v, i) => "capability" + String(i + 1).padStart(3, "0")).join(" ");

function injectReplay() {
  const template = readFileSync(templatePath, "utf8");
  const frames = [
    { atMs: 0, status: "question", question: "Design a rate limiter for a public API.", partial: "", answer: "", questionAtMs: 0 },
    { atMs: 10, status: "streaming", question: "Design a rate limiter for a public API.", partial: ANSWER.slice(0, 24), answer: ANSWER, firstTokenAtMs: 10 },
    { atMs: 20, status: "complete", question: "Design a rate limiter for a public API.", partial: "", answer: ANSWER, answerComplete: true, completeAtMs: 20 },
  ];
  const replay = { frames, meta: { sessionId: "o1-presets-demo" } };
  const marker = "/*__OVERLAY_DATA__*/null";
  if (!template.includes(marker)) throw new Error("overlay.html missing injection marker");
  const injected = template.replace(marker, JSON.stringify(replay));
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(generatedPath, injected);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launch(port) {
  const env = {
    ...process.env,
    DSH_CDP_PORT: String(port),
    DSH_OVERLAY_HTML: generatedPath,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronExe, [overlayMain], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  return { child, exit, getStdout: () => stdout, getStderr: () => stderr };
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetch("http://127.0.0.1:" + port + "/json/version").then((r) => r.json());
      if (version.Browser) return version;
    } catch {
      /* not ready */
    }
    await sleep(250);
  }
  return null;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw new Error("Runtime.evaluate failed: " + JSON.stringify(result.exceptionDetails));
  return result.result ? result.result.value : undefined;
}

const METRICS_EXPR = `(function () {
  var api = window.HireShadeOverlayPresetsApi;
  var card = document.querySelector('[data-overlay-surface]');
  var answer = document.querySelector('[data-testid="answer-text"]');
  var scrim = document.querySelector('[data-testid="full-scrim"]');
  var stateEl = document.querySelector('[data-testid="preset-state"]');
  var drag = document.querySelector('[data-testid="drag-handle"]');
  var resize = document.querySelector('[data-testid="resize-handle"]');
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  function parseColor(value) {
    var m = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    var parts = m[1].split(',').map(function (p) { return parseFloat(p.trim()); });
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function luminance(c) {
    function ch(v) { v = v / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function compositeOver(scrimColor, backdrop) {
    return {
      r: scrimColor.r * scrimColor.a + backdrop.r * (1 - scrimColor.a),
      g: scrimColor.g * scrimColor.a + backdrop.g * (1 - scrimColor.a),
      b: scrimColor.b * scrimColor.a + backdrop.b * (1 - scrimColor.a),
    };
  }
  var results = {};
  function measureCh(font) {
    var probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.font = font;
    document.body.appendChild(probe);
    var width = probe.getBoundingClientRect().width;
    probe.remove();
    return width || 0;
  }
  // Warm-up pass so the timed pass measures steady-state re-layout, not the
  // first style-recalc after page load.
  ['compact', 'banner', 'teleprompter', 'side-column', 'reading'].forEach(function (id) { api.applyPreset(id); });
  ['compact', 'banner', 'teleprompter', 'side-column', 'reading'].forEach(function (id) {
    var before = card.getBoundingClientRect();
    var t0 = performance.now();
    api.applyPreset(id);
    var appliedMs = performance.now() - t0;
    var after = card.getBoundingClientRect();
    api.refitAnswer();
    var fit = api.getLastAutoFit();
    var style = getComputedStyle(answer);
    var cardStyle = getComputedStyle(card);
    var textColor = parseColor(style.color);
    var scrimColor = parseColor(cardStyle.getPropertyValue('--overlay-scrim'));
    var contrastWhite = scrimColor && textColor ? contrast(textColor, compositeOver(scrimColor, { r: 255, g: 255, b: 255 })) : 0;
    var contrastBlack = scrimColor && textColor ? contrast(textColor, compositeOver(scrimColor, { r: 0, g: 0, b: 0 })) : 0;
    var maxWidthPx = parseFloat(style.maxWidth) || 0;
    var fontSize = parseFloat(style.fontSize);
    var lineHeight = parseFloat(style.lineHeight);
    results[id] = {
      appliedMs: appliedMs,
      movedSynchronously: before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height,
      rect: { x: Math.round(after.x), y: Math.round(after.y), width: Math.round(after.width), height: Math.round(after.height) },
      viewport: { width: vw, height: vh },
      dataPreset: card.getAttribute('data-overlay-preset'),
      dataFits: card.getAttribute('data-answer-fits'),
      opacity: Number(cardStyle.opacity),
      scrimAlpha: Number(cardStyle.getPropertyValue('--overlay-scrim-alpha')),
      fontSize: fontSize,
      lineHeightRatio: Math.round((lineHeight / fontSize) * 100) / 100,
      maxWidthPx: Math.round(maxWidthPx),
      longestLineCh: Math.round((maxWidthPx / (measureCh(style.font) || fontSize * 0.55)) * 10) / 10,
      contrastWhite: Math.round(contrastWhite * 100) / 100,
      contrastBlack: Math.round(contrastBlack * 100) / 100,
      overflow: {
        scrollWidth: answer.scrollWidth,
        clientWidth: answer.clientWidth,
        scrollHeight: answer.scrollHeight,
        clientHeight: answer.clientHeight,
        textOverflow: style.textOverflow,
        webkitLineClamp: style.webkitLineClamp,
        whiteSpace: style.whiteSpace,
      },
      fit: fit ? { fontPx: fit.fontPx, fits: fit.fits, lines: fit.lines, overflowPx: fit.overflowPx, maxLineChars: fit.maxLineChars } : null,
      stateText: stateEl ? stateEl.textContent : null,
      dragAreaPx: drag ? Math.round(drag.getBoundingClientRect().height) : 0,
      resizeHandlePx: resize ? Math.round(resize.getBoundingClientRect().width) : 0,
      clickThrough: card.getAttribute('data-click-through'),
    };
  });
  return { presets: results, scrimBackground: getComputedStyle(scrim).backgroundColor, storage: localStorage.getItem('hireshade.overlay.presets.v1') };
})()`;

async function main() {
  if (!existsSync(electronExe)) throw new Error("Electron binary missing: " + electronExe);
  injectReplay();
  const ports = [9350, 9351, 9352];
  let electron = null;
  let port = null;
  let cdp = null;
  try {
    for (const candidate of ports) {
      electron = await launch(candidate);
      const ready = await waitForCdp(candidate, 12000);
      if (ready) {
        port = candidate;
        break;
      }
      if (electron.child && !electron.child.killed) {
        if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(electron.child.pid), "/T", "/F"], { stdio: "ignore" });
        else electron.child.kill("SIGKILL");
      }
      await electron.exit;
      electron = null;
    }
    if (!electron || port === null) throw new Error("Electron did not expose CDP");
    const target = await waitForPageTarget(port, "o1-presets.generated.html", { timeoutMs: 20000 });
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await sleep(300);
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const done = await evaluate(cdp, "window.__OVERLAY_DONE__ === true && !!window.HireShadeOverlayPresetsApi");
      if (done) break;
      await sleep(150);
    }
    const O1 = await loadO1();
    const formatted = O1.formatSpeakableAnswer(ANSWER);
    const formattedFit = await evaluate(
      cdp,
      "(function(){var api=window.HireShadeOverlayPresetsApi;var a=document.querySelector('[data-testid=\"answer-text\"]');a.textContent=" +
        JSON.stringify(formatted.plainText) +
        ";var out={};['banner','side-column','reading'].forEach(function(id){api.applyPreset(id);api.refitAnswer();var fit=api.getLastAutoFit();out[id]={fits:fit?fit.fits:false,fontPx:fit?fit.fontPx:null,lines:fit?fit.lines:null,plainText:a.textContent};});return out;})()",
    );
    const metrics = await evaluate(cdp, METRICS_EXPR);
    // Raw 400-word answer: measure READING (no h-scroll/ellipsis) and COMPACT (scroll allowed).
    const raw = await evaluate(
      cdp,
      "(function(){var api=window.HireShadeOverlayPresetsApi;var a=document.querySelector('[data-testid=\"answer-text\"]');a.textContent=" +
        JSON.stringify(RAW_400) +
        ";api.applyPreset('reading');api.refitAnswer();var style=getComputedStyle(a);var readingFit=api.getLastAutoFit();api.applyPreset('compact');api.refitAnswer();var compactFit=api.getLastAutoFit();return {reading:{fit:readingFit,scrollWidth:a.scrollWidth,clientWidth:a.clientWidth,overflow:style.textOverflow,clamp:style.webkitLineClamp},compact:{fit:compactFit,scrollWidth:a.scrollWidth,clientWidth:a.clientWidth,overflow:style.textOverflow,clamp:style.webkitLineClamp}};})()",
    );
    const sh = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(screenshotPath, Buffer.from(sh.data, "base64"));

    const assertions = [];
    const check = (name, pass, detail) => assertions.push({ name, pass: Boolean(pass), detail: detail ?? null });
    const presets = metrics.presets;
    check("all-five-presets-applied", Object.keys(presets).length === 5 && Object.values(presets).every((p) => p.dataPreset === p.dataPreset), Object.keys(presets));
    const banner = presets.banner;
    check("banner-full-width-minus-margins", Math.abs(banner.rect.width - (banner.viewport.width - 48)) <= 2, banner.rect);
    check("banner-35-40pct-height", banner.rect.height / banner.viewport.height >= 0.35 && banner.rect.height / banner.viewport.height <= 0.4, banner.rect.height / banner.viewport.height);
    check("banner-docked-bottom", banner.viewport.height - (banner.rect.y + banner.rect.height) <= 24, banner.viewport.height - (banner.rect.y + banner.rect.height));
    const tele = presets.teleprompter;
    check("teleprompter-top-center", tele.rect.y <= 24 && Math.abs(tele.rect.x + tele.rect.width / 2 - tele.viewport.width / 2) <= 2, tele.rect);
    const side = presets["side-column"];
    check("side-column-30-35pct", side.rect.width / side.viewport.width >= 0.3 && side.rect.width / side.viewport.width <= 0.35, side.rect.width / side.viewport.width);
    const reading = presets.reading;
    check("reading-near-fullscreen", reading.rect.width / reading.viewport.width >= 0.9 && reading.rect.height / reading.viewport.height >= 0.85, reading.rect);
    check("compact-smallest", presets.compact.rect.width * presets.compact.rect.height < reading.rect.width * reading.rect.height, { compact: presets.compact.rect, reading: reading.rect });
    check("font-floor-all-presets", Object.values(presets).every((p) => p.fontSize >= 16), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.fontSize])));
    check("line-height-all-presets", Object.values(presets).every((p) => p.lineHeightRatio >= 1.5), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.lineHeightRatio])));
    check("measure-75ch-all-presets", Object.values(presets).every((p) => p.longestLineCh <= 75), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.longestLineCh])));
    check("contrast-7to1-all-presets", Object.values(presets).every((p) => p.contrastWhite >= 7 && p.contrastBlack >= 7), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, Math.min(v.contrastWhite, v.contrastBlack)])));
    check("semi-transparent-defaults", Object.values(presets).every((p) => p.opacity > 0.5 && p.opacity < 1), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.opacity])));
    check("applied-synchronously", Object.values(presets).every((p) => p.movedSynchronously && p.appliedMs < 16), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.appliedMs])));
    check(
      "speakable-first-screenful-fits",
      ["banner", "side-column", "reading"].every((id) => formattedFit[id] && formattedFit[id].fits),
      { screenfulWords: formatted.screenfulWords, fit: formattedFit },
    );
    check("no-horizontal-overflow", Object.values(presets).every((p) => p.overflow.scrollWidth <= p.overflow.clientWidth + 1), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.overflow.scrollWidth - v.overflow.clientWidth])));
    check("no-ellipsis-or-clamp", Object.values(presets).every((p) => p.overflow.textOverflow !== "ellipsis" && p.overflow.webkitLineClamp === "none"), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, v.overflow])));
    check("raw-400w-no-hscroll-or-ellipsis", raw.reading.scrollWidth <= raw.reading.clientWidth + 1 && raw.compact.scrollWidth <= raw.compact.clientWidth + 1 && raw.reading.overflow !== "ellipsis" && raw.compact.overflow !== "ellipsis", raw);
    check("drag-and-resize-affordances", Object.values(presets).every((p) => p.dragAreaPx >= 40 && p.resizeHandlePx >= 24), Object.fromEntries(Object.entries(presets).map(([k, v]) => [k, { drag: v.dragAreaPx, resize: v.resizeHandlePx }])));
    check("click-through-state-exposed", Object.values(presets).every((p) => p.clickThrough === "true" || p.clickThrough === "false"), presets.banner.clickThrough);
    check("state-hook-present", Object.values(presets).every((p) => typeof p.stateText === "string" && p.stateText.indexOf("font=") >= 0), presets.banner.stateText);
    check("per-preset-persistence-written", typeof metrics.storage === "string" && metrics.storage.indexOf("banner") >= 0 && metrics.storage.indexOf("reading") >= 0, (metrics.storage || "").slice(0, 160));

    const evidence = {
      generatedAt: new Date().toISOString(),
      surface: { page: path.relative(root, generatedPath).replace(/\\/g, "/"), electron: existsSync(path.join(electronDir, "package.json")) ? JSON.parse(readFileSync(path.join(electronDir, "package.json"), "utf8")).version : null, cdpPort: port },
      assertions,
      pass: assertions.every((a) => a.pass),
      presets,
      speakableScreenful: { words: formatted.screenfulWords, plainText: formatted.plainText, fit: formattedFit },
      raw400Words: raw,
      screenshot: path.relative(root, screenshotPath).replace(/\\/g, "/"),
    };
    writeFileSync(resultsPath, JSON.stringify(evidence, null, 2) + "\n");
    try {
      rmSync(generatedPath, { force: true });
    } catch {
      /* generated page is reproducible from the template */
    }
    console.log("[o1-cdp] " + (evidence.pass ? "PASS" : "FAIL") + " -> " + path.relative(root, resultsPath).replace(/\\/g, "/"));
    for (const assertion of assertions) console.log("[o1-cdp]   " + (assertion.pass ? "PASS" : "FAIL") + " " + assertion.name + " " + JSON.stringify(assertion.detail));
    if (!evidence.pass) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (port !== null) await closeBrowser(port);
    if (electron) {
      const exited = await Promise.race([electron.exit.then(() => true), sleep(4000).then(() => false)]);
      if (!exited && electron.child && !electron.child.killed) {
        if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(electron.child.pid), "/T", "/F"], { stdio: "ignore" });
        else electron.child.kill("SIGKILL");
      }
    }
  }
}

main().catch((error) => {
  console.error("[o1-cdp] FAILED:", error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
