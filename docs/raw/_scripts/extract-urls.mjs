
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'docs/raw/assets';
const files = readdirSync(dir).filter(f => f.endsWith('.js'));
const urlSet = new Set();
for (const f of files) {
  const t = readFileSync(join(dir, f), 'utf8');
  const re = /https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g;
  let m;
  while ((m = re.exec(t))) urlSet.add(m[0]);
}
const hosts = {};
for (const u of urlSet) {
  try { const h = new URL(u).host; hosts[h] = (hosts[h] || 0) + 1; } catch {}
}
const sorted = Object.entries(hosts).sort((a,b) => b[1]-a[1]);
console.log('=== HOSTS (' + sorted.length + ') ===');
for (const [h,c] of sorted) console.log(String(c).padStart(4) + '  ' + h);
writeFileSync('docs/raw/probes/all-urls-in-bundles.txt', [...urlSet].sort().join('\n'));
