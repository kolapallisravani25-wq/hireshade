
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'docs/raw/assets';
const files = readdirSync(dir).filter(f => f.endsWith('.js'));

// 1) all /api/ paths with offsets
const apiRows = [];
for (const f of files) {
  const t = readFileSync(join(dir, f), 'utf8');
  const re = /["'`\/](\/api\/[A-Za-z0-9_\-./\[\]]{0,80})/g;
  let m;
  while ((m = re.exec(t))) {
    const off = Buffer.byteLength(t.slice(0, m.index), 'utf8');
    apiRows.push({ file: f, byteOffset: off, path: m[1] });
  }
}
writeFileSync('docs/raw/probes/api-paths-in-bundles.json', JSON.stringify(apiRows, null, 1));
console.log('=== /api/ paths (' + apiRows.length + ') ===');
const seen = new Set();
for (const r of apiRows) { const k = r.path; if (seen.has(k)) continue; seen.add(k); console.log(r.path + '  [' + r.file + ' @byte ' + r.byteOffset + ']'); }

// 2) full route manifest from the chunk containing path regexes
console.log('');
console.log('=== route manifest ===');
for (const f of files) {
  const t = readFileSync(join(dir, f), 'utf8');
  if (!t.includes('"hasOptionalPrefix"')) continue;
  const re = /\{"path":"([^"]+)"[^}]*\}/g;
  let m; let n = 0;
  while ((m = re.exec(t))) { console.log(m[1]); n++; }
  console.log('-- from ' + f + ' count=' + n);
}
