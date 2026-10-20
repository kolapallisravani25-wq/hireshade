
import { readFileSync, writeFileSync } from 'node:fs';
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
const pre = readFileSync('docs/raw/desktop/asar-extracted/dist/main/preload.js', 'utf8');
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
console.log('############ LIVE CALL SHORTCUTS ############');
show(main, 'main', 'registerLiveCallSessionScreenShortcuts', 100, 1500, 1);
console.log('############ TRAY ############');
show(main, 'main', 'registerTray', 100, 1200, 2);
console.log('############ PRELOAD FULL ############');
console.log(pre);
