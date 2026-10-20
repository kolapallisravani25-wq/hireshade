
import { openSync, readSync, closeSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const ASAR = 'docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Resources/app.asar';
const fd = openSync(ASAR, 'r');
const hdr8 = Buffer.alloc(16);
readSync(fd, hdr8, 0, 16, 0);
const headerPickleSize = hdr8.readUInt32LE(4);
const jsonLen = hdr8.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen);
readSync(fd, jsonBuf, 0, jsonLen, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const BASE = 8 + headerPickleSize;

const entries = [];
function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (v.files) walk(v, p);
    else entries.push({ path: p, size: v.size || 0, offset: v.offset, unpacked: !!v.unpacked });
  }
}
walk(header, '');
console.log('total entries:', entries.length);
console.log('total bytes(all):', entries.reduce((a,b)=>a+b.size,0));
const byTop = {};
for (const e of entries) {
  const top = e.path.split('/')[0];
  byTop[top] = byTop[top] || { n: 0, bytes: 0 };
  byTop[top].n++; byTop[top].bytes += e.size;
}
console.log('--- top-level ---');
for (const [k,v] of Object.entries(byTop).sort((a,b)=>b[1].bytes-a[1].bytes)) console.log(k + '  files=' + v.n + '  bytes=' + v.bytes);
const big = [...entries].sort((a,b)=>b.size-a.size).slice(0, 30);
console.log('--- biggest files ---');
for (const e of big) console.log(e.size + '  ' + e.path);
writeFileSync('docs/raw/desktop/asar-filelist.txt', entries.map(e => e.size + '\t' + (e.offset ?? '') + '\t' + e.path).join('\n'));
console.log('wrote docs/raw/desktop/asar-filelist.txt');
globalThis.__asar = { fd, BASE, entries };
closeSync(fd);
