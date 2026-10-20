import fs from "node:fs";
import path from "node:path";

/**
 * Dump the live Electron overlay state over CDP.
 *
 * Usage: node scripts/cdp-overlay-state.mjs [outFile]
 * Requires the app to be started with HIRESHADE_DEBUG_CDP=9222.
 */

const DEBUG_PORT = process.env.CDP_PORT || "9222";
const EVIDENCE_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "docs", "evidence", "stealth-wiring");

function targetsUrl() {
  return "http://127.0.0.1:" + DEBUG_PORT + "/json";
}

async function waitForPages(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(targetsUrl());
      const targets = await response.json();
      const pages = targets.filter(
        (target) => target.type === "page" && /(launcher|floating)\.html/.test(target.url || ""),
      );
      if (pages.length > 0) return pages;
      lastError = new Error("no overlay page target yet");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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

const pages = await waitForPages(30000);
const page = pages.find((candidate) => /floating\.html/.test(candidate.url)) || pages[0];
const client = await connect(page.webSocketDebuggerUrl);
let snapshot;
try {
  await client.send("Runtime.enable");
  snapshot = await evaluate(
    client,
    "(async () => ({ state: await window.hireshadeDesktop.getState(), settings: await window.hireshadeDesktop.getSettings(), hotkeys: await window.hireshadeDesktop.getHotkeys() }))()",
  );
} finally {
  client.close();
}

const payload = {
  captured_at: new Date().toISOString(),
  cdp_port: DEBUG_PORT,
  targets: pages.map((target) => ({ title: target.title, url: target.url })),
  page: { title: page.title, url: page.url },
  state: snapshot.state,
  settings: snapshot.settings,
  hotkeys: snapshot.hotkeys,
};

const outFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(EVIDENCE_DIR, "electron-overlay-state.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2));
console.error("[cdp-overlay-state] wrote " + outFile);
