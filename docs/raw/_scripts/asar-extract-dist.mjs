
import { openSync, readSync, closeSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const ASAR = 'docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Resources/app.asar';
const OUT = 'docs/raw/desktop/asar-extracted';
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
    if (v.files) walk(v, p); else entries.push({ path: p, size: v.size || 0, offset: Number(v.offset), unpacked: !!v.unpacked });
  }
}
walk(header, '');
const targets = entries.filter(e => !e.unpacked && (e.path.startsWith('dist/') || e.path === 'package.json'));
console.log('extracting', targets.length, 'files');
let n = 0, bytes = 0;
for (const e of targets) {
  const dest = join(OUT, e.path);
  mkdirSync(dirname(dest), { recursive: true });
  const buf = Buffer.alloc(e.size);
  readSync(fd, buf, 0, e.size, BASE + e.offset);
  writeFileSync(dest, buf);
  n++; bytes += e.size;
}
closeSync(fd);
console.log('extracted', n, 'files', bytes, 'bytes');
const pkg = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'));
console.log('=== package.json ===');
console.log(JSON.stringify(pkg, null, 1));
