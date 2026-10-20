#!/usr/bin/env node
/**
 * Overlay e2e proof (G-005): renders the measured event stream in a real
 * Electron overlay window and asserts the streamed answer appears in the DOM via
 * CDP, then saves a screenshot + DOM/timing assertion JSON.
 *
 * Usage: node scripts/demo/overlay-e2e.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, connectCdp, waitForPageTarget } from "./cdp-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const evidenceDir = path.join(repoRoot, "docs", "evidence", "demo");
const overlayDataPath = path.join(evidenceDir, "demo-overlay.json");
const templatePath = path.join(repoRoot, "artifacts", "craft-vita", "src", "demo", "overlay.html");
const generatedPath = path.join(evidenceDir, "overlay.generated.html");
const screenshotPath = path.join(evidenceDir, "overlay-answer.png");
const domEvidencePath = path.join(evidenceDir, "overlay-dom.json");
const electronDir = path.join(repoRoot, "artifacts", "desktop-electron", "node_modules", "electron");
const electronExe = path.join(electronDir, "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const overlayMain = path.join(here, "electron-overlay-main.cjs");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function injectOverlayData() {
  const replay = JSON.parse(readFileSync(overlayDataPath, "utf8"));
  const template = readFileSync(templatePath, "utf8");
  const marker = "/*__OVERLAY_DATA__*/null";
  if (!template.includes(marker)) {
    throw new Error("overlay.html is missing the __OVERLAY_DATA__ injection marker");
  }
  const injected = template.replace(marker, JSON.stringify(replay));
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(generatedPath, injected);
  return { replay, bytes: injected.length };
}

async function launchElectron(port) {
  const env = {
    ...process.env,
    DSH_CDP_PORT: String(port),
    DSH_OVERLAY_HTML: generatedPath,
  };
  // Some harness/CI environments export ELECTRON_RUN_AS_NODE=1 (so the binary
  // behaves as plain Node). That disables the Electron main process entirely —
  // require("electron") then fails and no CDP endpoint is created.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronExe, [overlayMain], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, exit, getStdout: () => stdout, getStderr: () => stderr };
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetch("http://127.0.0.1:" + port + "/json/version").then((r) => r.json());
      if (version.Browser) return version;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return null;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error("Runtime.evaluate failed: " + JSON.stringify(result.exceptionDetails));
  }
  return result.result?.value;
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    /* best effort */
  }
}

