const fetchJson = async (url) => (await fetch(url)).json();
(async () => {
  const targets = await fetchJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && /floating/i.test(t.url));
  if (!page) { console.log("NO_PAGE", targets.map(t => t.url)); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  ws.onerror = (e) => { console.log("WS_ERROR"); process.exit(1); };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const mode = process.argv[2] || "monitor";
  const result = await send("Runtime.evaluate", { expression: "(async () => await window.hireshadeCapture.setAffinityMode('" + mode + "'))()", awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(result.result && result.result.value));
  ws.close();
  process.exit(0);
})();
