
import { readFileSync } from 'node:fs';
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
function show(src, label, pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||3)) {
    const f = src.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== [' + label + '] "' + pat + '" @byte ' + Buffer.byteLength(src.slice(0,f),'utf8') + ' line ' + src.slice(0,f).split('\n').length);
    console.log(src.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show(main, 'main', 'transparent:', 300, 900, 9);
show(main, 'main', 'setContentProtection', 700, 500, 1);
show(main, 'main', 'setSkipTaskbar', 500, 500, 1);
