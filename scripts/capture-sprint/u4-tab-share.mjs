#!/usr/bin/env node
/**
 * U4 — real Chrome/Edge TAB-SHARE picker automation, fixed.
 *
 * Root cause of the earlier artifact: with --use-fake-ui-for-media-stream the
 * fake picker auto-accepts the CURRENT tab before the
 * --auto-select-tab-capture-source-by-title match is honoured, so the capture
 * page captured itself. Fix:
 *   - do NOT pass --use-fake-ui-for-media-stream for tab share;
 *   - launch the browser with the app tab as the ONLY tab in a dedicated window;
 *   - open the capture page in a SEPARATE window over CDP (Target.createTarget
 *     newWindow) so the picker can never pick the capture page;
 *   - getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false,
 *     selfBrowserSurface: 'exclude', preferCurrentTab: false,
 *     surfaceSwitching: 'exclude' }) — the displaySurface hint is required to
 *     enter the tab picker; the other three fields are the U4 self-exclusion.
 *
 * Expected: displaySurface=browser, app-tab DOM pixel (blue marker / purple
 * background), zero overlay pixels (no magenta).
 *
 * Usage: node scripts/capture-sprint/u4-tab-share.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppTabHtml, buildOverlayHtml, buildShareHtml, buildTargetHtml } from "./pages.mjs";
import {
  captureScreenshot,
  closeProcess,
  connectCdp,
  ensureDir,
  evaluate,
  spawnProcess,
  startServer,
  waitForCdpVersion,
  waitForPage,
  writeJson,
  sleep,
} from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const evidenceDir = path.join(root, "docs", "evidence", "capture-sprint", "s4");
const resultsPath = path.join(evidenceDir, "u4-tab-share-results.json");
const APP_TAB_TITLE = "HireShade App Tab";
const BROWSERS = [
  { name: "Chrome", exe: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" },
  { name: "Edge", exe: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" },
];
const POINTS = [
  { name: "overlay", xRel: 0.44619523443504994, yRel: 0.46653005464480873 },
  { name: "control", xRel: 0.9, yRel: 0.92 },
];
const TAB_CONSTRAINTS = {
  video: { displaySurface: "browser" },
  audio: false,
  selfBrowserSurface: "exclude",
  preferCurrentTab: false,
  surfaceSwitching: "exclude",
};

function isMagenta(rgb) {
  return Boolean(rgb) && rgb[0] > 170 && rgb[2] > 170 && rgb[1] < 130;
}
function isBlue(rgb) {
  return Boolean(rgb) && rgb[2] > 120 && rgb[1] < 150 && rgb[0] < 140;
}
function isAppTabPurple(rgb) {
  return Boolean(rgb) && rgb[0] > 30 && rgb[2] > 60 && rgb[2] > rgb[0] && rgb[1] < 80;
}

async function waitForTabTitle(port, urlPart, title, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      const targets = await fetch("http://127.0.0.1:" + port + "/json/list").then(function (response) { return response.json(); });
      const match = targets.find(function (entry) {
        return entry.type === "page" && String(entry.url).includes(urlPart) && entry.title === title;
      });
      if (match) return match;
    } catch (error) { /* browser starting */ }
    await sleep(150);
  }
  throw new Error("app tab \"" + title + "\" did not appear");
}

