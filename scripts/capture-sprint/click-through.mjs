/**
 * S4.1 — real OS click-through proof (no foreground-occlusion excuse).
 *
 * One Electron instance hosts a dedicated full-screen click-target window BEHIND
 * a protected overlay, both always-on-top with the overlay stacked last. The
 * harness foregrounds its own windows before every physical Win32 click.
 *
 *   ON  : overlay ignores mouse input -> click at a transparent overlay point
 *         increments the TARGET counter, never the overlay counter.
 *   OFF : click-through toggled off at runtime -> click on the overlay control
 *         button increments the OVERLAY counter, never the target counter.
 */
import { captureScreenshot, clickPhysical, closeProcess, evaluate, launchElectron, sleep, waitForPage } from "./lib.mjs";
import path from "node:path";

const PORTS = [9550, 9551, 9552, 9553, 9554, 9555];

async function launch(port, options, root) {
  for (const candidate of PORTS) {
    const instance = launchElectron(root, Object.assign({}, options, { port: candidate }));
    const ready = await waitForPage(candidate, "/overlay", "window.__overlayReady === true").catch(function (error) {
      console.error("[s4] launch " + candidate + " failed: " + String(error));
      return null;
    });
    if (ready) return { instance: instance, overlay: ready.cdp, overlayTarget: ready.target };
    console.error("[s4] electron stderr: " + instance.stderr().slice(-800));
    await closeProcess(instance, []);
  }
  throw new Error("could not launch Electron click harness");
}

export async function runClickThrough(root, server, evidenceDir) {
  const startedAt = Date.now();
  const results = { assertions: [], screenshots: [], timings: {} };
  function check(name, pass, detail) {
    results.assertions.push({ name: name, pass: Boolean(pass), detail: detail === undefined ? null : detail });
    console.log("[s4]   " + (pass ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " (" + JSON.stringify(detail) + ")" : ""));
    return Boolean(pass);
  }

  const launched = await launch(PORTS[0], { mode: "click", origin: server.origin, clickThrough: true, stealth: false }, root);
  let target = null;
  try {
    const targetPage = await waitForPage(launched.instance.port, "/target", "window.__targetReady === true");
    target = targetPage.cdp;
    results.timings.launchMs = Date.now() - startedAt;
    await sleep(900); // foreground + paint settle
    const info = launched.instance.info("[capture-sprint-main] info ");

    // ── ON: transparent overlay point -> click must reach the target ───────
    const onStart = Date.now();
    const onInjected = clickPhysical(info.transparentPointPhysical);
    await sleep(450);
    const overlayAfterOn = await evaluate(launched.overlay, "window.__overlayClicks");
    const targetAfterOn = await evaluate(target, "window.__targetClicks");
    results.timings.clickOnMs = Date.now() - onStart;
    results.on = {
      info: info,
      point: info.transparentPointPhysical,
      injected: onInjected,
      overlayClicks: overlayAfterOn,
      targetClicks: targetAfterOn,
      lastTargetClick: await evaluate(target, "window.__lastTargetClick || null"),
    };
    results.screenshots.push(await captureScreenshot(launched.overlay, path.join(evidenceDir, "s4-clickthrough-on-overlay.png")));
    results.screenshots.push(await captureScreenshot(target, path.join(evidenceDir, "s4-clickthrough-on-target.png")));
    check("click-through-on-target-received-click", targetAfterOn > 0, { targetClicks: targetAfterOn });
    check("click-through-on-overlay-did-not-receive-click", overlayAfterOn === 0, { overlayClicks: overlayAfterOn });

    // ── OFF: overlay button -> click must be consumed by the overlay ───────
    await evaluate(launched.overlay, "window.sprintControl.setIgnoreMouseEvents(false); true");
    await sleep(350);
    const offStart = Date.now();
    const buttonRect = await evaluate(
      launched.overlay,
      "(function(){var b=document.querySelector('[data-testid=\"overlay-button\"]');var r=b.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()",
    );
    const physical = {
      x: Math.round((info.overlayBounds.x + buttonRect.x + buttonRect.width / 2) * info.scaleFactor),
      y: Math.round((info.overlayBounds.y + buttonRect.y + buttonRect.height / 2) * info.scaleFactor),
    };
    const offInjected = clickPhysical(physical);
    await sleep(450);
    const overlayAfterOff = await evaluate(launched.overlay, "window.__overlayClicks");
    const targetAfterOff = await evaluate(target, "window.__targetClicks");
    results.timings.clickOffMs = Date.now() - offStart;
    results.off = {
      buttonRect: buttonRect,
      point: physical,
      injected: offInjected,
      overlayClicks: overlayAfterOff,
      targetClicks: targetAfterOff,
    };
    results.screenshots.push(await captureScreenshot(launched.overlay, path.join(evidenceDir, "s4-clickthrough-off-overlay.png")));
    // Exactly one click consumed by the overlay control; target untouched.
    check("click-through-off-overlay-control-received-click", overlayAfterOff === overlayAfterOn + 1, { overlayBefore: overlayAfterOn, overlayAfter: overlayAfterOff });
    check("click-through-off-target-did-not-receive-click", targetAfterOff === targetAfterOn, { targetBefore: targetAfterOn, targetAfter: targetAfterOff });
  } finally {
    await closeProcess(launched.instance, [launched.overlay, target]);
  }

  results.timings.totalMs = Date.now() - startedAt;
  results.pass = results.assertions.every(function (entry) { return entry.pass; });
  return results;
}
