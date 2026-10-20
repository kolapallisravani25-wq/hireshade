
import { readFileSync, writeFileSync } from 'node:fs';
const txt = readFileSync('docs/raw/probes/wayback-cdx.txt', 'utf8');
const lines = txt.split('\n').filter(Boolean);
const paths = new Map();
for (const l of lines) {
  const parts = l.trim().split(/\s+/);
  if (parts.length < 3) continue;
  const [ts, url, status] = parts;
  try {
    const u = new URL(url);
    let p = u.pathname;
    const key = p;
    if (!paths.has(key)) paths.set(key, { ts, status, url });
  } catch {}
}
const sorted = [...paths.entries()].sort((a,b) => a[0].localeCompare(b[0]));
console.log('unique paths: ' + sorted.length);
for (const [p, v] of sorted) console.log(v.ts + ' ' + v.status + ' ' + p);
