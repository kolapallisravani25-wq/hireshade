import fs from "node:fs";
const files = [
  "docs/raw/desktop/asar-extracted/dist/main/main.js",
  "docs/raw/desktop/asar-extracted/dist/main/mic-monitor-worker.js",
  "docs/raw/desktop/asar-extracted/dist/renderer/renderer.js",
];
const patterns = {
  contentProtection: /setContentProtection/g,
  displayAffinity: /SetWindowDisplayAffinity|WDA_EXCLUDEFROMCAPTURE|WDA_MONITOR/g,
  alwaysOnTop: /setAlwaysOnTop|alwaysOnTop/g,
  skipTaskbar: /setSkipTaskbar|skipTaskbar/g,
  globalShortcut: /globalShortcut|RegisterHotKey|accelerator/g,
  ignoreMouse: /setIgnoreMouseEvents|ignoreMouseEvents|click-through|clickThrough/g,
  lsuielement: /LSUIElement|dock\.hide|app\.dock/g,
  permissions: /setPermissionRequestHandler|media|display-capture/g,
  audio: /WASAPI|loopback|BlackHole|ScreenCaptureKit|systemAudio|getDisplayMedia|getUserMedia/g,
  ws: /wss?:\/\/[^"'\`\s)]+/g,
  vendors: /deepgram|speechmatics|assemblyai|elevenlabs|openrouter|generativelanguage|anthropic|openai|razorpay|stripe|pinecone|clerk|supabase|firebase/gi,
  capture: /desktopCapturer|getSources|screen\.getPrimaryDisplay/g,
  tray: /new Tray|Tray\(|setContextMenu/g,
};
const out = {};
for (const f of files) {
  const buf = fs.readFileSync(f);
  const text = buf.toString("utf8");
  out[f] = { bytes: buf.length };
  for (const [name, re] of Object.entries(patterns)) {
    const matches = [];
    for (const m of text.matchAll(re)) {
      const start = Math.max(0, m.index - 90);
      const end = Math.min(text.length, m.index + m[0].length + 140);
      matches.push({ offset: m.index, match: m[0].slice(0, 200), context: text.slice(start, end).replace(/\s+/g, " ") });
      if (matches.length >= 6) break;
    }
    if (matches.length) out[f][name] = matches;
  }
}
// Unique network hosts
const hosts = new Set();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/https?:\/\/[^"'\`\s)\\]+/g)) {
    try { hosts.add(new URL(m[0]).host); } catch {}
  }
  for (const m of text.matchAll(/wss?:\/\/[^"'\`\s)\\]+/g)) {
    try { hosts.add("ws:" + new URL(m[0]).host); } catch {}
  }
}
out.hosts = [...hosts].sort();
fs.writeFileSync("docs/raw/desktop/target-scan.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ files: Object.fromEntries(Object.entries(out).filter(([k]) => k !== "hosts").map(([k, v]) => [k, Object.keys(v)])), hosts: out.hosts }, null, 2));
console.log("snippets file: docs/raw/desktop/target-scan.json", fs.statSync("docs/raw/desktop/target-scan.json").size);
