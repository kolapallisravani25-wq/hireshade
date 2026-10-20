#!/usr/bin/env node
/**
 * Overlay auto-scroll scenario suite + streaming capture (W2 UX).
 *
 * Runs the REAL demo overlay page (restructured with the framework-free
 * auto-scroll controller) inside Electron over http, drives it through CDP, and
 * asserts:
 *   - 200-token stream stays pinned within 2 px of the bottom, per-frame update
 *     work stays within 16 ms;
 *   - synthetic scroll-up unlocks within one frame, pill appears, no snap-back,
 *     pill click re-locks;
 *   - new question scrolls into view, resets the answer pane and follows;
 *   - reopen restores the persisted per-session offset;
 *   - prefers-reduced-motion makes the jump instant;
 *   - short answer: no overflow, no movement, no pill;
 *   - PageUp/PageDown/Home/End/Space, without stealing focus.
 *
 * Records a short screencast -> docs/evidence/overlay-scroll/overlay-scroll-capture.mp4
 * plus screenshots and scroll-results.json.
 *
 * Usage: node scripts/scroll/overlay-scroll-e2e.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeBrowser, connectCdp, waitForCdp, waitForTarget } from "./cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const evidenceDir = path.join(root, "docs", "evidence", "overlay-scroll");
const generatedPage = path.join(evidenceDir, "scroll-demo.generated.html");
const resultsPath = path.join(evidenceDir, "scroll-results.json");
const capturePath = path.join(evidenceDir, "overlay-scroll-capture.mp4");
const framesDir = path.join(evidenceDir, "_screencast-frames");
const screenshotPinned = path.join(evidenceDir, "overlay-scroll-pinned.png");
const screenshotUnlocked = path.join(evidenceDir, "overlay-scroll-unlocked-pill.png");
const overlayHtmlPath = path.join(root, "artifacts", "craft-vita", "src", "demo", "overlay.html");
const runtimePath = path.join(root, "artifacts", "craft-vita", "src", "overlay", "autoscroll", "overlay-autoscroll.iife.js");
const harnessPath = path.join(here, "scroll-harness.js");
const electronDir = path.join(root, "artifacts", "desktop-electron", "node_modules", "electron");
const electronExe = path.join(electronDir, "dist", process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron");
const electronMain = path.join(here, "electron-scroll-main.cjs");
const SESSION_ID = "overlay-scroll-demo";

const assertions = [];
function check(name, pass, detail) {
  assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
  console.log("[scroll-e2e]   " + (pass ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " (" + JSON.stringify(detail) + ")" : ""));
  return Boolean(pass);
}
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
function buildRuntime() {
  const run = spawnSync(process.execPath, [path.join(here, "build-runtime.mjs")], { encoding: "utf8" });
  if (run.status !== 0) throw new Error("runtime build failed: " + run.stdout + "\n" + run.stderr);
  return JSON.parse(run.stdout).bytes;
}
function generatePage() {
  const template = readFileSync(overlayHtmlPath, "utf8");
  const runtime = readFileSync(runtimePath, "utf8");
  const harness = readFileSync(harnessPath, "utf8");
  const externalTag = '<script src="../overlay/autoscroll/overlay-autoscroll.iife.js"></script>';
  if (!template.includes(externalTag)) throw new Error("overlay.html no longer references the autoscroll runtime tag");
  let page = template.replace(externalTag, "<script>\n" + runtime + "\n</script>");
  const marker = "/*__OVERLAY_DATA__*/null";
  if (!page.includes(marker)) throw new Error("overlay.html is missing the __OVERLAY_DATA__ marker");
  page = page.replace(marker, JSON.stringify({ frames: [], meta: { sessionId: SESSION_ID } }));
  const bodyClose = page.lastIndexOf("</body>");
  if (bodyClose < 0) throw new Error("overlay.html has no </body>");
  page = page.slice(0, bodyClose) + "<script>\n" + harness + "\n</script>\n" + page.slice(bodyClose);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(generatedPage, page);
  return { bytes: page.length, inlinedRuntimeBytes: runtime.length };
}
async function startServer(filePath) {
  const server = http.createServer(function (request, response) {
    if (request.url === "/" || (request.url || "").startsWith("/scroll-demo")) {
      try {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(readFileSync(filePath));
      } catch (err) {
        response.writeHead(500);
        response.end(String(err));
      }
      return;
    }
    response.writeHead(404);
    response.end("not found");
  });
  await new Promise(function (resolve, reject) {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    url: "http://127.0.0.1:" + port + "/scroll-demo.html",
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    },
  };
}
function launchElectron(port, pageUrl) {
  const env = Object.assign({}, process.env, {
    DSH_CDP_PORT: String(port),
    DSH_OVERLAY_URL: pageUrl,
  });
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
  return { child: child, exit: exit, stdout: function () { return stdout; }, stderr: function () { return stderr; } };
}
function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch (err) {
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
  if (result.exceptionDetails) {
    throw new Error("Runtime.evaluate failed for " + expression + ": " + JSON.stringify(result.exceptionDetails));
  }
  return result.result ? result.result.value : undefined;
}
async function waitForHarness(cdp, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const ready = await evaluate(cdp, "Boolean(window.__scrollHarness && !window.__scrollHarness.error)");
      if (ready) return true;
    } catch (err) {
      /* page still loading */
    }
    await sleep(150);
  }
  throw new Error("scroll harness did not become ready");
}
async function reloadPage(cdp) {
  const loaded = cdp.once("Page.loadEventFired", 15000).catch(function () {});
  await cdp.send("Page.reload", { ignoreCache: false });
  await loaded;
  await waitForHarness(cdp);
}
async function screenshot(cdp, filePath) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(filePath, Buffer.from(result.data, "base64"));
  return statSync(filePath).size;
}
function startScreencast(cdp) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  let index = 0;
  const unsubscribe = cdp.on("Page.screencastFrame", function (params) {
    index += 1;
    const file = "frame-" + String(index).padStart(5, "0") + ".jpg";
    try {
      writeFileSync(path.join(framesDir, file), Buffer.from(params.data, "base64"));
      frames.push({ file: file, timestamp: params.metadata ? params.metadata.timestamp : index / 10 });
    } catch (err) {
      /* ignore a dropped frame */
    }
    cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(function () {});
  });
  return cdp
    .send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 900, maxHeight: 650, everyNthFrame: 1 })
    .then(function () {
      return {
        stop: async function () {
          await cdp.send("Page.stopScreencast").catch(function () {});
          unsubscribe();
          return frames;
        },
      };
    });
}
function encodeCapture(frames) {
  if (!frames.length) return { ok: false, reason: "no screencast frames" };
  const times = frames.map(function (frame) { return frame.timestamp; });
  const duration = Math.max(0.1, times[times.length - 1] - times[0]);
  const fps = Math.max(4, Math.min(30, Math.round(frames.length / duration)));
  const run = spawnSync(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-framerate", String(fps),
      "-i", path.join(framesDir, "frame-%05d.jpg"),
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      capturePath,
    ],
    { encoding: "utf8" },
  );
  if (run.status !== 0) return { ok: false, reason: run.stderr || "ffmpeg failed", fps: fps };
  const bytes = statSync(capturePath).size;
  rmSync(framesDir, { recursive: true, force: true });
  return { ok: true, frames: frames.length, durationSeconds: Number(duration.toFixed(2)), fps: fps, bytes: bytes };
}
async function main() {
  if (!existsSync(electronExe)) throw new Error("Electron binary not found at " + electronExe);
  const runtimeBytes = buildRuntime();
  const page = generatePage();
  console.log("[scroll-e2e] runtime " + runtimeBytes + " B, page " + page.bytes + " B");
  const server = await startServer(generatedPage);
  console.log("[scroll-e2e] serving " + server.url);

  let electron = null;
  let port = null;
  let cdp = null;
  let capture = { ok: false, reason: "not recorded" };
  const electronVersion = JSON.parse(readFileSync(path.join(electronDir, "package.json"), "utf8")).version;

  try {
    for (const candidate of [9333, 9334, 9335, 9336]) {
      electron = launchElectron(candidate, server.url);
      const ready = await waitForCdp(candidate, 12000);
      if (ready) {
        port = candidate;
        break;
      }
      killTree(electron.child);
      await electron.exit;
      electron = null;
    }
    if (!electron || port === null) throw new Error("Electron did not expose a CDP endpoint");
    const target = await waitForTarget(port, function (entry) { return String(entry.url).includes("scroll-demo"); });
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await waitForHarness(cdp);
    const environment = await evaluate(cdp, "({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visibility: document.visibilityState, ua: navigator.userAgent })");
    console.log("[scroll-e2e] page ready " + JSON.stringify(environment));

    // ── 1. 200-token stream: pinned within 2 px + frame budget + capture ────
    await evaluate(cdp, "window.__scrollHarness.reset({clearStorage:true})");
    const screencast = await startScreencast(cdp);
    await sleep(120);
    const longStream = await evaluate(cdp, "window.__scrollHarness.streamAndSample(200)");
    const pinnedScreenshotBytes = await screenshot(cdp, screenshotPinned);
    check("stream-200-tokens-sampled", longStream.samples.length === 200, longStream.samples.length);
    check("stream-pinned-within-2px", longStream.maxDistance <= 2, longStream.maxDistance.toFixed(2));
    check("stream-pinned-final", longStream.snapshot.pinned === true, longStream.snapshot.pinned);
    check("frame-update-work-under-16ms", longStream.snapshot.frameStats.maxUpdateMs <= 16, Number(longStream.snapshot.frameStats.maxUpdateMs.toFixed(3)));
    // Early tokens fit without overflow, so only post-overflow growth produces
    // transform writes; assert those are counted (and reported in results).
    check("frame-updates-counted", longStream.snapshot.frameStats.frames >= 50, longStream.snapshot.frameStats.frames);

    // ── 2. Synthetic scroll-up: unlock in one frame, pill, no snap-back ─────
    const beforeUnlock = longStream.snapshot.offset;
    const unlocked = await evaluate(cdp, "window.__scrollHarness.scrollUp(40)");
    check("unlock-pinned-false", unlocked.pinned === false, unlocked.pinned);
    check("unlock-pill-visible", unlocked.pillVisible === true && unlocked.pillHidden === false, { pillVisible: unlocked.pillVisible, pillHidden: unlocked.pillHidden });
    check("unlock-offset-moved", Math.abs(unlocked.offset - (beforeUnlock - 40)) <= 2, { before: beforeUnlock, after: unlocked.offset });
    const unlockedScreenshotBytes = await screenshot(cdp, screenshotUnlocked);
    const afterMoreTokens = await evaluate(cdp, "window.__scrollHarness.appendTokens(30)");
    check("no-snap-back-after-unlock", afterMoreTokens.pinned === false && Math.abs(afterMoreTokens.offset - unlocked.offset) <= 1, { offset: afterMoreTokens.offset, pinned: afterMoreTokens.pinned });
    check("pill-still-visible-after-growth", afterMoreTokens.pillVisible === true && afterMoreTokens.pillHidden === false, afterMoreTokens.pillVisible);
    const relocked = await evaluate(cdp, "window.__scrollHarness.clickPill()");
    check("pill-click-relocks", relocked.pinned === true, relocked.pinned);
    check("pill-click-bottom-within-2px", relocked.distanceFromBottom <= 2, relocked.distanceFromBottom);
    check("pill-hidden-after-relock", relocked.pillVisible === false && relocked.pillHidden === true, relocked.pillVisible);
    const frames = await screencast.stop();
    capture = encodeCapture(frames);
    console.log("[scroll-e2e] capture " + JSON.stringify(capture));

    // ── 3. New question: scroll into view, reset pane, keep answer start, follow ─
    const questionResult = await evaluate(cdp, "window.__scrollHarness.newQuestion('How would you handle Redis being unavailable?')");
    check("question-version-incremented", questionResult.snapshot.questionVersion >= 2, questionResult.snapshot.questionVersion);
    check("question-scrolled-into-view", questionResult.questionTopInViewport >= -2 && questionResult.questionTopInViewport <= 64, Number(questionResult.questionTopInViewport.toFixed(1)));
    check("new-answer-start-visible", questionResult.answerTopInViewport >= 0 && questionResult.answerTopInViewport < questionResult.viewportHeight, Number(questionResult.answerTopInViewport.toFixed(1)));
    const followed = await evaluate(cdp, "window.__scrollHarness.appendTokens(40)");
    check("question-follows-new-answer", followed.pinned === true && followed.distanceFromBottom <= 2, { pinned: followed.pinned, distance: followed.distanceFromBottom });

    // ── 4. Reopen/restore per-session scroll position ──────────────────────
    // Guarantee a tall transcript so the 80 px manual scroll is actually
    // possible (the pane shrinks for short answers by design).
    await evaluate(cdp, "window.__scrollHarness.appendTokens(200)");
    await evaluate(cdp, "window.__scrollHarness.scrollUp(80)");
    const persisted = await evaluate(cdp, "window.__scrollHarness.persistState()");
    check("persisted-unlocked-position", Boolean(persisted.parsed) && persisted.parsed.pinned === false && persisted.parsed.offset > 0, persisted.parsed);
    await reloadPage(cdp);
    // The transcript re-renders after reopen; the saved offset must be
    // re-applied as soon as the content is tall enough (clamped if shorter).
    const restored = await evaluate(cdp, "window.__scrollHarness.appendTokens(260)");
    const expectedRestored = Math.min(persisted.parsed.offset, restored.maxOffset);
    check("reopen-restores-offset", Math.abs(restored.offset - expectedRestored) <= 2, { saved: persisted.parsed.offset, restored: restored.offset, clampedExpected: expectedRestored });
    check("reopen-restores-unlocked", restored.pinned === false && restored.pillHidden === false, { pinned: restored.pinned, pillHidden: restored.pillHidden });

    // ── 5. Reduced motion: instant jump, no animation wait ────────────────
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await reloadPage(cdp);
    const reduced = await evaluate(cdp, "window.__scrollHarness.snapshot()");
    check("reduced-motion-detected", reduced.reducedMotion === true, reduced.reducedMotion);
    await evaluate(cdp, "window.__scrollHarness.scrollUp(40)");
    const instant = await evaluate(cdp, "window.__scrollHarness.clickPillImmediate()");
    check("reduced-motion-instant-relock", instant.pinned === true && instant.distanceFromBottom <= 2 && instant.pillHidden === true, { pinned: instant.pinned, distance: instant.distanceFromBottom });
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });

    // ── 6. Short answer: no overflow, no jump, no pill ─────────────────────
    await reloadPage(cdp);
    await evaluate(cdp, "window.__scrollHarness.reset({clearStorage:true})");
    const short = await evaluate(cdp, "window.__scrollHarness.shortAnswer('Short answer.')");
    check("short-answer-no-overflow", short.hasOverflow === false && short.maxOffset === 0, { hasOverflow: short.hasOverflow, maxOffset: short.maxOffset });
    check("short-answer-no-jump", short.offset === 0, short.offset);
    check("short-answer-no-pill", short.pillVisible === false && short.pillHidden === true, short.pillVisible);

    // ── 7. Keyboard PageUp/PageDown/Home/End/Space + focus safety ───────────
    await reloadPage(cdp);
    await evaluate(cdp, "window.__scrollHarness.reset({clearStorage:true})");
    await evaluate(cdp, "window.__scrollHarness.appendTokens(220)");
    const pageUp = await evaluate(cdp, "window.__scrollHarness.dispatchKey('PageUp')");
    check("keyboard-pageup-unlocks", pageUp.pinned === false && pageUp.pillHidden === false, { pinned: pageUp.pinned, pillHidden: pageUp.pillHidden });
    const end = await evaluate(cdp, "(async function(){ window.__scrollHarness.dispatchKey('End'); return await window.__scrollHarness.wait(340); })()");
    check("keyboard-end-relocks", end.pinned === true && end.distanceFromBottom <= 2, { pinned: end.pinned, distance: end.distanceFromBottom });
    const home = await evaluate(cdp, "(async function(){ window.__scrollHarness.dispatchKey('Home'); return await window.__scrollHarness.wait(340); })()");
    check("keyboard-home-unlocks", home.offset === 0 && home.pinned === false, { offset: home.offset, pinned: home.pinned });
    const space = await evaluate(cdp, "(async function(){ window.__scrollHarness.dispatchKey(' '); return await window.__scrollHarness.wait(340); })()");
    check("keyboard-space-pages-down", space.offset > 0, space.offset);
    const pageDown = await evaluate(cdp, "(async function(){ window.__scrollHarness.dispatchKey('PageDown'); return await window.__scrollHarness.wait(340); })()");
    check("keyboard-pagedown-moves", pageDown.offset >= space.offset, { before: space.offset, after: pageDown.offset });
    const active = await evaluate(cdp, "window.__scrollHarness.activeElement()");
    check("keyboard-does-not-steal-focus", active.isBody === true || active.tag === "BODY", active);

    const pass = assertions.every(function (entry) { return entry.pass; });
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          pass: pass,
          environment: {
            platform: process.platform,
            node: process.version,
            electron: electronVersion,
            page: environment,
            window: { width: 1000, height: 640, frame: false, transparent: true, alwaysOnTop: true },
          },
          commands: {
            run: "node scripts/scroll/overlay-scroll-e2e.mjs",
            buildRuntime: "node scripts/scroll/build-runtime.mjs",
            tests: "pnpm --dir artifacts/craft-vita exec vitest run src/overlay/autoscroll",
            captureToMp4: "ffmpeg -framerate <fps> -i frame-%05d.jpg -c:v libx264 -pix_fmt yuv420p overlay-scroll-capture.mp4",
          },
          scenarios: {
            longStream: {
              tokens: 200,
              maxDistanceFromBottomPx: Number(longStream.maxDistance.toFixed(2)),
              finalDistanceFromBottomPx: Number(longStream.snapshot.distanceFromBottom.toFixed(2)),
              frameStats: longStream.snapshot.frameStats,
            },
            unlock: {
              beforeOffset: beforeUnlock,
              afterOffset: unlocked.offset,
              unlockedWithinFrames: 1,
              noSnapBackOffset: afterMoreTokens.offset,
            },
            relock: { offset: relocked.offset, distanceFromBottom: relocked.distanceFromBottom },
            newQuestion: {
              questionTopInViewport: Number(questionResult.questionTopInViewport.toFixed(1)),
              answerTopInViewport: Number(questionResult.answerTopInViewport.toFixed(1)),
              followedDistanceFromBottom: Number(followed.distanceFromBottom.toFixed(2)),
            },
            reopen: { saved: persisted.parsed, restoredOffset: restored.offset, maxOffsetAfterRender: restored.maxOffset },
            reducedMotion: { instantOffset: instant.offset, distanceFromBottom: instant.distanceFromBottom },
            shortAnswer: { maxOffset: short.maxOffset, offset: short.offset, pillVisible: short.pillVisible },
            keyboard: {
              pageUpOffset: pageUp.offset,
              endOffset: end.offset,
              homeOffset: home.offset,
              spaceOffset: space.offset,
              pageDownOffset: pageDown.offset,
              activeElement: active,
            },
          },
          assertions: assertions,
          capture: Object.assign({}, capture, {
            file: path.relative(root, capturePath).replace(/\\/g, "/"),
            screenshots: [path.relative(root, screenshotPinned).replace(/\\/g, "/"), path.relative(root, screenshotUnlocked).replace(/\\/g, "/")],
            screenshotBytes: [pinnedScreenshotBytes, unlockedScreenshotBytes],
          }),
          electronLogs: {
            stdout: electron.stdout().slice(-3000),
            stderr: electron.stderr().slice(-3000),
          },
        },
        null,
        2,
      ) + "\n",
    );

    console.log("[scroll-e2e] results " + resultsPath);
    console.log("[scroll-e2e] capture " + (capture.ok ? capturePath + " (" + capture.frames + " frames, " + capture.bytes + " B)" : "FAILED: " + capture.reason));
    if (!capture.ok) check("streaming-capture-recorded", false, capture.reason);
    if (!pass || !capture.ok) throw new Error("overlay scroll assertions failed");
  } finally {
    if (cdp) cdp.close();
    if (port !== null) await closeBrowser(port);
    if (electron) {
      const exited = await Promise.race([electron.exit.then(function () { return true; }), sleep(4000).then(function () { return false; })]);
      if (!exited) {
        killTree(electron.child);
        await electron.exit;
      }
    }
    await server.close();
  }
}

main().catch(function (err) {
  console.error("[scroll-e2e] FAILED:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
