import fs from "node:fs";
import path from "node:path";

/**
 * Verify the Electron overlay controls over CDP:
 *   - IPC bridge exists under contextIsolation
 *   - opacity, dynamic click-through, private mode persist to main state
 *   - position presets move the window and persist under the preset label
 *   - all global hotkeys registered
 *
 * Usage: node scripts/cdp-verify-overlay.mjs [outFile]
 * Requires the app to be started with HIRESHADE_DEBUG_CDP=9222.
 */

const DEBUG_PORT = process.env.CDP_PORT || "9222";
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "docs", "evidence", "stealth-wiring");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPages(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json");
      const targets = await response.json();
      const pages = targets.filter(
        (target) => target.type === "page" && /(launcher|floating)\.html/.test(target.url || ""),
      );
      if (pages.length > 0) return pages;
      lastError = new Error("no overlay page target yet");
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw lastError || new Error("timed out waiting for overlay pages");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = message.id ? pending.get(message.id) : null;
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });
    socket.addEventListener("error", (event) => {
      reject(new Error("CDP socket error: " + (event.message || "unknown")));
    });
    socket.addEventListener("open", () => {
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { resolve: res, reject: rej });
            socket.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        close() {
          socket.close();
        },
      });
    });
  });
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error("evaluation failed: " + JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

function getState(client) {
  return evaluate(client, "window.hireshadeDesktop.getState()");
}

const checks = [];
function check(name, ok, details) {
  checks.push({ name, ok: Boolean(ok), details: details === undefined ? null : details });
}

const pages = await waitForPages(30000);
const page = pages.find((candidate) => /floating\.html/.test(candidate.url)) || pages[0];
const client = await connect(page.webSocketDebuggerUrl);
const steps = {};
try {
  await client.send("Runtime.enable");

  const bridge = await evaluate(
    client,
    "({ isElectron: window.hireshadeDesktop.isElectron === true, windowId: window.hireshadeDesktop.windowId, hasOnHotkey: typeof window.hireshadeDesktop.onHotkey === 'function', nodeIntegrationLeak: typeof window.require !== 'undefined' || typeof window.process !== 'undefined' || typeof window.module !== 'undefined', screen: { width: screen.width, availWidth: screen.availWidth, availHeight: screen.availHeight, devicePixelRatio: window.devicePixelRatio } })",
  );
  steps.display = bridge.screen;
  check("preload bridge exposed with contextIsolation", bridge.isElectron === true && bridge.hasOnHotkey, bridge);
  check("no Node globals leak into the renderer", bridge.nodeIntegrationLeak === false, bridge);

  const initial = await getState(client);
  steps.initial = initial;
  const initialHotkeys = initial.hotkeys || [];
  const required = [
    "CommandOrControl+Shift+H",
    "CommandOrControl+Shift+X",
    "CommandOrControl+Shift+M",
    "CommandOrControl+Shift+Up",
    "CommandOrControl+Enter",
    "CommandOrControl+H",
  ];
  for (const accelerator of required) {
    const binding = initialHotkeys.find((entry) => entry.accelerator === accelerator);
    check("hotkey registered: " + accelerator, Boolean(binding && binding.registered), binding || null);
  }

  const opacityResult = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.setOpacity(0.55); const state = await window.hireshadeDesktop.getState(); return { settings, state }; })()",
  );
  steps.opacity = opacityResult;
  check("opacity persisted to settings", opacityResult.settings.opacity === 0.55, opacityResult.settings.opacity);
  check(
    "opacity applied to the floating window",
    Math.abs((opacityResult.state.windows.floating.opacity || 0) - 0.55) < 0.06,
    opacityResult.state.windows.floating.opacity,
  );

  const clickThroughOff = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.setClickThrough(false); return settings; })()",
  );
  steps.clickThroughOff = clickThroughOff;
  check("dynamic click-through can be disabled", clickThroughOff.clickThrough === false, clickThroughOff.clickThrough);
  const clickThroughOn = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.setClickThrough(true); return settings; })()",
  );
  steps.clickThroughOn = clickThroughOn;
  check("dynamic click-through can be re-enabled", clickThroughOn.clickThrough === true, clickThroughOn.clickThrough);

  const presetResult = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.applyPositionPreset('top-right'); const state = await window.hireshadeDesktop.getState(); return { settings, state }; })()",
  );
  steps.preset = presetResult;
  const floatingBounds = presetResult.state.windows.floating.bounds;
  const initialBounds = initial.windows.floating.bounds;
  const availWidth = bridge.screen && bridge.screen.availWidth;
  const rightGap =
    floatingBounds && typeof availWidth === "number"
      ? availWidth - (floatingBounds.x + floatingBounds.width)
      : null;
  check("position preset stored", presetResult.settings.positionPreset === "top-right", presetResult.settings.positionPreset);
  check(
    "position preset moved the floating window to the top-right corner",
    Boolean(floatingBounds) &&
      floatingBounds.x >= 0 &&
      floatingBounds.x + floatingBounds.width <= availWidth + 4 &&
      rightGap !== null &&
      rightGap >= 0 &&
      rightGap <= 40,
    { bounds: floatingBounds, initialX: initialBounds.x, availWidth, rightGap },
  );

  const privateOff = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.setPrivateMode(false); return settings; })()",
  );
  steps.privateOff = privateOff;
  check("private mode can be disabled", privateOff.isPrivate === false, privateOff.isPrivate);
  const privateOn = await evaluate(
    client,
    "(async () => { const settings = await window.hireshadeDesktop.setPrivateMode(true); return settings; })()",
  );
  steps.privateOn = privateOn;
  check("private mode can be re-enabled", privateOn.isPrivate === true, privateOn.isPrivate);

  steps.final = await getState(client);
} finally {
  client.close();
}

const failures = checks.filter((entry) => !entry.ok);
const payload = {
  captured_at: new Date().toISOString(),
  cdp_port: DEBUG_PORT,
  page: { title: page.title, url: page.url },
  steps,
  checks,
  failures: failures.length,
  result: failures.length === 0 ? "PASS" : "FAIL",
};

const outFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(EVIDENCE_DIR, "electron-overlay-controls.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2));
console.error("[cdp-verify-overlay] wrote " + outFile + " (" + payload.result + ")");
process.exitCode = failures.length === 0 ? 0 : 1;