async function runBrowser(browser, server, index) {
  const port = 9810 + index;
  const profile = path.join(evidenceDir, "u4-profile-" + browser.name.toLowerCase());
  const args = [
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=900,600",
    // NOTE: deliberately NO --use-fake-ui-for-media-stream: it overrides the
    // tab auto-select match and captures the current tab.
    "--auto-select-tab-capture-source-by-title=" + APP_TAB_TITLE,
    server.origin + "/app-tab",
  ];
  const startedAt = Date.now();
  const processHandle = spawnProcess(browser.exe, args, { cwd: root });
  let browserCdp = null;
  let sharePage = null;
  let appTabPage = null;
  const row = { browser: browser.name, exe: browser.exe, url: server.origin, assertions: [], screenshots: [] };
  try {
    const version = await waitForCdpVersion(port, 20000);
    browserCdp = await connectCdp(version.webSocketDebuggerUrl);
    const appTabTarget = await waitForTabTitle(port, "/app-tab", APP_TAB_TITLE);
    appTabPage = await connectCdp(appTabTarget.webSocketDebuggerUrl);
    await appTabPage.send("Page.enable");
    // Dedicated app-tab window already exists; open the capture page in a NEW
    // window so the picker cannot select the capture page itself.
    await browserCdp.send("Target.createTarget", { url: server.origin + "/share", newWindow: true });
    const ready = await waitForPage(port, "/share", "window.__shareReady === true", 20000);
    sharePage = ready.cdp;
    await sleep(400);
    const result = await evaluate(sharePage, "window.__share.startWith(" + JSON.stringify(TAB_CONSTRAINTS) + "," + JSON.stringify(POINTS) + ")");
    row.result = result;
    if (!result || !result.ok) {
      row.status = "UNTESTED-BLOCKED";
      row.reason = result && result.error || "capture failed";
      return row;
    }
    const samples = result.samples || [];
    const overlaySample = samples.find(function (sample) { return sample.name === "overlay"; }) || null;
    const controlSample = samples.find(function (sample) { return sample.name === "control"; }) || null;
    row.displaySurface = result.displaySurface;
    row.trackLabel = result.trackLabel;
    row.canvas = result.canvas;
    row.requestedConstraints = result.requestedConstraints;
    row.samples = samples;
    row.classification = {
      overlayIsBlue: isBlue(overlaySample && overlaySample.rgb),
      overlayIsMagenta: isMagenta(overlaySample && overlaySample.rgb),
      controlIsAppTabPurple: isAppTabPurple(controlSample && controlSample.rgb),
    };
    function assertion(name, pass, detail) {
      row.assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
    }
    assertion("tab-capture-display-surface", result.displaySurface === "browser", result.displaySurface);
    assertion("tab-capture-app-tab-dom-pixel", row.classification.overlayIsBlue, overlaySample && overlaySample.rgb);
    assertion("tab-capture-app-tab-background", row.classification.controlIsAppTabPurple, controlSample && controlSample.rgb);
    assertion("tab-capture-zero-overlay-pixels", row.classification.overlayIsMagenta === false, { overlayRgb: overlaySample && overlaySample.rgb, magenta: row.classification.overlayIsMagenta });
    try {
      const shot = await captureScreenshot(sharePage, path.join(evidenceDir, "u4-tab-" + browser.name.toLowerCase() + "-captured.png"));
      row.screenshots.push(shot);
    } catch (error) {
      row.screenshotError = String(error);
    }
    try {
      const appShot = await captureScreenshot(appTabPage, path.join(evidenceDir, "u4-tab-" + browser.name.toLowerCase() + "-app-tab.png"));
      row.screenshots.push(appShot);
    } catch (error) { /* background tab screenshot can be unavailable */ }
    row.status = row.assertions.every(function (entry) { return entry.pass; }) ? "OBSERVED" : "FAIL";
    row.durationMs = Date.now() - startedAt;
    return row;
  } catch (error) {
    row.status = "UNTESTED-BLOCKED";
    row.reason = String(error);
    return row;
  } finally {
    if (browserCdp) browserCdp.close();
    await closeProcess(processHandle, [sharePage, appTabPage]);
  }
}

async function main() {
  ensureDir(evidenceDir);
  const server = await startServer({
    "/target": buildTargetHtml(),
    "/overlay": buildOverlayHtml(),
    "/share": buildShareHtml(),
    "/app-tab": buildAppTabHtml(),
  });
  const results = {
    generatedAt: new Date().toISOString(),
    kind: "u4-tab-share-fixed",
    constraints: TAB_CONSTRAINTS,
    method:
      "dedicated app-tab window (auto-select-tab-capture-source-by-title) + capture page in a separate window over CDP; NO --use-fake-ui-for-media-stream; displaySurface=browser hint + selfBrowserSurface=exclude + preferCurrentTab=false + surfaceSwitching=exclude",
    browsers: [],
    pass: false,
  };
  try {
    for (let index = 0; index < BROWSERS.length; index++) {
      const browser = BROWSERS[index];
      console.log("[u4] == " + browser.name + " tab share ==");
      const row = await runBrowser(browser, server, index);
      results.browsers.push(row);
      console.log("[u4] " + browser.name + " status=" + row.status + " displaySurface=" + row.displaySurface + " samples=" + JSON.stringify((row.samples || []).map(function (sample) { return [sample.name, sample.rgb]; })) + (row.reason ? " reason=" + row.reason : ""));
      for (const assertion of row.assertions || []) {
        console.log("[u4]   " + (assertion.pass ? "PASS" : "FAIL") + " " + assertion.name + " (" + JSON.stringify(assertion.detail) + ")");
      }
    }
    results.pass = results.browsers.length === BROWSERS.length && results.browsers.every(function (row) { return row.status === "OBSERVED"; });
    results.status = results.pass ? "OBSERVED" : results.browsers.some(function (row) { return row.status === "FAIL"; }) ? "FAIL" : "UNTESTED-BLOCKED";
    writeJson(resultsPath, results);
    console.log("[u4] " + results.status + " -> " + resultsPath);
    if (!results.pass) throw new Error("U4 tab share not observed");
  } finally {
    await server.close();
  }
}

main().catch(function (error) {
  console.error("[u4] FAILED: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
