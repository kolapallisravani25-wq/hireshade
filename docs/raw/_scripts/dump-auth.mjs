
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
function show(src, label, pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||3)) {
    const f = src.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== [' + label + '] "' + pat + '" @byte ' + Buffer.byteLength(src.slice(0,f),'utf8'));
    console.log(src.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show(rend, 'renderer', 'getDesktopClientHeaders', 100, 600, 3);
show(rend, 'renderer', 'x-parakeet', 150, 250, 6);
console.log('###### meeting app process list ######');
show(main, 'main', 'processNames:', 120, 1000, 3);
