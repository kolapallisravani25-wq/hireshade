/**
 * Minimal Chrome DevTools Protocol client with event support (no deps).
 * Node 24 ships a global WebSocket. Used by the overlay-scroll scenario suite
 * for DOM assertions, emulation, screenshots and screencast recording.
 */
export async function connectCdp(webSocketDebuggerUrl, { timeoutMs = 15_000 } = {}) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  const listeners = new Map();
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
    if (!message || typeof message !== "object") return;
    if (typeof message.id === "number") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error("CDP " + waiter.method + ": " + JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      for (const listener of [...(listeners.get(message.method) ?? [])]) {
        try {
          listener(message.params);
        } catch {
          /* listener errors never break the protocol loop */
        }
      }
    }
  });

  function send(method, params = {}, { timeout: sendTimeoutMs = 20_000 } = {}) {
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

  function on(method, listener) {
    const list = listeners.get(method) ?? [];
    list.push(listener);
    listeners.set(method, list);
    return () => listeners.set(method, (listeners.get(method) ?? []).filter((item) => item !== listener));
  }

  function once(method, waitMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for CDP event " + method));
      }, waitMs);
      const unsubscribe = on(method, (params) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
    });
  }

  return {
    send,
    on,
    once,
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export async function waitForTarget(port, predicate, { timeoutMs = 15_000, host = "127.0.0.1" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch("http://" + host + ":" + port + "/json/list").then((response) => response.json());
      const target = targets.find((entry) => entry.type === "page" && predicate(entry));
      if (target && target.webSocketDebuggerUrl) return target;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for CDP page target: " + String(lastError ?? ""));
}

export async function waitForCdp(port, { timeoutMs = 12_000, host = "127.0.0.1" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetch("http://" + host + ":" + port + "/json/version").then((response) => response.json());
      if (version.Browser) return version;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

export async function closeBrowser(port, { host = "127.0.0.1" } = {}) {
  try {
    const version = await fetch("http://" + host + ":" + port + "/json/version").then((response) => response.json());
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
