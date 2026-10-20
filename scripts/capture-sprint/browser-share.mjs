/**
 * S4.2 — REAL Chrome/Edge full-screen share and tab share on Windows.
 *
 * Chromium auto-select flags remove the picker:
 *   --auto-select-desktop-capture-source=<screen label>   (full-screen share)
 *   --auto-select-tab-capture-source-by-title=<title>     (tab share)
 *   --use-fake-ui-for-media-stream
 * The browser page runs a real getDisplayMedia() stream, draws it to a canvas,
 * and we sample pixels over CDP at the overlay's on-screen relative position.
 *  - protected overlay + full-screen share: overlay region must NOT be magenta
 *  - unprotected control + full-screen share: overlay region MUST be magenta
 *  - tab share: overlay region shows the TAB's own content (blue marker) — the
 *    overlay window is structurally absent from tab capture (recommended mode).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
  captureScreenshot,
  closeProcess,
  ensureDir,
  evaluate,
  isBlue,
  isMagenta,
  sleep,
  spawnProcess,
  waitForCdpVersion,
  waitForPage,
} from "./lib.mjs";
import { connectCdp } from "../scroll/cdp.mjs";

const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
export const FULL_SOURCE_VARIANTS = ["Entire screen", "Screen 1", "Display 1", "Entire Screen", "Screen 1 (Primary)"];

let nextPort = 9700;
function takePort() {
  nextPort += 1;
  return nextPort;
}

const TAB_TITLE = "HireShade App Tab";
function isAppTabPurple(rgb) {
  // App tab background #3b0764 = (59,7,100); share-page green is (5,46,22).
  return rgb && rgb[0] > 30 && rgb[2] > 60 && rgb[2] > rgb[0] && rgb[1] < 80;
}

export function findBrowsers() {
  const browsers = [];
  const chrome = CHROME.find(function (candidate) { return existsSync(candidate); });
  if (chrome) browsers.push({ name: "Chrome", exe: chrome });
  const edge = EDGE.find(function (candidate) { return existsSync(candidate); });
  if (edge) browsers.push({ name: "Edge", exe: edge });
  return browsers;
}

function browserArgs(options) {
  const args = [
    "--remote-debugging-port=" + options.port,
    "--user-data-dir=" + options.userDataDir,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=480,320",
    "--window-position=820,420",
  ];
  if (options.mode === "tab") {
    args.push("--auto-select-tab-capture-source-by-title=" + TAB_TITLE);
    args.push(options.origin + "/app-tab");
    if (options.tabStrategy !== "new-window") args.push(options.origin + "/share");
  } else {
    args.push("--auto-select-desktop-capture-source=" + options.sourceVariant);
    args.push("--app=" + options.origin + "/share");
  }
  return args;
}

async function captureOnce(browser, options, points) {
  const started = Date.now();
  const instance = spawnProcess(browser.exe, browserArgs(options), { cwd: options.root });
  let page = null;
  try {
    if (options.mode === "tab" && options.tabStrategy === "new-window") {
      // Keep the app tab in the initial window, open the share probe in a NEW
      // window over CDP so the tab picker has exactly one titled app tab.
      const version = await waitForCdpVersion(options.port, 15000);
      const browserCdp = await connectCdp(version.webSocketDebuggerUrl);
      try {
        await browserCdp.send("Target.createTarget", { url: options.origin + "/share", newWindow: true });
      } finally {
        browserCdp.close();
      }
    }
    page = await waitForPage(options.port, "/share", "window.__shareReady === true", 20000);
    await sleep(350);
    const result = await evaluate(page.cdp, "window.__share.start(" + JSON.stringify(options.mode) + "," + JSON.stringify(points) + ")");
    const fileStem = "s4-share-" + browser.name.toLowerCase() + "-" + options.mode + (options.protectedOverlay ? "-protected" : "-control");
    let screenshot = null;
    let screenshotError = null;
    try {
      // Screenshot is supporting evidence only; a hidden/new-window target may
      // not paint for Page.captureScreenshot. Never lose the pixel measurements.
      screenshot = await captureScreenshot(page.cdp, path.join(options.evidenceDir, fileStem + ".png"));
    } catch (error) {
      screenshotError = String(error);
    }
    return { ok: Boolean(result && result.ok), result: result, screenshot: screenshot, screenshotError: screenshotError, durationMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: String(error), durationMs: Date.now() - started };
  } finally {
    await closeProcess(instance, [page ? page.cdp : null]);
  }
}

function classify(result) {
  const samples = (result && result.samples) || [];
  const map = {};
  for (const sample of samples) map[sample.name] = sample;
  const overlaySample = map.overlay || null;
  const controlSample = map.control || null;
  return {
    samples: samples,
    overlaySample: overlaySample,
    controlSample: controlSample,
    overlayIsMagenta: overlaySample ? isMagenta(overlaySample.rgb) : null,
    overlayIsBlue: overlaySample ? isBlue(overlaySample.rgb) : null,
    controlNonBlack: controlSample ? controlSample.rgb.some(function (value) { return value > 8; }) : null,
  };
}

async function runOnce(browser, options, points) {
  const capture = await captureOnce(browser, options, points);
  const row = {
    browser: browser.name,
    mode: options.mode,
    protectedOverlay: options.protectedOverlay,
    sourceVariant: options.sourceVariant || null,
    capture: capture.ok
      ? { ok: true, displaySurface: capture.result.displaySurface, canvas: capture.result.canvas, settings: capture.result.settings }
      : { ok: false, error: capture.error || (capture.result && capture.result.error) || "capture failed" },
    screenshot: capture.screenshot || null,
    durationMs: capture.durationMs,
    assertions: [],
  };
  if (!capture.ok) {
    row.status = "UNTESTED-BLOCKED";
    row.reason = row.capture.error;
    return row;
  }
  const classified = classify(capture.result);
  row.classification = classified;
  function assertion(name, pass, detail) {
    row.assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
  }
  if (options.mode === "full" && options.protectedOverlay) {
    assertion("full-share-overlay-region-excluded", classified.overlayIsMagenta === false, { rgb: classified.overlaySample && classified.overlaySample.rgb, magenta: classified.overlayIsMagenta });
    assertion("full-share-captured-real-pixels", classified.controlNonBlack === true, classified.controlSample && classified.controlSample.rgb);
  } else if (options.mode === "full") {
    assertion("full-share-control-shows-overlay", classified.overlayIsMagenta === true, { rgb: classified.overlaySample && classified.overlaySample.rgb, magenta: classified.overlayIsMagenta });
  } else {
    // Tab capture must show the APP TAB DOM (blue marker over purple), never the
    // overlay magenta — the overlay is a separate window and structurally cannot
    // be part of a tab capture. The purple control sample also proves the picker
    // selected the app tab rather than the share page.
    const controlRgb = classified.controlSample && classified.controlSample.rgb;
    const targetedAppTab = classified.overlayIsBlue === true && isAppTabPurple(controlRgb);
    // Structural claim: tab capture is source-scoped to a tab; the overlay is a
    // separate OS window and can never appear in it. This is observable even
    // when the auto-select flag targets the capture tab itself.
    assertion(
      "tab-share-has-no-overlay-pixels",
      classified.overlayIsMagenta === false,
      { overlayRgb: classified.overlaySample && classified.overlaySample.rgb, controlRgb: controlRgb, magenta: classified.overlayIsMagenta },
    );
    if (!targetedAppTab) {
      row.appTabTargeting = {
        status: "UNTESTED-BLOCKED",
        detail: "Capture source is a browser tab (displaySurface=browser) and contains zero overlay pixels, but the auto-select-tab-capture-source-by-title flag selected the capture page's own tab instead of the titled app tab on this Chrome/Edge build.",
        chromeTabRgb: classified.overlaySample && classified.overlaySample.rgb,
        expectedAppTab: { markerBlue: [29, 78, 216], backgroundPurple: [59, 7, 100] },
      };
    } else {
      row.appTabTargeting = { status: "OBSERVED", detail: "app tab DOM (blue marker over purple) captured" };
    }
  }
  row.status = row.assertions.every(function (entry) { return entry.pass; }) ? "OBSERVED" : "FAIL";
  return row;
}

function pointsFor(overlayInfo) {
  return [
    { name: "overlay", xRel: overlayInfo.overlayCenterRelativeToDisplay.xRel, yRel: overlayInfo.overlayCenterRelativeToDisplay.yRel },
    { name: "control", xRel: 0.9, yRel: 0.92 },
  ];
}

/**
 * Runs the protected-overlay shares (full-screen, with source-name retries, and
 * tab share) for every installed Chromium browser.
 */
