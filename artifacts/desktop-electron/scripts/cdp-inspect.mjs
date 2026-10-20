import fs from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const pages = targets.filter((t) => t.type === "page" && /launcher|floating/.test(t.url));
const results = [];

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    };
    ws.onerror = (e) => reject(new Error("ws error: " + e.message));
    ws.onopen = async () => {
      try {
        await send("Runtime.enable");
        const info = await send("Runtime.evaluate", {
          expression: `({title: document.title, text: document.body.innerText.slice(0, 600), bg: getComputedStyle(document.body).backgroundColor, htmlLength: document.documentElement.outerHTML.length, width: innerWidth, height: innerHeight, visible: document.visibilityState})`,
          returnByValue: true,
        });
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const out = "docs/evidence/stealth/cdp-" + (info.result.value.title || "page").replace(/[^A-Za-z0-9]+/g, "-") + ".png";
        fs.mkdirSync("docs/evidence/stealth", { recursive: true });
        fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
        resolve({ title: info.result.value.title, url: wsUrl, info: info.result.value, screenshot: out });
      } catch (err) {
        reject(err);
      } finally {
        ws.close();
      }
    };
  });
}

for (const p of pages) results.push(await cdp(p.webSocketDebuggerUrl));
console.log(JSON.stringify(results, null, 2));
