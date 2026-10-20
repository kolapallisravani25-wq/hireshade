
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const base = 'docs/raw/desktop/asar-extracted/dist';
const files = [];
(function walk(d){ for (const n of readdirSync(d)) { const p = join(d,n); const s = statSync(p); if (s.isDirectory()) walk(p); else files.push(p); } })(base);
console.log('dist files:', files.length);
for (const f of files) console.log(statSync(f).size + '  ' + f);