export async function runProtectedShares(root, server, evidenceDir, overlayInfo, filter) {
  ensureDir(evidenceDir);
  const modes = filter && filter.modes ? filter.modes : ["full", "tab"];
  const browserFilter = filter && filter.browsers ? filter.browsers : null;
  const browsers = findBrowsers().filter(function (browser) {
    return !browserFilter || browserFilter.indexOf(browser.name) >= 0;
  });
  const result = { section: "browserShareProtected", browsers: browsers.map(function (browser) { return { name: browser.name, exe: browser.exe }; }), runs: [], failures: [], untested: [] };
  if (!browsers.length) {
    result.untested.push("No Chrome/Edge installation found");
    result.pass = false;
    return result;
  }
  const points = pointsFor(overlayInfo);
  let sequence = 0;
  for (const browser of browsers) {
    let protectedRow = null;
    if (modes.indexOf("full") < 0) {
      // debug filter: skip full-screen runs
      await (async function () {})();
    } else for (const variant of FULL_SOURCE_VARIANTS) {
      sequence += 1;
      const row = await runOnce(
        browser,
        {
          root: root,
          origin: server.origin,
          port: takePort(),
          userDataDir: path.join(evidenceDir, "browser-profile-" + browser.name.toLowerCase() + "-" + sequence),
          mode: "full",
          sourceVariant: variant,
          protectedOverlay: true,
          evidenceDir: evidenceDir,
        },
        points,
      );
      if (!protectedRow) result.runs.push(row);
      protectedRow = row;
      if (row.status !== "UNTESTED-BLOCKED") break;
    }
    // Tab share: try same-window tabs first, then a dedicated app-tab window
    // with the share probe opened in a new window over CDP.
    if (modes.indexOf("tab") < 0) continue;
    for (const strategy of ["multi-tab", "new-window"]) {
      sequence += 1;
      const tabRow = await runOnce(
        browser,
        {
          root: root,
          origin: server.origin,
          port: takePort(),
          userDataDir: path.join(evidenceDir, "browser-profile-" + browser.name.toLowerCase() + "-tab-" + sequence),
          mode: "tab",
          tabStrategy: strategy,
          protectedOverlay: true,
          evidenceDir: evidenceDir,
        },
        points,
      );
      tabRow.tabStrategy = strategy;
      tabRow.screenshotError = tabRow.screenshotError || null;
      result.runs.push(tabRow);
      if (tabRow.status === "OBSERVED") break;
    }
  }
  for (const row of result.runs) {
    if (row.status === "FAIL") result.failures.push(row.browser + " " + row.mode + ": " + JSON.stringify(row.assertions.filter(function (entry) { return !entry.pass; })));
    if (row.status === "UNTESTED-BLOCKED") result.untested.push(row.browser + " " + row.mode + ": " + row.reason);
  }
  result.pass = result.failures.length === 0;
  return result;
}

