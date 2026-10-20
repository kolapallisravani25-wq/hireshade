
import { readFileSync } from 'node:fs';
const txt = readFileSync('docs/raw/probes/wayback-cdx.txt', 'utf8');
const lines = txt.split('\n').filter(Boolean);
const map = new Map();
for (const l of lines) {
  const parts = l.trim().split(/\s+/);
  if (parts.length < 3) continue;
  const [ts, url, status] = parts;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith('/_next/')) continue;
    if (!map.has(u.pathname)) map.set(u.pathname, { ts, status, url, n: 0 });
    map.get(u.pathname).n++;
  } catch {}
}
const s = [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
console.log('non-_next unique paths: ' + s.length);
for (const [p,v] of s) console.log(v.ts + ' ' + v.status + ' x' + v.n + ' ' + p);
