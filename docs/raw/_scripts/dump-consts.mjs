
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
function show(pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||2)) {
    const f = rend.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== "' + pat + '" @byte ' + Buffer.byteLength(rend.slice(0,f),'utf8'));
    console.log(rend.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show('MAX_CALL_DURATION_MINUTES=', 400, 600, 2);
show('FREE_SESSION_EXTENSION_MINUTES=', 300, 500, 2);
show('callSession.create', 300, 700, 3);
show('systemInstructions:', 300, 400, 4);
show('realtime', 200, 300, 6);
