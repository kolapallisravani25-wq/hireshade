
import { readFileSync } from 'node:fs';
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
function show(pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||2)) {
    const f = main.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== "' + pat + '" @byte ' + Buffer.byteLength(main.slice(0,f),'utf8'));
    console.log(main.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show('registerLiveCallSessionScreenShortcuts=', 60, 900, 1);
show('live-call-session-screen', 200, 400, 3);
show('setBounds', 400, 600, 3);
