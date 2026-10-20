
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dirs = ['docs/raw/assets', 'docs/raw/pages'];
const pats = [
  /\.exe\b/g, /\.dmg\b/g, /\.pkg\b/g, /\.msi\b/g, /\.appimage\b/g, /\.zip\b/g,
  /download/gi, /desktop/gi, /windows/gi, /macos/gi, /releases/gi, /github\.com[^"'\\ ]{0,80}/g,
  /api\.github[^"'\\ ]{0,60}/g, /electron/gi, /tauri/gi
];
const out = [];
for (const d of dirs) {
  let files = [];
  try { files = readdirSync(d); } catch { continue; }
  for (const f of files) {
    const buf = readFileSync(join(d, f));
    const text = buf.toString('utf8');
    for (const p of pats) {
      p.lastIndex = 0;
      let m, c = 0;
      while ((m = p.exec(text)) && c < 4) {
        const s = Math.max(0, m.index - 90), e = Math.min(text.length, m.index + m[0].length + 110);
        out.push({ file: d + '/' + f, pat: p.source, snippet: text.slice(s, e).replace(/[\r\n\t]+/g, ' ') });
        c++;
      }
    }
  }
}
const seen = new Set();
for (const o of out) {
  const key = o.snippet;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log('[' + o.pat + '] ' + o.file + ' :: ' + o.snippet);
}
console.log('TOTAL', out.length);
