
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
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
console.log('########## speechmatics (renderer) ##########');
show(rend, 'renderer', 'speechmatics', 400, 500, 6);
console.log('########## wss:// ##########');
show(rend, 'renderer', 'wss://', 300, 300, 4);
show(main, 'main', 'wss://', 300, 300, 4);
console.log('########## EventSource / SSE ##########');
show(rend, 'renderer', 'EventSource', 300, 400, 4);
show(rend, 'renderer', 'text/event-stream', 300, 400, 3);
