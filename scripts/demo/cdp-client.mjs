/**
 * Minimal Chrome DevTools Protocol client (no dependencies).
 * Node 24 ships a global WebSocket, so a raw CDP client is ~80 lines.
 */

export async function connectCdp(webSocketDebuggerUrl, { timeoutMs = 15_000 } = {}) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket open timed out")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error("CDP websocket error: " + (event?.message ?? "unknown")));
    });
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (!message || typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error("CDP " + waiter.method + ": " + JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });

  function send(method, params = {}, { timeoutMs: sendTimeoutMs = 20_000 } = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("CDP " + method + " timed out"));
      }, sendTimeoutMs);
      pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  return {
    send,
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Polls /json/list until a page target whose URL matches is available. */
export async function waitForPageTarget(port, urlPart, { timeoutMs = 15_000, host = "127.0.0.1" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch("http://" + host + ":" + port + "/json/list").then((r) => r.json());
      const page = targets.find((target) => target.type === "page" && String(target.url).includes(urlPart));
      if (page && page.webSocketDebuggerUrl) return page;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for CDP page target (port " + port + "): " + String(lastError ?? ""));
}

/** Closes the Electron browser over CDP so the child exits cleanly. */
export async function closeBrowser(port, { host = "127.0.0.1" } = {}) {
  try {
    const version = await fetch("http://" + host + ":" + port + "/json/version").then((r) => r.json());
    if (!version.webSocketDebuggerUrl) return false;
    const cdp = await connectCdp(version.webSocketDebuggerUrl);
    try {
      await cdp.send("Browser.close");
    } finally {
      cdp.close();
    }
    return true;
  } catch {
    return false;
  }
}