async function main() {
  if (!existsSync(electronExe)) {
    throw new Error("Electron binary not found at " + electronExe + " — run pnpm install in artifacts/desktop-electron");
  }
  if (!existsSync(overlayDataPath)) {
    throw new Error("Missing " + overlayDataPath + " — run the pipeline first (make demo).");
  }
  const { replay } = injectOverlayData();
  console.log("[overlay-e2e] replay frames=" + replay.frames.length + " generated=" + generatedPath);

  const consoleMessages = [];
  const candidates = [9333, 9334, 9335, 9336];
  let electron = null;
  let port = null;
  let cdp = null;
  let pageTarget = null;

  try {
    for (const candidate of candidates) {
      electron = await launchElectron(candidate);
      const ready = await waitForCdp(candidate, 12_000);
      if (ready) {
        port = candidate;
        break;
      }
      console.error("[overlay-e2e] port " + candidate + " did not expose CDP; retrying");
      killProcessTree(electron.child);
      await electron.exit;
      electron = null;
    }
    if (!electron || port === null) {
      throw new Error("Electron did not expose a CDP endpoint");
    }

    pageTarget = await waitForPageTarget(port, "overlay.generated.html", { timeoutMs: 15_000 });
    console.log("[overlay-e2e] page target " + pageTarget.url);
    cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    cdp.send("Log.enable").then(
      (stream) => stream,
      () => {},
    );

    const deadline = Date.now() + 40_000;
    let dom = null;
    while (Date.now() < deadline) {
      dom = await evaluate(
        cdp,
        "(() => { const get = (sel) => { const el = document.querySelector(sel); return el ? el.textContent : null; }; return { title: document.title, visibility: document.visibilityState, done: window.__OVERLAY_DONE__ === true, framesApplied: window.__OVERLAY_FRAMES_APPLIED__, status: get('[data-testid=\"status\"]'), model: get('[data-testid=\"model\"]'), question: get('[data-testid=\"question\"]'), answer: get('[data-testid=\"answer-text\"]'), partial: get('[data-testid=\"partial\"]'), timings: window.__OVERLAY_TIMINGS__ }; })()",
      );
      if (dom && dom.done) break;
      await sleep(150);
    }
    if (!dom || !dom.done) {
      throw new Error("Overlay did not finish replaying frames within 40 s: " + JSON.stringify(dom));
    }

    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));

    const answerText = String(dom.answer ?? "");
    const questionText = String(dom.question ?? "");
    const timing = dom.timings ?? {};
    const answerVisibleMs =
      typeof timing.completeAtMs === "number" && typeof timing.questionAtMs === "number"
        ? timing.completeAtMs - timing.questionAtMs
        : null;

    const assertions = [
      { name: "overlay-done", pass: dom.done === true, detail: String(dom.done) },
      { name: "status-complete", pass: String(dom.status).toLowerCase().includes("complete"), detail: String(dom.status) },
      {
        name: "question-rendered",
        // The overlay shows the most recent detected question (Q2 mentions Redis).
        pass: questionText.trim().length > 10 && /(redis|rate limiter)/i.test(questionText),
        detail: questionText,
      },
      {
        name: "answer-length",
        pass: answerText.length > 80,
        detail: answerText.length + " chars",
      },
      { name: "answer-mentions-rate-limiter", pass: /rate limiter/i.test(answerText), detail: "regex /rate limiter/i" },
      { name: "answer-mentions-redis", pass: /redis/i.test(answerText), detail: "regex /redis/i" },
      {
        name: "answer-visible-within-budget",
        pass: answerVisibleMs !== null && answerVisibleMs > 0 && answerVisibleMs <= 5000,
        detail: (answerVisibleMs === null ? "n/a" : answerVisibleMs.toFixed(1)) + " ms (budget 5000 ms)",
      },
      {
        name: "frames-applied",
        pass: dom.framesApplied === replay.frames.length,
        detail: String(dom.framesApplied) + "/" + replay.frames.length,
      },
      { name: "window-visible", pass: dom.visibility !== "hidden", detail: String(dom.visibility) },
    ];
    const evidence = {
      generatedAt: new Date().toISOString(),
      pass: assertions.every((assertion) => assertion.pass),
      surface: {
        kind: "electron-overlay",
        window: { frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true },
        electronExe,
        cdpPort: port,
        pageUrl: pageTarget.url,
      },
      assertionVia: "CDP Runtime.evaluate DOM text",
      dom: {
        title: dom.title,
        status: dom.status,
        model: dom.model,
        question: questionText,
        answerChars: answerText.length,
        answerPreview: answerText.slice(0, 220),
        framesApplied: dom.framesApplied,
        timings: {
          startedAt: timing.startedAt ?? null,
          questionAtMs: timing.questionAtMs ?? null,
          firstTokenAtMs: timing.firstTokenAtMs ?? null,
          completeAtMs: timing.completeAtMs ?? null,
          answerVisibleMs,
        },
      },
      assertions,
      screenshot: path.relative(repoRoot, screenshotPath).replace(/\\/g, "/"),
      electronLogs: {
        stdout: electron.getStdout().slice(-4000),
        stderr: electron.getStderr().slice(-4000),
      },
      consoleMessages,
    };
    writeFileSync(domEvidencePath, JSON.stringify(evidence, null, 2) + "\n");

    console.log("[overlay-e2e] answer chars=" + answerText.length + " visibleMs=" + (answerVisibleMs === null ? "n/a" : answerVisibleMs.toFixed(1)));
    for (const assertion of assertions) {
      console.log("[overlay-e2e]   " + (assertion.pass ? "PASS" : "FAIL") + " " + assertion.name + " (" + assertion.detail + ")");
    }
    console.log("[overlay-e2e] screenshot " + screenshotPath);
    console.log("[overlay-e2e] DOM assertions " + domEvidencePath);
    if (!evidence.pass) throw new Error("overlay DOM assertions failed");
  } finally {
    if (cdp) cdp.close();
    if (port !== null) await closeBrowser(port);
    if (electron) {
      const exited = await Promise.race([
        electron.exit.then(() => true),
        sleep(4_000).then(() => false),
      ]);
      if (!exited) {
        console.error("[overlay-e2e] Electron did not exit; killing process tree");
        killProcessTree(electron.child);
        await electron.exit;
      }
    }
  }
}

main().catch((err) => {
  console.error("[overlay-e2e] FAILED:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