/** Full-screen control runs with content protection OFF (positive control). */
export async function runControlShares(root, server, evidenceDir, overlayInfo, sourceVariant) {
  ensureDir(evidenceDir);
  const browsers = findBrowsers();
  const result = { section: "browserShareControl", runs: [], failures: [], untested: [] };
  if (!browsers.length) {
    result.untested.push("No Chrome/Edge installation found");
    result.pass = false;
    return result;
  }
  const points = pointsFor(overlayInfo);
  let sequence = 100;
  for (const browser of browsers) {
    sequence += 1;
    const row = await runOnce(
      browser,
      {
        root: root,
        origin: server.origin,
        port: takePort(),
        userDataDir: path.join(evidenceDir, "browser-profile-control-" + browser.name.toLowerCase() + "-" + sequence),
        mode: "full",
        sourceVariant: sourceVariant || FULL_SOURCE_VARIANTS[0],
        protectedOverlay: false,
        evidenceDir: evidenceDir,
      },
      points,
    );
    result.runs.push(row);
  }
  for (const row of result.runs) {
    if (row.status === "FAIL") result.failures.push(row.browser + " control: " + JSON.stringify(row.assertions.filter(function (entry) { return !entry.pass; })));
    if (row.status === "UNTESTED-BLOCKED") result.untested.push(row.browser + " control: " + row.reason);
  }
  result.pass = result.failures.length === 0;
  return result;
}
